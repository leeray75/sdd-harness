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
import { runCommandInRoot } from '../../src/main/tools/run-command';

/** A probe that says a file exists when it is in the set. The lookup never touches the disk then. */
function filesOf(...paths: string[]): (file: string) => boolean {
  const set = new Set(paths);
  return (file) => set.has(file);
}

describe('resolveProgram: PATH order on win32 (probe as a parameter)', () => {
  it('finds a program in the second folder of PATH, with a PATHEXT extension', () => {
    const env = { PATH: 'C:\\a;C:\\b' };
    expect(resolveProgram('pnpm', env, 'win32', filesOf('C:\\b\\pnpm.CMD'))).toEqual({
      ok: true,
      file: 'C:\\b\\pnpm.CMD',
    });
  });

  it('tries each PATHEXT extension in a folder before the name as given', () => {
    const env = { PATH: 'C:\\a' };
    const found = resolveProgram('pnpm', env, 'win32', filesOf('C:\\a\\pnpm', 'C:\\a\\pnpm.CMD'));
    expect(found).toEqual({ ok: true, file: 'C:\\a\\pnpm.CMD' });
  });

  it('uses the default PATHEXT when PATHEXT is not set', () => {
    expect(resolveProgram('node', { PATH: 'C:\\n' }, 'win32', filesOf('C:\\n\\node.EXE'))).toEqual({
      ok: true,
      file: 'C:\\n\\node.EXE',
    });
  });

  it('uses the PATHEXT it is given, and not the default', () => {
    const env = { PATH: 'C:\\a', PATHEXT: '.PS1' };
    expect(resolveProgram('tool', env, 'win32', filesOf('C:\\a\\tool.CMD'))).toEqual({
      ok: false,
      reason: NOT_ON_PATH,
    });
    expect(resolveProgram('tool', env, 'win32', filesOf('C:\\a\\tool.PS1'))).toEqual({
      ok: true,
      file: 'C:\\a\\tool.PS1',
    });
  });

  it('matches the PATH variable whatever the case of its name', () => {
    expect(resolveProgram('tool', { Path: 'C:\\a' }, 'win32', filesOf('C:\\a\\tool.EXE'))).toEqual({
      ok: true,
      file: 'C:\\a\\tool.EXE',
    });
  });

  it('refuses a program that is not on PATH, with the fixed reason and no name', () => {
    const result = resolveProgram('missing-7731', { PATH: 'C:\\a' }, 'win32', filesOf());
    expect(result).toEqual({ ok: false, reason: NOT_ON_PATH });
    expect(JSON.stringify(result)).not.toContain('7731');
  });

  it('refuses when PATH is empty or not set', () => {
    expect(resolveProgram('tool', {}, 'win32', filesOf('tool.EXE')).ok).toBe(false);
    expect(resolveProgram('tool', { PATH: '' }, 'win32', filesOf('tool.EXE')).ok).toBe(false);
  });
});

describe('resolveProgram: PATH on POSIX (probe as a parameter)', () => {
  it('finds a bare name in PATH folders, in order, with no extension added', () => {
    const env = { PATH: '/x:/y' };
    expect(resolveProgram('tool', env, 'linux', filesOf('/y/tool'))).toEqual({
      ok: true,
      file: '/y/tool',
    });
    expect(resolveProgram('tool', env, 'linux', filesOf('/x/tool.cmd'))).toEqual({
      ok: false,
      reason: NOT_ON_PATH,
    });
  });

  it('checks a program that has a separator as a path, without searching PATH', () => {
    expect(
      resolveProgram('/opt/bin/tool', { PATH: '/x' }, 'linux', filesOf('/opt/bin/tool')),
    ).toEqual({ ok: true, file: '/opt/bin/tool' });
    expect(resolveProgram('/opt/bin/tool', { PATH: '/x' }, 'linux', filesOf('/x/tool'))).toEqual({
      ok: false,
      reason: NOT_ON_PATH,
    });
  });

  it('refuses an empty program', () => {
    expect(resolveProgram('', { PATH: '/x' }, 'linux', filesOf('/x/'))).toEqual({
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

  it.skipIf(process.platform === 'win32')('finds an executable file and not a plain one', () => {
    const env = { PATH: join(base, 'bin') };
    expect(resolveProgram('tool', env, 'linux')).toEqual({
      ok: true,
      file: join(base, 'bin', 'tool'),
    });
    expect(resolveProgram('plain', env, 'linux')).toEqual({ ok: false, reason: NOT_ON_PATH });
  });
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
      const result = await runCommandInRoot(root, { program: 'spaced', args: ['gamma'] }, allow, {
        parentEnv: env,
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.output).toContain('spaced-ran gamma');
    },
  );

  it.skipIf(process.platform !== 'win32')(
    'refuses an unsafe argument for the .cmd stub before anything starts',
    async () => {
      const result = await runCommandInRoot(root, { program: 'stub', args: ['a&calc'] }, allow, {
        parentEnv: envWithStubFirst(),
      });
      expect(result).toEqual({ ok: false, reason: UNSAFE_CMD_LINE });
    },
  );
});
