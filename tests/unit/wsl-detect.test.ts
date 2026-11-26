import { describe, expect, it, vi } from 'vitest';

// WSL detection (D42, p4-env-wsl, AC1). The program run is injected, so no wsl.exe starts. The
// execFile of node:child_process is replaced by a mock, which shows that importing the module runs
// nothing, and that the default run uses an argument array with no shell.

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFile: execFileMock };
});

import {
  detectWsl,
  isDistributionName,
  parseWslList,
  type ProgramRun,
} from '../../src/main/env/wsl-detect';

// Nothing ran when the module was imported above (no top-level call, no program start).
const callsAtImport = execFileMock.mock.calls.length;

/** The list as wsl.exe writes it: UTF-16LE, with CRLF line ends and no byte order mark. */
const LIST = [
  '  NAME            STATE           VERSION',
  '* Ubuntu          Running         2',
  '  Debian          Stopped         1',
  '  bad name!       Stopped         2',
  '  -leading        Running         2',
  '',
].join('\r\n');

const LIST_BYTES = Buffer.from(LIST, 'utf16le');

function runReturning(stdout: Buffer): ProgramRun {
  return vi.fn(async () => ({ ok: true as const, stdout }));
}

describe('detectWsl parses the list (AC1)', () => {
  it('reads UTF-16LE output into names, versions and the default', async () => {
    const info = await detectWsl({ platform: 'win32', run: runReturning(LIST_BYTES) });
    expect(info).toEqual({
      installed: true,
      distributions: [
        { name: 'Ubuntu', version: 2, isDefault: true },
        { name: 'Debian', version: 1, isDefault: false },
      ],
    });
  });

  it('drops a name that fails isDistributionName', () => {
    const names = parseWslList(LIST_BYTES).map((distribution) => distribution.name);
    expect(names).toEqual(['Ubuntu', 'Debian']);
  });

  it('runs wsl.exe --list --verbose with an argument array and a timeout', async () => {
    const run = runReturning(LIST_BYTES);
    await detectWsl({ platform: 'win32', run });
    expect(run).toHaveBeenCalledWith(
      'wsl.exe',
      ['--list', '--verbose'],
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
  });

  it('gives installed with no distributions when the list is empty', async () => {
    const info = await detectWsl({
      platform: 'win32',
      run: runReturning(Buffer.from('', 'utf16le')),
    });
    expect(info).toEqual({ installed: true, distributions: [] });
  });
});

describe('detectWsl says not installed (AC1)', () => {
  it('is not installed off Windows, and runs nothing there', async () => {
    const run = vi.fn();
    expect(await detectWsl({ platform: 'linux', run })).toEqual({ installed: false });
    expect(await detectWsl({ platform: 'darwin', run })).toEqual({ installed: false });
    expect(run).not.toHaveBeenCalled();
  });

  it('is not installed when wsl.exe is missing', async () => {
    const run: ProgramRun = async () => ({ ok: false });
    expect(await detectWsl({ platform: 'win32', run })).toEqual({ installed: false });
  });

  it('is not installed when the call exits with a failure', async () => {
    const run: ProgramRun = async () => ({ ok: false });
    expect(await detectWsl({ platform: 'win32', run })).toEqual({ installed: false });
  });

  it('is not installed when the call times out', async () => {
    const run: ProgramRun = async () => ({ ok: false });
    expect(await detectWsl({ platform: 'win32', run })).toEqual({ installed: false });
  });

  it('never throws, even when the run itself throws', async () => {
    const run: ProgramRun = async () => {
      throw new Error('boom');
    };
    expect(await detectWsl({ platform: 'win32', run })).toEqual({ installed: false });
  });

  it('uses the default run when none is injected: no shell, and a failed start is not installed', async () => {
    execFileMock.mockImplementationOnce(
      (_file: string, _argv: string[], _options: object, callback: (error: Error) => void) => {
        callback(Object.assign(new Error('spawn wsl.exe ENOENT'), { code: 'ENOENT' }));
      },
    );
    expect(await detectWsl({ platform: 'win32' })).toEqual({ installed: false });
    expect(execFileMock).toHaveBeenCalledWith(
      'wsl.exe',
      ['--list', '--verbose'],
      expect.objectContaining({ shell: false }),
      expect.any(Function),
    );
  });

  it('uses the default run and parses its output when it succeeds', async () => {
    execFileMock.mockImplementationOnce(
      (
        _file: string,
        _argv: string[],
        _options: object,
        callback: (error: null, out: Buffer) => void,
      ) => {
        callback(null, LIST_BYTES);
      },
    );
    const info = await detectWsl({ platform: 'win32' });
    expect(info).toMatchObject({ installed: true });
  });
});

describe('isDistributionName (D42)', () => {
  it('accepts names of letters, digits, dot, underscore and dash, up to 64 characters', () => {
    expect(isDistributionName('Ubuntu')).toBe(true);
    expect(isDistributionName('Ubuntu-22.04')).toBe(true);
    expect(isDistributionName('a_b')).toBe(true);
    expect(isDistributionName('a'.repeat(64))).toBe(true);
  });

  it('refuses an empty name, a leading dash or dot, a space, a slash, and one over 64 characters', () => {
    expect(isDistributionName('')).toBe(false);
    expect(isDistributionName('-a')).toBe(false);
    expect(isDistributionName('.a')).toBe(false);
    expect(isDistributionName('a b')).toBe(false);
    expect(isDistributionName('a/b')).toBe(false);
    expect(isDistributionName('a'.repeat(65))).toBe(false);
  });

  it('refuses a value that is not a string', () => {
    expect(isDistributionName(undefined)).toBe(false);
    expect(isDistributionName(12)).toBe(false);
  });
});

describe('the module runs nothing at import (AC1)', () => {
  it('no program was started when the module was imported', () => {
    expect(callsAtImport).toBe(0);
  });
});
