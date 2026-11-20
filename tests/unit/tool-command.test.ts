import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_TOOL_OUTPUT_LENGTH } from '../../src/shared/agent-protocol';
import {
  commandEnv,
  COMMAND_DEFAULT_TIMEOUT_MS,
  programRefusal,
  runCommandInRoot,
} from '../../src/main/tools/run-command';

// Small Node scripts the tests run through process.execPath. They are CommonJS and live in
// their own folder, outside the root.
const SCRIPTS: Record<string, string> = {
  'out-err.cjs': `process.stdout.write('to-out\\n'); process.stderr.write('to-err\\n');`,
  'exit.cjs': `process.exit(Number(process.argv[2]));`,
  'echo-args.cjs': `process.stdout.write(JSON.stringify(process.argv.slice(2)));`,
  'cwd.cjs': `process.stdout.write(process.cwd());`,
  'env.cjs': `process.stdout.write(JSON.stringify({ sentinel: process.env.HARNESS_TEST_SENTINEL ?? null, path: (process.env.PATH ?? process.env.Path) ?? null }));`,
  'tail.cjs': `process.stdout.write('a'.repeat(100000) + 'TAILMARK');`,
  'self-term.cjs': `process.kill(process.pid, 'SIGTERM');`,
  // Starts a sleeper that inherits this process's output, records its pid, then sleeps.
  'parent.cjs': `
    const { spawn } = require('node:child_process');
    spawn(process.execPath, [process.argv[3], process.argv[2]], { stdio: 'inherit' });
    setTimeout(() => {}, 60000);
  `,
  'sleeper.cjs': `
    const fs = require('node:fs');
    fs.writeFileSync(process.argv[2], String(process.pid));
    setTimeout(() => {}, 60000);
  `,
};

let base: string;
let root: string;
let scripts: string;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'tool-command-'));
  root = join(base, 'root');
  scripts = join(base, 'scripts');
  mkdirSync(join(root, 'sub'), { recursive: true });
  mkdirSync(join(root, '.git'));
  mkdirSync(scripts);
  writeFileSync(join(root, 'file.txt'), 'not a folder');
  for (const [name, source] of Object.entries(SCRIPTS)) {
    writeFileSync(join(scripts, name), source);
  }
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

function script(name: string): string {
  return join(scripts, name);
}

function expectOutput(result: Awaited<ReturnType<typeof runCommandInRoot>>): string {
  if (!result.ok) throw new Error(`expected output, got: ${result.reason}`);
  return result.output;
}

function expectFailed(result: Awaited<ReturnType<typeof runCommandInRoot>>): string {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected a failure');
  return result.reason;
}

/** True while a process with this pid is alive. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntilDead(pid: number, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !isAlive(pid);
}

describe('programRefusal: git', () => {
  it.each([
    'git',
    'GIT',
    'Git',
    'git.exe',
    'GIT.exe',
    'git.cmd',
    'git.bat',
    '/usr/bin/git',
    'C:\\Program Files\\Git\\bin\\git.exe',
    'bin/Git.EXE',
  ])('refuses %s on every platform', (program) => {
    for (const platform of ['linux', 'darwin', 'win32'] as const) {
      expect(programRefusal(program, platform)).toContain('git');
    }
  });

  it.each(['gitk', 'github', 'mygit', 'git-lfs', 'legit.exe'])('does not refuse %s', (program) => {
    expect(programRefusal(program, 'linux')).toBeNull();
    expect(programRefusal(program, 'win32')).toBeNull();
  });

  it('refuses git before anything starts, through runCommandInRoot', async () => {
    expect(
      expectFailed(await runCommandInRoot(root, { program: 'GIT.exe', args: ['status'] })),
    ).toContain('git');
  });
});

describe('programRefusal: .cmd and .bat on Windows', () => {
  it('refuses .cmd and .bat programs on win32', () => {
    expect(programRefusal('pnpm.cmd', 'win32')).toContain('.cmd');
    expect(programRefusal('tool.BAT', 'win32')).toContain('.cmd');
    expect(programRefusal('C:\\tools\\run.cmd', 'win32')).not.toBeNull();
  });

  it('does not refuse them on other platforms', () => {
    expect(programRefusal('pnpm.cmd', 'linux')).toBeNull();
    expect(programRefusal('tool.bat', 'darwin')).toBeNull();
  });

  it('refuses a .cmd program through runCommandInRoot on win32, without starting it', async () => {
    const reason = expectFailed(
      await runCommandInRoot(root, { program: 'pnpm.cmd', args: ['test'] }, { platform: 'win32' }),
    );
    expect(reason).toContain('.cmd');
  });

  it('refuses an empty program', () => {
    expect(programRefusal('', 'linux')).not.toBeNull();
  });
});

describe('runCommandInRoot: running programs', () => {
  it('returns the exit code, whatever it is, as ok', async () => {
    expect(
      expectOutput(
        await runCommandInRoot(root, {
          program: process.execPath,
          args: [script('exit.cjs'), '0'],
        }),
      ),
    ).toMatch(/^exit code 0/);
    expect(
      expectOutput(
        await runCommandInRoot(root, {
          program: process.execPath,
          args: [script('exit.cjs'), '3'],
        }),
      ),
    ).toMatch(/^exit code 3/);
  });

  it.skipIf(process.platform === 'win32')('reports a signal', async () => {
    const output = expectOutput(
      await runCommandInRoot(root, { program: process.execPath, args: [script('self-term.cjs')] }),
    );
    expect(output).toMatch(/^terminated by signal SIGTERM/);
  });

  it('returns both stdout and stderr', async () => {
    const output = expectOutput(
      await runCommandInRoot(root, { program: process.execPath, args: [script('out-err.cjs')] }),
    );
    expect(output).toContain('to-out');
    expect(output).toContain('to-err');
  });

  it('passes the argument array as given, with no shell expansion', async () => {
    const tricky = ['$HOME', 'a b', '--x=1;rm -rf /', '`whoami`'];
    const output = expectOutput(
      await runCommandInRoot(root, {
        program: process.execPath,
        args: [script('echo-args.cjs'), ...tricky],
      }),
    );
    const body = output.split('\n').slice(1).join('\n');
    expect(JSON.parse(body)).toEqual(tricky);
  });

  it('runs in the root by default and in a relative cwd', async () => {
    const inRoot = expectOutput(
      await runCommandInRoot(root, { program: process.execPath, args: [script('cwd.cjs')] }),
    );
    expect(basename(inRoot.split('\n').slice(1).join('\n'))).toBe(basename(root));

    const inSub = expectOutput(
      await runCommandInRoot(root, {
        program: process.execPath,
        args: [script('cwd.cjs')],
        cwd: 'sub',
      }),
    );
    expect(basename(inSub.split('\n').slice(1).join('\n'))).toBe('sub');
  });

  it('refuses a cwd that is outside the root, a file, a .git folder, absolute or missing', async () => {
    const run = (cwd: string) =>
      runCommandInRoot(root, { program: process.execPath, args: [script('cwd.cjs')], cwd });
    expectFailed(await run('..'));
    expectFailed(await run('file.txt'));
    expectFailed(await run('.git'));
    expectFailed(await run(base));
    expectFailed(await run('missing-folder'));
    expectFailed(await run(''));
  });

  it('refuses a program that cannot be started, with a fixed reason', async () => {
    const reason = expectFailed(
      await runCommandInRoot(root, { program: join(base, 'no-such-program-7731'), args: [] }),
    );
    expect(reason).toContain('could not be started');
    expect(reason).not.toContain('7731');
  });
});

describe('runCommandInRoot: environment', () => {
  it('does not pass a sentinel variable from main, and passes PATH', async () => {
    const previous = process.env['HARNESS_TEST_SENTINEL'];
    process.env['HARNESS_TEST_SENTINEL'] = 'sentinel-value-4421';
    try {
      const output = expectOutput(
        await runCommandInRoot(root, { program: process.execPath, args: [script('env.cjs')] }),
      );
      const seen = JSON.parse(output.split('\n').slice(1).join('\n')) as {
        sentinel: string | null;
        path: string | null;
      };
      expect(seen.sentinel).toBeNull();
      expect(seen.path).not.toBeNull();
      expect(output).not.toContain('sentinel-value-4421');
    } finally {
      if (previous === undefined) {
        delete process.env['HARNESS_TEST_SENTINEL'];
      } else {
        process.env['HARNESS_TEST_SENTINEL'] = previous;
      }
    }
  });

  it('keeps only the basics for each platform', () => {
    const parent = {
      PATH: '/usr/bin',
      HOME: '/home/u',
      TMPDIR: '/tmp',
      USER: 'u',
      SECRET_KEY: 'k',
      HARNESS_SPIKE_BASE_URL: 'http://x',
    };
    expect(commandEnv(parent, 'linux')).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/u',
      TMPDIR: '/tmp',
    });
  });

  it('keeps the Windows basics with the parent spelling, and drops everything else', () => {
    const parent = {
      Path: 'C:\\Windows',
      systemroot: 'C:\\WINDOWS',
      TEMP: 'C:\\Temp',
      tmp: 'C:\\Temp',
      USERPROFILE: 'C:\\Users\\u',
      HOME: 'C:\\Users\\u',
      SECRET_KEY: 'k',
    };
    expect(commandEnv(parent, 'win32')).toEqual({
      Path: 'C:\\Windows',
      systemroot: 'C:\\WINDOWS',
      TEMP: 'C:\\Temp',
      tmp: 'C:\\Temp',
      USERPROFILE: 'C:\\Users\\u',
    });
  });

  it('leaves out variables that are not set', () => {
    expect(commandEnv({ PATH: '/bin' }, 'linux')).toEqual({ PATH: '/bin' });
  });
});

describe('runCommandInRoot: output cap', () => {
  it('keeps the tail, stays within the output limit and says it was cut', async () => {
    const output = expectOutput(
      await runCommandInRoot(root, { program: process.execPath, args: [script('tail.cjs')] }),
    );
    expect(output.length).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_LENGTH);
    expect(output).toContain('TAILMARK');
    expect(output).toContain('earliest output was dropped');
    expect(output.startsWith('exit code 0')).toBe(true);
  });
});

describe('runCommandInRoot: timeout', () => {
  it('has a 10 minute default', () => {
    expect(COMMAND_DEFAULT_TIMEOUT_MS).toBe(600_000);
  });

  it('kills the process and the grandchild it started, and reports the timeout', async () => {
    const pidFile = join(base, 'grandchild.pid');
    const started = Date.now();
    const output = expectOutput(
      await runCommandInRoot(
        root,
        { program: process.execPath, args: [script('parent.cjs'), pidFile, script('sleeper.cjs')] },
        { timeoutMs: 1500 },
      ),
    );
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(output).toMatch(/^timed out after 1500 ms/);

    // The grandchild writes its pid just after it starts; wait for that, then for it to die.
    const deadline = Date.now() + 5000;
    let pid = NaN;
    while (Number.isNaN(pid) && Date.now() < deadline) {
      try {
        pid = Number(readFileSync(pidFile, 'utf8'));
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    expect(Number.isInteger(pid)).toBe(true);
    expect(await waitUntilDead(pid, 5000)).toBe(true);
  });
});
