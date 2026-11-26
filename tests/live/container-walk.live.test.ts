import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { environmentFor } from '../../src/main/env';
import {
  appContainerTransport,
  findContainer,
  type DockerHost,
} from '../../src/main/env/container-transport';
import {
  closeWalk,
  runHeadlessWalk,
  startWalk,
  type GitReader,
  type WalkFiles,
} from '../support/headless-walk';

// The headless walk on a dev container project (p4-env-container, G6, AC13). The live suite (D24): it runs only with
// `pnpm test:live`, never in CI. It needs a dev container that is already built and labelled: its
// devcontainer.local_folder label is HARNESS_CONTAINER_FOLDER, and HARNESS_CONTAINER_ROOT is a folder inside the
// container where the walk may create its temp folders (as HARNESS_SSH_ROOT is for the SSH walk). The container's
// Docker is the one in the WSL distribution HARNESS_CONTAINER_WSL_DISTRO (Windows only), or else the docker on this
// machine's PATH. The walk's programs and git run as the container's remote user (D44), through the app's own
// transport. The walk's temp folders are removed afterwards.

/** Each docker call is a process through wsl.exe (about 0.5 s), so a walk takes far longer than a local one. */
const LIVE_LIMIT_MS = 90 * 60_000;

/** The variables the suite needs, and why it skips. Never runs in CI. */
function probe(): string | null {
  if (process.env['CI'] !== undefined && process.env['CI'] !== '')
    return 'CI never runs the live suite';
  const missing = ['HARNESS_CONTAINER_FOLDER', 'HARNESS_CONTAINER_ROOT'].filter(
    (name) => (process.env[name] ?? '') === '',
  );
  if (missing.length > 0) return `${missing.join(', ')} must be set`;
  const distro = process.env['HARNESS_CONTAINER_WSL_DISTRO'] ?? '';
  if (distro !== '' && process.platform !== 'win32') {
    return 'HARNESS_CONTAINER_WSL_DISTRO needs Windows';
  }
  return null;
}

const reason = probe();
if (reason !== null) {
  console.info(`container walk: skipped, ${reason}`);
}

/** The Docker host the suite uses: the WSL distribution when one is named, else this machine's docker. */
function hostOf(): DockerHost {
  const distro = process.env['HARNESS_CONTAINER_WSL_DISTRO'] ?? '';
  return distro === '' ? { kind: 'host' } : { kind: 'wsl', distribution: distro };
}

/** Runs the docker CLI of the host with an argument array (test only). Throws on a non-zero exit. */
function dockerCli(args: string[], input?: string): string {
  const host = hostOf();
  const options = {
    encoding: 'utf8' as const,
    windowsHide: true,
    timeout: 120_000,
    ...(input === undefined ? {} : { input }),
  };
  if (host.kind === 'wsl') {
    return execFileSync('wsl.exe', ['-d', host.distribution, '--exec', 'docker', ...args], options);
  }
  return execFileSync('docker', args, options);
}

describe.skipIf(reason !== null)('the headless walk on a dev container project (G6, AC13)', () => {
  const folder = process.env['HARNESS_CONTAINER_FOLDER'] ?? '';
  const containerRoot = process.env['HARNESS_CONTAINER_ROOT'] ?? '';
  let scratch = '';
  let containerId = '';
  let user: string | null = null;
  let base = '';
  let work = '';
  let remote = '';
  let hooks = '';

  /** Runs a program inside the container as its remote user, in a folder, with optional stdin (test only). */
  function inContainer(cwd: string, argv: string[], input?: string): string {
    const args = [
      'exec',
      ...(input === undefined ? [] : ['-i']),
      ...(user === null ? [] : ['-u', user]),
      '-w',
      cwd,
      containerId,
      ...argv,
    ];
    return dockerCli(args, input);
  }

  beforeAll(async () => {
    scratch = mkdtempSync(join(tmpdir(), 'sdd-container-walk-'));
    const found = await findContainer(appContainerTransport(hostOf()), folder);
    if (!found.ok) throw new Error(`no dev container for the folder (${found.cause})`);
    if (!found.running) dockerCli(['start', found.id]);
    containerId = found.id;
    user = found.user;

    base = posix.join(containerRoot, `sdd-container-walk-${process.pid}-${Date.now()}`);
    work = posix.join(base, 'work');
    remote = posix.join(base, 'origin.git');
    hooks = posix.join(base, 'no-hooks');
    inContainer('/', ['mkdir', '-p', work, remote, hooks]);
    inContainer(remote, ['git', 'init', '-q', '--bare', '-b', 'main']);
    inContainer(work, ['git', 'init', '-q', '-b', 'main']);
    for (const [key, value] of [
      ['user.name', 'Walk Test'],
      ['user.email', 'walk@example.com'],
      ['init.defaultBranch', 'main'],
      ['core.autocrlf', 'false'],
      ['commit.gpgsign', 'false'],
      ['core.hooksPath', hooks],
    ] as const) {
      inContainer(work, ['git', 'config', key, value]);
    }
    inContainer(work, ['sh', '-c', 'cat > "$1"', 'sh', posix.join(work, 'README.md')], '# Walk\n');
    inContainer(work, ['git', 'add', '--', 'README.md']);
    inContainer(work, ['git', 'commit', '-q', '-m', 'Initial commit']);
    inContainer(work, ['git', 'remote', 'add', 'origin', remote]);
    inContainer(work, ['git', 'push', '-q', '-u', 'origin', 'main']);
    inContainer(work, ['git', 'remote', 'set-head', 'origin', 'main']);
    inContainer(work, ['git', 'checkout', '-q', '-b', 'feature/p3-walk']);
  }, LIVE_LIMIT_MS);

  afterAll(() => {
    closeWalk();
    rmSync(scratch, { recursive: true, force: true });
    if (base !== '' && containerId !== '') {
      try {
        inContainer('/', ['rm', '-rf', base]);
      } catch {
        // The temp folder inside the container is left for the next run to find.
      }
    }
  });

  it(
    'runs the same walk through the registry on a project in the container',
    async () => {
      const git: GitReader = (cwd, args) => inContainer(cwd, ['git', ...args]);
      const files: WalkFiles = {
        write: (relative, text) =>
          void inContainer(
            work,
            [
              'sh',
              '-c',
              'mkdir -p "$(dirname "$1")" && cat > "$1"',
              'sh',
              posix.join(work, relative),
            ],
            text,
          ),
        read: (relative) => inContainer(work, ['cat', posix.join(work, relative)]),
        exists: (relative) => {
          try {
            inContainer(work, ['test', '-e', posix.join(work, relative)]);
            return true;
          } catch {
            return false;
          }
        },
        append: (relative, text) =>
          void inContainer(
            work,
            ['sh', '-c', 'cat >> "$1"', 'sh', posix.join(work, relative)],
            text,
          ),
      };
      const walk = await startWalk({
        root: work,
        remote,
        projectRoot: work,
        git,
        project: {
          kind: 'added',
          environment: { kind: 'container', folder, docker: hostOf() },
        },
        storeFile: join(scratch, 'projects.json'),
        files,
        environmentFor,
      });
      await runHeadlessWalk(walk);
    },
    LIVE_LIMIT_MS,
  );
});
