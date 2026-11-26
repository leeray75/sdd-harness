import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cmdExeFor,
  cmdLineFor,
  isCommandScript,
  NOT_ON_PATH,
  resolveProgram,
  UNSAFE_CMD_LINE,
} from '../../src/main/commands/lookup';
import { localEnvironment, toolEnvironment } from '../../src/main/env';
import type { ToolEnvironment } from '../../src/main/env/types';
import { runCommandInRoot } from '../../src/main/tools/run-command';

/**
 * The environment whose files are the given paths: stat and access answer for those paths only,
 * so the lookup never touches the disk. It is the files part the lookup reads (D41).
 */
function filesOf(...paths: string[]): ToolEnvironment {
  const set = new Set(paths);
  const base = toolEnvironment(localEnvironment());
  return {
    ...base,
    files: {
      ...base.files,
      stat: async (file: string) => {
        if (!set.has(file)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        return {
          isFile: () => true,
          isDirectory: () => false,
          isSymbolicLink: () => false,
          size: 0,
          mtimeMs: 0,
          mode: 0o755,
        };
      },
      access: async (file: string) => {
        if (!set.has(file)) throw Object.assign(new Error('missing'), { code: 'EACCES' });
      },
    },
  };
}

describe('resolveProgram: PATH order on win32 (files as a parameter)', () => {
  it('finds a program in the second folder of PATH, with a PATHEXT extension', async () => {
    const env = { PATH: 'C:\\a;C:\\b' };
    expect(await resolveProgram(filesOf('C:\\b\\pnpm.CMD'), 'pnpm', env, 'win32')).toEqual({
      ok: true,
      file: 'C:\\b\\pnpm.CMD',
    });
  });

  it('tries each PATHEXT extension in a folder before the name as given', async () => {
    const env = { PATH: 'C:\\a' };
    const found = await resolveProgram(
      filesOf('C:\\a\\pnpm', 'C:\\a\\pnpm.CMD'),
      'pnpm',
      env,
      'win32',
    );
    expect(found).toEqual({ ok: true, file: 'C:\\a\\pnpm.CMD' });
  });

  it('uses the default PATHEXT when PATHEXT is not set', async () => {
    expect(
      await resolveProgram(filesOf('C:\\n\\node.EXE'), 'node', { PATH: 'C:\\n' }, 'win32'),
    ).toEqual({
      ok: true,
      file: 'C:\\n\\node.EXE',
    });
  });

  it('uses the PATHEXT it is given, and not the default', async () => {
    const env = { PATH: 'C:\\a', PATHEXT: '.PS1' };
    expect(await resolveProgram(filesOf('C:\\a\\tool.CMD'), 'tool', env, 'win32')).toEqual({
      ok: false,
      reason: NOT_ON_PATH,
    });
    expect(await resolveProgram(filesOf('C:\\a\\tool.PS1'), 'tool', env, 'win32')).toEqual({
      ok: true,
      file: 'C:\\a\\tool.PS1',
    });
  });

  it('matches the PATH variable whatever the case of its name', async () => {
    expect(
      await resolveProgram(filesOf('C:\\a\\tool.EXE'), 'tool', { Path: 'C:\\a' }, 'win32'),
    ).toEqual({
      ok: true,
      file: 'C:\\a\\tool.EXE',
    });
  });

  it('refuses a program that is not on PATH, with the fixed reason and no name', async () => {
    const result = await resolveProgram(filesOf(), 'missing-7731', { PATH: 'C:\\a' }, 'win32');
    expect(result).toEqual({ ok: false, reason: NOT_ON_PATH });
    expect(JSON.stringify(result)).not.toContain('7731');
  });

  it('refuses when PATH is empty or not set', async () => {
    expect((await resolveProgram(filesOf('tool.EXE'), 'tool', {}, 'win32')).ok).toBe(false);
    expect((await resolveProgram(filesOf('tool.EXE'), 'tool', { PATH: '' }, 'win32')).ok).toBe(
      false,
    );
  });
});

describe('resolveProgram: PATH on POSIX (files as a parameter)', () => {
  it('finds a bare name in PATH folders, in order, with no extension added', async () => {
    const env = { PATH: '/x:/y' };
    expect(await resolveProgram(filesOf('/y/tool'), 'tool', env, 'linux')).toEqual({
      ok: true,
      file: '/y/tool',
    });
    expect(await resolveProgram(filesOf('/x/tool.cmd'), 'tool', env, 'linux')).toEqual({
      ok: false,
      reason: NOT_ON_PATH,
    });
  });

  it('checks a program that has a separator as a path, without searching PATH', async () => {
    expect(
      await resolveProgram(filesOf('/opt/bin/tool'), '/opt/bin/tool', { PATH: '/x' }, 'linux'),
    ).toEqual({ ok: true, file: '/opt/bin/tool' });
    expect(
      await resolveProgram(filesOf('/x/tool'), '/opt/bin/tool', { PATH: '/x' }, 'linux'),
    ).toEqual({
      ok: false,
      reason: NOT_ON_PATH,
    });
  });

  it('refuses an empty program', async () => {
    expect(await resolveProgram(filesOf('/x/'), '', { PATH: '/x' }, 'linux')).toEqual({
      ok: false,
      reason: NOT_ON_PATH,
    });
  });
});

describe('resolveProgram: the real file check on POSIX', () => {
  let base: string;

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), 'command-lookup-'));
    mkdirSync(join(base, 'bin'));
    writeFileSync(join(base, 'bin', 'tool'), '#!/bin/sh\n');
    chmodSync(join(base, 'bin', 'tool'), 0o755);
    writeFileSync(join(base, 'bin', 'plain'), 'text');
    chmodSync(join(base, 'bin', 'plain'), 0o644);
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it.skipIf(process.platform === 'win32')(
    'finds an executable file and not a plain one',
    async () => {
      const env = { PATH: join(base, 'bin') };
      expect(
        await resolveProgram(toolEnvironment(localEnvironment()), 'tool', env, 'linux'),
      ).toEqual({
        ok: true,
        file: join(base, 'bin', 'tool'),
      });
      expect(
        await resolveProgram(toolEnvironment(localEnvironment()), 'plain', env, 'linux'),
      ).toEqual({
        ok: false,
        reason: NOT_ON_PATH,
      });
    },
  );
});

describe('cmdLineFor: the cmd.exe line', () => {
  it('quotes the resolved file and joins safe tokens with single spaces', () => {
    expect(cmdLineFor('C:\\tools\\pnpm.cmd', ['run', 'test'])).toEqual({
      ok: true,
      line: '""C:\\tools\\pnpm.cmd" run test"',
    });
    expect(cmdLineFor('C:\\tools\\pnpm.cmd', [])).toEqual({
      ok: true,
      line: '""C:\\tools\\pnpm.cmd""',
    });
  });

  it('accepts a resolved path with spaces and tokens with dots, slashes, colons and dashes', () => {
    expect(
      cmdLineFor('C:\\Program Files\\node\\tool.bat', ['./...', '-m', 'pytest', 'a:b_c-d']),
    ).toEqual({
      ok: true,
      line: '""C:\\Program Files\\node\\tool.bat" ./... -m pytest a:b_c-d"',
    });
  });

  it.each([
    ['a token with a space', ['a b']],
    ['a token with &', ['a&b']],
    ['a token with |', ['a|b']],
    ['a token with %', ['%PATH%']],
    ['a token with !', ['a!b']],
    ['a token with ^', ['a^b']],
    ['a token with quotes', ['"x"']],
    ['a token with parentheses', ['(x)']],
    ['a token with <', ['a<b']],
    ['a token with >', ['a>b']],
    ['a token with a newline', ['a\nb']],
    ['an empty token', ['']],
    ['a token with $', ['$HOME']],
  ])('refuses %s', (_label, args) => {
    expect(cmdLineFor('C:\\tools\\pnpm.cmd', args)).toEqual({
      ok: false,
      reason: UNSAFE_CMD_LINE,
    });
  });

  it.each([
    'C:\\a&b\\x.cmd',
    'C:\\a%b\\x.cmd',
    'C:\\a!b\\x.cmd',
    'C:\\a^b\\x.cmd',
    'C:\\a"b\\x.cmd',
  ])('refuses a resolved path with a cmd metacharacter: %s', (file) => {
    expect(cmdLineFor(file, ['test'])).toEqual({ ok: false, reason: UNSAFE_CMD_LINE });
  });

  it.each([
    'C:\\a|b\\x.cmd',
    'C:\\a<b\\x.cmd',
    'C:\\a>b\\x.cmd',
    'C:\\a(b)\\x.cmd',
    'C:\\a\nb.cmd',
  ])('refuses a resolved path with a pipe, redirect, parenthesis or newline: %j', (file) => {
    expect(cmdLineFor(file, [])).toEqual({ ok: false, reason: UNSAFE_CMD_LINE });
  });

  it('does not echo the refused text in the reason', () => {
    const result = cmdLineFor('C:\\tools\\pnpm.cmd', ['SENTINEL-ARG-5d&x']);
    expect(JSON.stringify(result)).not.toContain('SENTINEL');
  });
});

describe('cmdExeFor and isCommandScript', () => {
  it('finds cmd.exe under the SystemRoot the minimal environment gives', () => {
    expect(cmdExeFor({ SystemRoot: 'D:\\Win' })).toBe('D:\\Win\\System32\\cmd.exe');
    expect(cmdExeFor({ systemroot: 'D:\\Win2' })).toBe('D:\\Win2\\System32\\cmd.exe');
    expect(cmdExeFor({})).toBe('C:\\Windows\\System32\\cmd.exe');
  });

  it('treats .cmd and .bat in any case as scripts, and other files as not', () => {
    expect(isCommandScript('C:\\x\\pnpm.cmd')).toBe(true);
    expect(isCommandScript('C:\\x\\tool.BAT')).toBe(true);
    expect(isCommandScript('C:\\x\\node.exe')).toBe(false);
    expect(isCommandScript('/usr/bin/tool')).toBe(false);
  });
});

describe('runCommandInRoot on Windows: a .cmd stub through cmd.exe', () => {
  let base: string;
  let root: string;
  let bin: string;
  const allow = { job: 'writer' as const, check: () => ({ allow: true as const }) };

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), 'command-stub-'));
    root = join(base, 'root');
    bin = join(base, 'bin');
    mkdirSync(root);
    mkdirSync(bin);
    writeFileSync(join(bin, 'stub.cmd'), '@echo off\r\necho stub-ran %1 %2\r\n');
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  /** The parent environment with the stub's folder first on PATH. */
  function envWithStubFirst(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    const key = Object.keys(env).find((name) => name.toUpperCase() === 'PATH') ?? 'PATH';
    env[key] = `${bin};${env[key] ?? ''}`;
    return env;
  }

  it.skipIf(process.platform !== 'win32')(
    'runs an allowlisted stub that resolves to a .cmd and returns its output',
    async () => {
      const result = await runCommandInRoot(
        toolEnvironment(localEnvironment()),
        root,
        { program: 'stub', args: ['alpha', 'beta-1'] },
        allow,
        { parentEnv: envWithStubFirst() },
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.output).toContain('stub-ran alpha beta-1');
    },
  );

  it.skipIf(process.platform !== 'win32')(
    'runs a .cmd stub whose folder path has a space, through cmd.exe',
    async () => {
      const spaced = join(base, 'bin with space');
      mkdirSync(spaced);
      writeFileSync(join(spaced, 'spaced.cmd'), '@echo off\r\necho spaced-ran %1\r\n');
      const env: NodeJS.ProcessEnv = { ...process.env };
      const key = Object.keys(env).find((name) => name.toUpperCase() === 'PATH') ?? 'PATH';
      env[key] = `${spaced};${env[key] ?? ''}`;
      const result = await runCommandInRoot(
        toolEnvironment(localEnvironment()),
        root,
        { program: 'spaced', args: ['gamma'] },
        allow,
        {
          parentEnv: env,
        },
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.output).toContain('spaced-ran gamma');
    },
  );

  it.skipIf(process.platform !== 'win32')(
    'refuses an unsafe argument for the .cmd stub before anything starts',
    async () => {
      const result = await runCommandInRoot(
        toolEnvironment(localEnvironment()),
        root,
        { program: 'stub', args: ['a&calc'] },
        allow,
        {
          parentEnv: envWithStubFirst(),
        },
      );
      expect(result).toEqual({ ok: false, reason: UNSAFE_CMD_LINE });
    },
  );
});
