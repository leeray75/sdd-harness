import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CONNECT_SCRIPT, FILES_SCRIPTS } from '../../src/main/env/container';
import { execArgv } from '../../src/main/env/container-transport';
import { fakeDocker, type FakeContainer } from '../support/fake-container-transport';

// The fixed files scripts (D44, p4-env-container, AC4). Each scenario runs twice: through a real POSIX sh on a
// temp folder, and through the fake docker that answers the same script text on a mapped folder. Both must give
// the same answer, `ok` or the script's code word, so the fake is shown to match the shell. The test needs a
// POSIX sh: it always runs on Linux (the CI check job), and is skipped where no `/bin/sh` exists (Windows).
// The stat scenarios use GNU `stat -c`, which macOS's BSD `stat` rejects, so they are skipped where the host's
// `stat` does not take `-c` (macOS). The product runs the scripts inside a Linux container, where `stat -c` works.

/** The POSIX shell the scripts run in, or null when this system has none. */
const SH = process.platform !== 'win32' && existsSync('/bin/sh') ? '/bin/sh' : null;

/**
 * Whether the host's `stat` takes `-c %s` (GNU and BusyBox do, macOS does not). Probed once through the shell on a
 * temp file, which is removed after the probe. False when there is no shell, where the block is skipped anyway.
 */
const STAT_C: boolean = (() => {
  if (SH === null) return false;
  const probe = mkdtempSync(join(tmpdir(), 'container-scripts-stat-'));
  try {
    const file = join(probe, 'file.txt');
    writeFileSync(file, '');
    return spawnSync(SH, ['-c', 'stat -c %s "$1"', 'sh', file], { encoding: 'utf8' }).status === 0;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
})();

/** The arguments of one scenario: each path is written as a container path, and `at` maps it to the folder. */
type Args = (at: (path: string) => string) => string[];

interface Scenario {
  name: string;
  body: string;
  args: Args;
  stdin?: string;
  /** `ok`, or the code word the script must print. */
  expect: string;
}

/** The scenarios, one per script behaviour the backend relies on. */
const SCENARIOS: Scenario[] = [
  {
    name: 'stat of a file',
    body: FILES_SCRIPTS.stat,
    args: (at) => [at('/file.txt')],
    expect: 'ok',
  },
  {
    name: 'stat of a missing path',
    body: FILES_SCRIPTS.stat,
    args: (at) => [at('/nope')],
    expect: 'ENOENT',
  },
  {
    name: 'stat under a file',
    body: FILES_SCRIPTS.stat,
    args: (at) => [at('/file.txt/x')],
    expect: 'ENOTDIR',
  },
  {
    name: 'lstat of a dangling link',
    body: FILES_SCRIPTS.stat,
    args: (at) => [at('/dangling')],
    expect: 'ok',
  },
  {
    name: 'stat of a dangling link',
    body: FILES_SCRIPTS.statFollow,
    args: (at) => [at('/dangling')],
    expect: 'ENOENT',
  },
  {
    name: 'stat of a folder',
    body: FILES_SCRIPTS.statFollow,
    args: (at) => [at('/dir')],
    expect: 'ok',
  },
  {
    name: 'access exists on a file',
    body: FILES_SCRIPTS.accessExists,
    args: (at) => [at('/file.txt')],
    expect: 'ok',
  },
  {
    name: 'access exists on a missing path',
    body: FILES_SCRIPTS.accessExists,
    args: (at) => [at('/nope')],
    expect: 'ENOENT',
  },
  {
    name: 'access execute on a file without the bit',
    body: FILES_SCRIPTS.accessExecute,
    args: (at) => [at('/file.txt')],
    expect: 'EACCES',
  },
  {
    name: 'realpath of a link',
    body: FILES_SCRIPTS.realpath,
    args: (at) => [at('/link')],
    expect: 'ok',
  },
  {
    name: 'realpath of a missing path',
    body: FILES_SCRIPTS.realpath,
    args: (at) => [at('/nope')],
    expect: 'ENOENT',
  },
  {
    name: 'readlink of a link',
    body: FILES_SCRIPTS.readlink,
    args: (at) => [at('/link')],
    expect: 'ok',
  },
  {
    name: 'readlink of a file',
    body: FILES_SCRIPTS.readlink,
    args: (at) => [at('/file.txt')],
    expect: 'EINVAL',
  },
  {
    name: 'readlink of a missing path',
    body: FILES_SCRIPTS.readlink,
    args: (at) => [at('/nope')],
    expect: 'ENOENT',
  },
  { name: 'read a folder', body: FILES_SCRIPTS.read, args: (at) => [at('/dir')], expect: 'EISDIR' },
  {
    name: 'read a missing file',
    body: FILES_SCRIPTS.read,
    args: (at) => [at('/nope')],
    expect: 'ENOENT',
  },
  { name: 'read a file', body: FILES_SCRIPTS.read, args: (at) => [at('/file.txt')], expect: 'ok' },
  {
    name: 'capped read of a file',
    body: FILES_SCRIPTS.readCapped,
    args: (at) => [at('/file.txt'), '4'],
    expect: 'ok',
  },
  {
    name: 'capped read of a folder',
    body: FILES_SCRIPTS.readCapped,
    args: (at) => [at('/dir'), '4'],
    expect: 'EISDIR',
  },
  {
    name: 'byte range of a file',
    body: FILES_SCRIPTS.readRange,
    args: (at) => [at('/file.txt'), '2', '3'],
    expect: 'ok',
  },
  {
    name: 'byte range of a missing file',
    body: FILES_SCRIPTS.readRange,
    args: (at) => [at('/nope'), '1', '3'],
    expect: 'ENOENT',
  },
  {
    name: 'write into a folder',
    body: FILES_SCRIPTS.write,
    args: (at) => [at('/dir')],
    stdin: 'x',
    expect: 'EISDIR',
  },
  {
    name: 'write under a missing folder',
    body: FILES_SCRIPTS.write,
    args: (at) => [at('/nope/x')],
    stdin: 'x',
    expect: 'ENOENT',
  },
  {
    name: 'write a new file',
    body: FILES_SCRIPTS.write,
    args: (at) => [at('/new.txt')],
    stdin: 'x',
    expect: 'ok',
  },
  {
    name: 'exclusive write over a file',
    body: FILES_SCRIPTS.writeExclusive,
    args: (at) => [at('/file.txt')],
    stdin: 'x',
    expect: 'EEXIST',
  },
  {
    name: 'exclusive write of a new file',
    body: FILES_SCRIPTS.writeExclusive,
    args: (at) => [at('/fresh.txt')],
    stdin: 'x',
    expect: 'ok',
  },
  {
    name: 'mkdir of an existing folder',
    body: FILES_SCRIPTS.mkdir,
    args: (at) => [at('/dir')],
    expect: 'EEXIST',
  },
  {
    name: 'mkdir under a file',
    body: FILES_SCRIPTS.mkdir,
    args: (at) => [at('/file.txt/sub')],
    expect: 'ENOTDIR',
  },
  {
    name: 'mkdir of a new folder',
    body: FILES_SCRIPTS.mkdir,
    args: (at) => [at('/newdir')],
    expect: 'ok',
  },
  {
    name: 'recursive mkdir over a file',
    body: FILES_SCRIPTS.mkdirRecursive,
    args: (at) => [at('/file.txt')],
    expect: 'EEXIST',
  },
  {
    name: 'recursive mkdir of a deep folder',
    body: FILES_SCRIPTS.mkdirRecursive,
    args: (at) => [at('/a/b/c')],
    expect: 'ok',
  },
  {
    name: 'remove a folder without recursion',
    body: FILES_SCRIPTS.remove,
    args: (at) => [at('/dir'), '0', '0'],
    expect: 'EISDIR',
  },
  {
    name: 'remove a folder recursively',
    body: FILES_SCRIPTS.remove,
    args: (at) => [at('/dir'), '1', '0'],
    expect: 'ok',
  },
  {
    name: 'force-remove a missing path',
    body: FILES_SCRIPTS.remove,
    args: (at) => [at('/nope'), '0', '1'],
    expect: 'ok',
  },
  {
    name: 'remove a missing path without force',
    body: FILES_SCRIPTS.remove,
    args: (at) => [at('/nope'), '0', '0'],
    expect: 'ENOENT',
  },
  {
    name: 'rmdir of a folder with entries',
    body: FILES_SCRIPTS.removeDir,
    args: (at) => [at('/dir')],
    expect: 'ENOTEMPTY',
  },
  {
    name: 'rmdir of an empty folder',
    body: FILES_SCRIPTS.removeDir,
    args: (at) => [at('/empty')],
    expect: 'ok',
  },
  {
    name: 'rmdir of a file',
    body: FILES_SCRIPTS.removeDir,
    args: (at) => [at('/file.txt')],
    expect: 'ENOTDIR',
  },
  {
    name: 'rmdir of a missing path',
    body: FILES_SCRIPTS.removeDir,
    args: (at) => [at('/nope')],
    expect: 'ENOENT',
  },
  {
    name: 'rename of a missing source',
    body: FILES_SCRIPTS.rename,
    args: (at) => [at('/nope'), at('/x')],
    expect: 'ENOENT',
  },
  {
    name: 'rename over a folder',
    body: FILES_SCRIPTS.rename,
    args: (at) => [at('/file.txt'), at('/dir')],
    expect: 'EEXIST',
  },
  {
    name: 'rename of a file',
    body: FILES_SCRIPTS.rename,
    args: (at) => [at('/file.txt'), at('/moved.txt')],
    expect: 'ok',
  },
  {
    name: 'chmod of a file',
    body: FILES_SCRIPTS.chmod,
    args: (at) => [at('/file.txt'), '600'],
    expect: 'ok',
  },
  {
    name: 'chmod of a missing path',
    body: FILES_SCRIPTS.chmod,
    args: (at) => [at('/nope'), '600'],
    expect: 'ENOENT',
  },
  {
    name: 'symlink over an existing path',
    body: FILES_SCRIPTS.symlink,
    args: (at) => [at('/file.txt'), at('/link')],
    expect: 'EEXIST',
  },
  {
    name: 'symlink of a new path',
    body: FILES_SCRIPTS.symlink,
    args: (at) => [at('/file.txt'), at('/newlink')],
    expect: 'ok',
  },
  {
    name: 'readdir of a folder',
    body: FILES_SCRIPTS.readdir,
    args: (at) => [at('/dir')],
    expect: 'ok',
  },
  {
    name: 'readdir of a file',
    body: FILES_SCRIPTS.readdir,
    args: (at) => [at('/file.txt')],
    expect: 'ENOTDIR',
  },
  {
    name: 'readdir of a missing path',
    body: FILES_SCRIPTS.readdir,
    args: (at) => [at('/nope')],
    expect: 'ENOENT',
  },
  { name: 'the connect check', body: CONNECT_SCRIPT, args: () => [], expect: 'ok' },
];

/**
 * The fixture each scenario starts from, under a folder that stands for `/`. The links point at the folder's own
 * local paths, which the fake maps back to container paths on readlink.
 */
function fixture(root: string): void {
  const local = (path: string): string => join(root, path);
  mkdirSync(local('/dir'), { recursive: true });
  mkdirSync(local('/empty'), { recursive: true });
  writeFileSync(local('/dir/child.txt'), 'child');
  writeFileSync(local('/file.txt'), 'hello world');
  symlinkSync(local('/file.txt'), local('/link'));
  symlinkSync(local('/nope'), local('/dangling'));
}

/** The last line of a script's stderr, or `ok` when it exited 0. */
function answerOf(code: number | null, stderr: string): string {
  if (code === 0) return 'ok';
  const lines = stderr.trim().split('\n');
  return (lines[lines.length - 1] ?? '').trim();
}

let scratch: string | null = null;

afterEach(() => {
  if (scratch !== null) {
    rmSync(scratch, { recursive: true, force: true });
    scratch = null;
  }
});

describe.skipIf(SH === null)(
  'the fixed files scripts match the fake and a real POSIX shell (AC4)',
  () => {
    for (const scenario of SCENARIOS) {
      // The stat scenarios need `stat -c` on the host; every other scenario runs everywhere the block does.
      const isStat =
        scenario.body === FILES_SCRIPTS.stat || scenario.body === FILES_SCRIPTS.statFollow;
      const itScenario = isStat ? it.skipIf(!STAT_C) : it;
      itScenario(`gives the same answer for ${scenario.name}: ${scenario.expect}`, async () => {
        scratch = mkdtempSync(join(tmpdir(), 'container-scripts-'));

        // The real shell, on a folder where the paths are the local ones.
        const real = join(scratch, 'real');
        mkdirSync(real);
        fixture(real);
        const realRun = spawnSync(
          SH ?? '/bin/sh',
          ['-c', scenario.body, 'sh', ...scenario.args((path) => join(real, path))],
          { input: scenario.stdin ?? '', encoding: 'utf8' },
        );
        const shell = answerOf(realRun.status, realRun.stderr);

        // The fake, on a container whose `/` is a folder of its own.
        const mount = join(scratch, 'container');
        mkdirSync(mount);
        fixture(mount);
        const container: FakeContainer = {
          id: 'files-1',
          folder: '/work',
          metadata: null,
          running: true,
          created: '2026-11-20 10:00:00 +0000 UTC',
          mount,
        };
        const docker = fakeDocker([container]);
        const fake = await docker.run(
          execArgv({
            id: 'files-1',
            user: null,
            cwd: '/',
            names: [],
            stdin: scenario.stdin !== undefined,
            command: ['sh', '-c', scenario.body, 'sh', ...scenario.args((path) => path)],
          }),
          {
            timeoutMs: 10_000,
            capture: { maxBytes: 1024 * 1024 },
            ...(scenario.stdin === undefined ? {} : { stdin: scenario.stdin }),
          },
        );
        const fakeAnswer =
          fake.started && fake.code !== null
            ? answerOf(fake.code, (fake.stderr ?? Buffer.alloc(0)).toString('utf8'))
            : 'not started';

        expect(shell).toBe(scenario.expect);
        expect(fakeAnswer).toBe(scenario.expect);
      });
    }
  },
);

describe('the connect check script (AC4, AC7)', () => {
  it('names the system and setsid, so the backend can refuse a system without them', () => {
    expect(CONNECT_SCRIPT).toContain('uname -s');
    expect(CONNECT_SCRIPT).toContain('command -v setsid');
  });
});
