import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { appWslTransport } from '../../src/main/env/wsl';
import { parseWslList } from '../../src/main/env/wsl-detect';
import {
  closeWalk,
  runHeadlessWalk,
  startWalk,
  WALK_TIMEOUT_MS,
  type GitReader,
} from '../support/headless-walk';

// The headless walk on a WSL project (p4-env-wsl, G5, AC11). The live suite (D24): it runs only with
// `pnpm test:live`, never in CI. It is skipped off Windows, without WSL, or without git in the
// distribution. The distribution is HARNESS_WSL_DISTRO, else the default one.
//
// The walk runs on a temp repo with a bare remote inside the distribution. The project is added through
// the store and the registry as a WSL project, so every read and write goes through the WSL backend. The
// test's own git reads go through wsl.exe, here and nowhere else.

/** The distribution to use and whether the suite can run, decided at collection time (no async). */
function probe(): { distro: string | null; reason: string | null } {
  if (process.platform !== 'win32') return { distro: null, reason: 'not Windows' };
  let distributions: ReturnType<typeof parseWslList>;
  try {
    distributions = parseWslList(
      execFileSync('wsl.exe', ['--list', '--verbose'], { windowsHide: true, timeout: 15_000 }),
    );
  } catch {
    return { distro: null, reason: 'WSL is not installed' };
  }
  const requested = process.env['HARNESS_WSL_DISTRO'];
  const distro =
    requested !== undefined && requested !== ''
      ? requested
      : (distributions.find((item) => item.isDefault)?.name ?? distributions[0]?.name ?? null);
  if (distro === null) return { distro: null, reason: 'no WSL distribution is installed' };
  try {
    execFileSync('wsl.exe', ['-d', distro, '--exec', 'git', '--version'], {
      windowsHide: true,
      timeout: 30_000,
    });
  } catch {
    return { distro, reason: `git is not installed in the distribution ${distro}` };
  }
  return { distro, reason: null };
}

const { distro, reason } = probe();
if (reason !== null) {
  console.info(`wsl walk: skipped, ${reason}`);
}

/** The share path of a Linux path, as the app's transport maps it (test-only copy of the mapping). */
function sharePathOf(shareRoot: string, linux: string): string {
  return join(shareRoot, ...linux.split('/').filter((segment) => segment !== ''));
}

/** The Linux path of a share path (test-only copy of the mapping). */
function linuxOf(shareRoot: string, sharePath: string): string {
  return `/${relative(shareRoot, sharePath).split(sep).join('/')}`;
}

describe.skipIf(reason !== null || distro === null)(
  'the headless walk on a WSL project (G5, AC11)',
  () => {
    let shareRoot = '';
    let scratch = '';
    let linuxBase = '';
    let remoteLinux = '';
    let workLinux = '';
    let hooksLinux = '';

    /** Runs a program inside the distribution (test only). */
    function inDistro(args: string[]): string {
      return execFileSync('wsl.exe', ['-d', distro ?? '', '--exec', ...args], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 60_000,
      });
    }

    /** Runs git inside the distribution, from a Linux folder (test only). */
    function gitIn(cwdLinux: string, args: string[]): string {
      return execFileSync(
        'wsl.exe',
        ['-d', distro ?? '', '--cd', cwdLinux, '--exec', 'git', ...args],
        { encoding: 'utf8', windowsHide: true, timeout: 120_000 },
      );
    }

    /** The git reader of the walk: a node:fs folder is mapped to its Linux path, then git runs there. */
    const reader: GitReader = (cwd, args) => gitIn(linuxOf(shareRoot, cwd), args);

    beforeAll(() => {
      shareRoot = appWslTransport(distro ?? '').shareRoot;
      scratch = mkdtempSync(join(tmpdir(), 'sdd-wsl-walk-'));
      linuxBase = `/tmp/sdd-wsl-walk-${process.pid}-${Date.now()}`;
      remoteLinux = `${linuxBase}/origin.git`;
      workLinux = `${linuxBase}/work`;
      hooksLinux = `${linuxBase}/no-hooks`;
      inDistro(['mkdir', '-p', remoteLinux, workLinux, hooksLinux]);
      gitIn(remoteLinux, ['init', '-q', '--bare', '-b', 'main']);
      gitIn(workLinux, ['init', '-q', '-b', 'main']);
      gitIn(workLinux, ['config', 'user.name', 'Walk Test']);
      gitIn(workLinux, ['config', 'user.email', 'walk@example.com']);
      gitIn(workLinux, ['config', 'init.defaultBranch', 'main']);
      gitIn(workLinux, ['config', 'core.autocrlf', 'false']);
      gitIn(workLinux, ['config', 'commit.gpgsign', 'false']);
      gitIn(workLinux, ['config', 'core.hooksPath', hooksLinux]);
      writeFileSync(join(sharePathOf(shareRoot, workLinux), 'README.md'), '# Walk\n');
      gitIn(workLinux, ['add', '--', 'README.md']);
      gitIn(workLinux, ['commit', '-q', '-m', 'Initial commit']);
      gitIn(workLinux, ['remote', 'add', 'origin', remoteLinux]);
      gitIn(workLinux, ['push', '-q', '-u', 'origin', 'main']);
      gitIn(workLinux, ['remote', 'set-head', 'origin', 'main']);
      gitIn(workLinux, ['checkout', '-q', '-b', 'feature/p3-walk']);
    });

    afterAll(() => {
      closeWalk();
      rmSync(scratch, { recursive: true, force: true });
      if (linuxBase !== '') {
        try {
          inDistro(['rm', '-rf', linuxBase]);
        } catch {
          // The temp folder inside the distribution is left for the next run to find.
        }
      }
    });

    it(
      'runs the same walk through the registry on a project inside the distribution',
      async () => {
        const walk = await startWalk({
          root: sharePathOf(shareRoot, workLinux),
          remote: sharePathOf(shareRoot, remoteLinux),
          projectRoot: workLinux,
          git: reader,
          project: { kind: 'added', environment: { kind: 'wsl', distribution: distro ?? '' } },
          storeFile: join(scratch, 'projects.json'),
        });
        await runHeadlessWalk(walk);
      },
      WALK_TIMEOUT_MS * 3,
    );
  },
);
