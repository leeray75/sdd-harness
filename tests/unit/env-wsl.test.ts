import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  environmentFor,
  localEnvironment,
  UNSUPPORTED_ENVIRONMENT,
  WSL_UNAVAILABLE,
} from '../../src/main/env';
import { createWslEnvironment, WSL_LAUNCHER } from '../../src/main/env/wsl';
import type { Environment } from '../../src/main/env/types';
import {
  fakeWslTransport,
  GIT_MISSING_STDERR,
  type FakeTransport,
} from '../support/fake-wsl-transport';

// The WSL backend (D42, p4-env-wsl). Every check runs on a fake transport whose share root is a temp
// folder, so no wsl.exe starts. AC2 covers the path and the files part.

const DISTRO = 'Ubuntu';

let base: string;
let share: string;
let transport: FakeTransport;
let env: Environment;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'env-wsl-'));
  share = join(base, 'share');
  mkdirSync(share, { recursive: true });
  transport = fakeWslTransport(share);
  env = createWslEnvironment({ distribution: DISTRO, transport });
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

/** Writes a file at a Linux path, through the share, for a test's setup. */
function put(linux: string, text: string): void {
  const path = join(share, ...linux.split('/').filter((segment) => segment !== ''));
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

/** True when a Linux path exists in the share (a test's own check, not the backend's). */
function onShare(linux: string): string {
  return join(share, ...linux.split('/').filter((segment) => segment !== ''));
}

describe('the path part is path.posix (AC2)', () => {
  it('uses path.posix with the / separator', () => {
    expect(env.path).toBe(posix);
    expect(env.path.sep).toBe('/');
    expect(env.path.join('/home', 'u', 'project')).toBe('/home/u/project');
    expect(env.path.isAbsolute('/home/u')).toBe(true);
    expect(env.path.isAbsolute('C:\\x')).toBe(false);
  });

  it('reports the linux platform', () => {
    expect(env.process.platform).toBe('linux');
  });
});

describe('the files part works on the share (AC2)', () => {
  it('stats, lists, reads, writes, renames and removes through the share', async () => {
    put('/home/u/project/a.txt', 'hello');
    const info = await env.files.stat('/home/u/project/a.txt');
    expect(info.isFile()).toBe(true);
    expect(info.size).toBe(5);
    expect((await env.files.lstat('/home/u/project')).isDirectory()).toBe(true);
    await expect(env.files.access('/home/u/project/a.txt', 'exists')).resolves.toBeUndefined();
    expect((await env.files.readFile('/home/u/project/a.txt')).toString('utf8')).toBe('hello');
    expect((await env.files.readdir('/home/u/project')).map((entry) => entry.name)).toEqual([
      'a.txt',
    ]);

    await env.files.writeFile('/home/u/project/b.txt', 'bee');
    expect(readFileSync(onShare('/home/u/project/b.txt'), 'utf8')).toBe('bee');
    await env.files.rename('/home/u/project/b.txt', '/home/u/project/c.txt');
    expect(readFileSync(onShare('/home/u/project/c.txt'), 'utf8')).toBe('bee');
    await env.files.rm('/home/u/project/c.txt');
    await expect(env.files.stat('/home/u/project/c.txt')).rejects.toMatchObject({ code: 'ENOENT' });

    await env.files.mkdir('/home/u/project/sub/deeper', { recursive: true });
    await env.files.rmdir('/home/u/project/sub/deeper');
    await expect(env.files.stat('/home/u/project/sub/deeper')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('opens a file for reads by byte range', async () => {
    put('/data/bytes.bin', 'abcdef');
    const handle = await env.files.open('/data/bytes.bin', 'r');
    try {
      const buffer = Buffer.alloc(3);
      const result = await handle.read(buffer, 0, 3, 2);
      expect(result.bytesRead).toBe(3);
      expect(buffer.toString('utf8')).toBe('cde');
    } finally {
      await handle.close();
    }
  });

  it('realpath gives the Linux path of an existing file', async () => {
    put('/home/u/project/x.txt', 'x');
    expect(await env.files.realpath('/home/u/project/x.txt')).toBe('/home/u/project/x.txt');
  });

  it('refuses a path that is not absolute POSIX with ENOENT', async () => {
    await expect(env.files.stat('relative/path')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(env.files.readFile('C:\\home\\x')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses a segment with a backslash or a colon with ENOENT', async () => {
    await expect(env.files.stat('/home/a\\b')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(env.files.stat('/home/a:b')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('a dot-dot cannot climb out of the share', async () => {
    put('/outside-check.txt', 'in share');
    expect((await env.files.readFile('/home/../outside-check.txt')).toString('utf8')).toBe(
      'in share',
    );
    await expect(env.files.stat('/../../../../etc/passwd')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});

describe('the Node codes pass through unchanged (AC2)', () => {
  it('ENOENT for a missing path', async () => {
    await expect(env.files.stat('/nope')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('ENOTDIR when a file is listed as a folder', async () => {
    put('/data/file.txt', 'x');
    await expect(env.files.readdir('/data/file.txt')).rejects.toMatchObject({ code: 'ENOTDIR' });
  });

  it('EISDIR when a folder is read as a file', async () => {
    mkdirSync(onShare('/data/folder'), { recursive: true });
    await expect(env.files.readFile('/data/folder')).rejects.toMatchObject({ code: 'EISDIR' });
  });

  it('EEXIST when a file is written with the exclusive flag over an existing one', async () => {
    put('/data/exists.txt', 'old');
    await expect(
      env.files.writeFile('/data/exists.txt', 'new', { flag: 'wx' }),
    ).rejects.toMatchObject({ code: 'EEXIST' });
  });

  it('ENOTEMPTY when a folder with entries is removed', async () => {
    put('/data/full/entry.txt', 'x');
    await expect(env.files.rmdir('/data/full')).rejects.toMatchObject({ code: 'ENOTEMPTY' });
  });
});

describe('the byte cap refuses before any read (AC2)', () => {
  it('refuses a larger file with EFBIG, and returns no bytes', async () => {
    put('/data/big.txt', 'x'.repeat(100));
    await expect(env.files.readFile('/data/big.txt', { maxBytes: 10 })).rejects.toMatchObject({
      code: 'EFBIG',
    });
  });

  it('reads a file within the cap', async () => {
    put('/data/small.txt', 'hello');
    expect((await env.files.readFile('/data/small.txt', { maxBytes: 10 })).toString('utf8')).toBe(
      'hello',
    );
  });
});

describe('symlink and chmod run a fixed command through the transport (AC2)', () => {
  it('symlink sends ln -s -- <target> <path> through the transport, with no shell', async () => {
    put('/home/u/project/real.txt', 'x');
    await env.files.symlink('real.txt', '/home/u/project/link.txt');
    const call = transport.calls.find((entry) => entry.argv.includes('ln'));
    expect(call?.argv).toEqual([
      '-d',
      DISTRO,
      '--exec',
      'ln',
      '-s',
      '--',
      'real.txt',
      '/home/u/project/link.txt',
    ]);
  });

  it('symlink maps a path that exists to EEXIST', async () => {
    put('/home/u/project/taken.txt', 'x');
    await expect(env.files.symlink('x', '/home/u/project/taken.txt')).rejects.toMatchObject({
      code: 'EEXIST',
    });
  });

  it('symlink maps a missing folder to ENOENT', async () => {
    await expect(env.files.symlink('x', '/no/such/folder/link')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('symlink maps any other failure to EIO', async () => {
    transport.script = { cannotStart: true };
    mkdirSync(onShare('/home/u/project'), { recursive: true });
    await expect(env.files.symlink('x', '/home/u/project/new-link')).rejects.toMatchObject({
      code: 'EIO',
    });
  });

  it('chmod sends chmod <octal> -- <path> through the transport', async () => {
    put('/home/u/project/run.sh', '#!/bin/sh\n');
    await env.files.chmod('/home/u/project/run.sh', 0o755);
    const call = transport.calls.find((entry) => entry.argv.includes('chmod'));
    expect(call?.argv).toEqual([
      '-d',
      DISTRO,
      '--exec',
      'chmod',
      '755',
      '--',
      '/home/u/project/run.sh',
    ]);
  });

  it('chmod maps a missing path to ENOENT', async () => {
    await expect(env.files.chmod('/home/u/missing.sh', 0o755)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});

/** Whether this machine can make a symbolic link on the temp folder (Windows needs developer mode). */
function canMakeSymlink(): boolean {
  const probe = mkdtempSync(join(tmpdir(), 'env-wsl-probe-'));
  try {
    mkdirSync(join(probe, 'target'));
    symlinkSync(join(probe, 'target'), join(probe, 'link'), 'dir');
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}

describe('readlink and realpath map results back to Linux paths (AC2)', () => {
  it.skipIf(!canMakeSymlink())('a result outside the share gives ENOENT', async () => {
    const outside = join(base, 'outside');
    mkdirSync(outside, { recursive: true });
    mkdirSync(onShare('/home/u'), { recursive: true });
    symlinkSync(outside, onShare('/home/u/escape'), 'dir');
    await expect(env.files.realpath('/home/u/escape')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.skipIf(!canMakeSymlink())('readlink gives the Linux form of a share target', async () => {
    mkdirSync(onShare('/home/u/data'), { recursive: true });
    symlinkSync(onShare('/home/u/data'), onShare('/home/u/alias'), 'dir');
    expect(await env.files.readlink('/home/u/alias')).toBe('/home/u/data');
  });
});

/** Wraps the transport's run so a test can keep the output callback of a launched program. */
function captureOutput(): { callback: () => ((chunk: Buffer) => void) | undefined } {
  let found: ((chunk: Buffer) => void) | undefined;
  const original = transport.run;
  transport.run = (argv, options) => {
    if (argv.includes(WSL_LAUNCHER)) found = options.onOutput;
    return original(argv, options);
  };
  return { callback: () => found };
}

/** The calls the probe made (the unshare probe, not a launched program). */
function probeCalls(): number {
  return transport.calls.filter((call) => call.argv[call.argv.indexOf('--exec') + 1] === 'unshare')
    .length;
}

/** The argument array a launched program got, from the launcher's positional arguments. */
function programArgvOf(argv: readonly string[]): string[] {
  const at = argv.indexOf(WSL_LAUNCHER);
  return argv.slice(at + 2);
}

const ARGS = ['a b', '$HOME', 'x;y', "q'uote", '"dq"'];

describe('the process part: argv, WSLENV and the launcher (AC3)', () => {
  it('starts the launcher with every argument as its own element, unchanged', async () => {
    let received: readonly string[] = [];
    transport.script = {
      program: (argv) => {
        received = argv;
        return { code: 0 };
      },
    };
    const outcome = await env.process.spawn('/home/u/bin/tool', ARGS, {
      cwd: '/home/u/project',
      env: { MY_FLAG: 'on' },
      timeoutMs: 5_000,
      network: 'normal',
    });
    expect(outcome).toEqual({
      started: true,
      code: 0,
      signal: null,
      timedOut: false,
      aborted: false,
    });
    const argv = transport.calls[0]?.argv ?? [];
    expect(argv.slice(0, 9)).toEqual([
      '-d',
      DISTRO,
      '--cd',
      '/home/u/project',
      '--exec',
      'sh',
      '-c',
      WSL_LAUNCHER,
      'sh',
    ]);
    expect(argv.slice(9)).toEqual(['/home/u/bin/tool', ...ARGS]);
    expect(received).toEqual(['/home/u/bin/tool', ...ARGS]);
  });

  it('sends only changed variables through WSLENV, never PATH, and no value in argv', async () => {
    const same = Object.keys(process.env).find(
      (name) => /^[A-Za-z_]\w*$/.test(name) && name !== 'PATH',
    );
    const env2: Record<string, string> = {
      MY_FLAG: 'secret-value-on',
      PATH: 'C:\\should-not-cross',
    };
    if (same !== undefined && process.env[same] !== undefined) env2[same] = process.env[same];
    await env.process.spawn('/home/u/bin/tool', ['run'], {
      cwd: '/home/u/project',
      env: env2,
      timeoutMs: 5_000,
      network: 'normal',
    });
    const call = transport.calls[0];
    const names = (call?.env['WSLENV'] ?? '').split(':');
    expect(names).toContain('MY_FLAG');
    expect(names).not.toContain('PATH');
    expect(names).not.toContain('Path');
    if (same !== undefined) expect(names).not.toContain(same);
    expect(call?.env['MY_FLAG']).toBe('secret-value-on');
    for (const value of ['secret-value-on', 'C:\\should-not-cross']) {
      expect(call?.argv.some((arg) => arg.includes(value))).toBe(false);
    }
  });

  it('withholds the marker line from onOutput, and passes the program output', async () => {
    transport.script = { program: () => ({ code: 0, chunks: ['hello ', 'world\n'] }) };
    const chunks: Buffer[] = [];
    await env.process.spawn('/home/u/bin/tool', [], {
      cwd: '/home/u/project',
      env: {},
      timeoutMs: 5_000,
      network: 'normal',
      onOutput: (chunk) => chunks.push(chunk),
    });
    const text = Buffer.concat(chunks).toString('utf8');
    expect(text).toBe('hello world\n');
    expect(text).not.toContain('SDD-GROUP');
  });

  it('returns the exit code of the program', async () => {
    transport.script = { program: () => ({ code: 7 }) };
    const outcome = await env.process.spawn('/home/u/bin/tool', [], {
      cwd: '/home/u/project',
      env: {},
      timeoutMs: 5_000,
      network: 'normal',
    });
    expect(outcome).toMatchObject({ started: true, code: 7, timedOut: false, aborted: false });
  });

  it('refuses a working folder that is not an absolute POSIX path, with started false', async () => {
    const outcome = await env.process.spawn('/home/u/bin/tool', [], {
      cwd: 'C:\\project',
      env: {},
      timeoutMs: 5_000,
      network: 'normal',
    });
    expect(outcome).toEqual({ started: false });
    expect(transport.calls).toHaveLength(0);
  });

  it('a transport that cannot start gives started false', async () => {
    transport.script = { cannotStart: true };
    const outcome = await env.process.spawn('/home/u/bin/tool', [], {
      cwd: '/home/u/project',
      env: {},
      timeoutMs: 5_000,
      network: 'normal',
    });
    expect(outcome).toEqual({ started: false });
  });
});

describe('watch: a poll of one folder (AC4)', () => {
  /** A backend that polls every few milliseconds, so the tests stay quick. */
  function fastEnv(): Environment {
    return createWslEnvironment({ distribution: DISTRO, transport, pollMs: 5 });
  }

  /** Waits until a check holds, or fails after a few seconds. */
  async function waitUntil(check: () => boolean): Promise<void> {
    const end = Date.now() + 4_000;
    while (!check()) {
      if (Date.now() > end) throw new Error('the condition did not hold in time');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  /** Lets the poll run a few times with nothing changing. */
  function settle(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 60));
  }

  it('reports added, removed and changed files, and nothing from a subfolder', async () => {
    put('/w/keep.txt', 'a');
    mkdirSync(onShare('/w/sub'), { recursive: true });
    const events: Array<[string, string | null]> = [];
    const handle = fastEnv().watch.watchDir(
      '/w',
      (type, name) => events.push([type, name]),
      () => undefined,
    );
    await settle();
    put('/w/new.txt', 'n');
    await waitUntil(() => events.some(([type, name]) => type === 'rename' && name === 'new.txt'));
    writeFileSync(onShare('/w/keep.txt'), 'a longer text');
    await waitUntil(() => events.some(([type, name]) => type === 'change' && name === 'keep.txt'));
    rmSync(onShare('/w/new.txt'));
    await waitUntil(() => events.filter(([, name]) => name === 'new.txt').length === 2);
    writeFileSync(onShare('/w/sub/inner.txt'), 'inside the subfolder');
    await settle();
    handle.close();
    expect(events.some(([, name]) => name === 'inner.txt' || name === 'sub')).toBe(false);
  });

  it('reports nothing for the first listing', async () => {
    put('/w2/one.txt', '1');
    put('/w2/two.txt', '2');
    const events: string[] = [];
    const handle = fastEnv().watch.watchDir(
      '/w2',
      (type) => events.push(type),
      () => undefined,
    );
    await settle();
    handle.close();
    expect(events).toEqual([]);
  });

  it('calls onError once for each run of failing listings, and the polling goes on', async () => {
    const errors: NodeJS.ErrnoException[] = [];
    const events: string[] = [];
    const handle = fastEnv().watch.watchDir(
      '/gone',
      (type) => events.push(type),
      (error) => errors.push(error as NodeJS.ErrnoException),
    );
    await waitUntil(() => errors.length === 1);
    await settle();
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('ENOENT');
    // The folder comes back: the polling goes on, and a file that appears in it is reported as added.
    put('/gone/back.txt', 'back');
    await settle();
    put('/gone/second.txt', 'second');
    await waitUntil(() => events.includes('rename'));
    rmSync(onShare('/gone'), { recursive: true, force: true });
    await waitUntil(() => errors.length === 2);
    handle.close();
    expect(errors).toHaveLength(2);
    expect(events.every((type) => type === 'rename')).toBe(true);
  });

  it('reports nothing after close()', async () => {
    put('/w3/a.txt', 'a');
    const events: string[] = [];
    const errors: Error[] = [];
    const handle = fastEnv().watch.watchDir(
      '/w3',
      (type) => events.push(type),
      (error) => errors.push(error),
    );
    await settle();
    handle.close();
    const before = events.length + errors.length;
    put('/w3/b.txt', 'b');
    rmSync(onShare('/w3/a.txt'));
    await settle();
    expect(events.length + errors.length).toBe(before);
  });
});

describe('timeout and abort kill the group before the result (AC3)', () => {
  it('on timeout, the group kill call is made before the result resolves, and nothing follows', async () => {
    transport.script = { program: () => ({ stall: true }), groupId: 4242 };
    const grab = captureOutput();
    const seen: Buffer[] = [];
    const outcome = await env.process.spawn('/home/u/bin/tool', [], {
      cwd: '/home/u/project',
      env: {},
      timeoutMs: 50,
      network: 'normal',
      onOutput: (chunk) => seen.push(chunk),
    });
    expect(outcome).toEqual({
      started: true,
      code: null,
      signal: null,
      timedOut: true,
      aborted: false,
    });
    const kill = transport.calls.find((call) => call.argv.includes('kill'));
    expect(kill?.argv).toEqual(['-d', DISTRO, '--exec', 'kill', '-KILL', '--', '-4242']);
    // Output that arrives after the stop is not passed on.
    grab.callback()?.(Buffer.from('late output'));
    expect(seen.map((chunk) => chunk.toString('utf8'))).not.toContain('late output');
  });

  it('on abort, the group is killed, the result says aborted, and late output is dropped', async () => {
    transport.script = { program: () => ({ stall: true }), groupId: 5150 };
    const controller = new AbortController();
    const seen: Buffer[] = [];
    const grab = captureOutput();
    const pending = env.process.spawn('/home/u/bin/tool', [], {
      cwd: '/home/u/project',
      env: {},
      timeoutMs: 60_000,
      network: 'normal',
      signal: controller.signal,
      onOutput: (chunk) => seen.push(chunk),
    });
    setTimeout(() => controller.abort(), 30);
    const outcome = await pending;
    expect(outcome).toMatchObject({ started: true, timedOut: false, aborted: true });
    const kill = transport.calls.find((call) => call.argv.includes('kill'));
    expect(kill?.argv.at(-1)).toBe('-5150');
    grab.callback()?.(Buffer.from('late output'));
    expect(seen.map((chunk) => chunk.toString('utf8'))).not.toContain('late output');
  });

  it('when the group id never arrived, the wsl.exe run is stopped and the call still resolves', async () => {
    transport.script = { program: () => ({ stall: true }), groupId: null };
    const outcome = await env.process.spawn('/home/u/bin/tool', [], {
      cwd: '/home/u/project',
      env: {},
      timeoutMs: 50,
      network: 'normal',
    });
    expect(outcome).toMatchObject({ started: true, timedOut: true });
    expect(transport.calls.some((call) => call.argv.includes('kill'))).toBe(false);
  });
});

describe('network none: the level and the probe (AC3)', () => {
  it('reports proxy-only when the probe fails, with the dead proxies crossing through WSLENV', async () => {
    transport.script = { probe: false };
    const outcome = await env.process.spawn('/home/u/bin/tool', [], {
      cwd: '/home/u/project',
      env: {},
      timeoutMs: 5_000,
      network: 'none',
    });
    expect(outcome).toMatchObject({ started: true, network: 'proxy-only' });
    const names = (transport.calls.at(-1)?.env['WSLENV'] ?? '').split(':');
    expect(names).toEqual(expect.arrayContaining(['HTTP_PROXY', 'GOPROXY', 'PIP_NO_INDEX']));
    expect(await env.process.networkLevel()).toBe('proxy-only');
  });

  it('reports os and wraps the program in unshare when the probe passes', async () => {
    transport.script = { probe: true };
    const outcome = await env.process.spawn('/home/u/bin/tool', ['x'], {
      cwd: '/home/u/project',
      env: {},
      timeoutMs: 5_000,
      network: 'none',
    });
    expect(outcome).toMatchObject({ started: true, network: 'os' });
    expect(programArgvOf(transport.calls.at(-1)?.argv ?? [])[0]).toBe('unshare');
    expect(await env.process.networkLevel()).toBe('os');
  });

  it('runs the probe once per backend', async () => {
    transport.script = { probe: true };
    await env.process.spawn('/home/u/bin/tool', [], {
      cwd: '/home/u/project',
      env: {},
      timeoutMs: 5_000,
      network: 'none',
    });
    await env.process.spawn('/home/u/bin/tool', [], {
      cwd: '/home/u/project',
      env: {},
      timeoutMs: 5_000,
      network: 'none',
    });
    await env.process.networkLevel();
    expect(probeCalls()).toBe(1);
  });
});

const ROOT = '/home/u/project';
const GIT_HEAD = ['-d', DISTRO, '--cd', ROOT, '--exec', 'git'];

/** The git calls the transport got, in order. */
function gitCalls(): { argv: readonly string[]; env: NodeJS.ProcessEnv }[] {
  return transport.calls
    .filter((call) => call.argv.includes('git'))
    .map((call) => ({ argv: call.argv, env: call.env }));
}

describe('git runs in the distribution with the local argument lists (AC5)', () => {
  it('currentBranch runs rev-parse through wsl.exe and parses the branch', async () => {
    transport.script = { git: () => ({ stdout: 'feature/x\n' }) };
    expect(await env.git.currentBranch(ROOT)).toEqual({ ok: true, value: { branch: 'feature/x' } });
    expect(gitCalls().at(-1)?.argv).toEqual([...GIT_HEAD, 'rev-parse', '--abbrev-ref', 'HEAD']);
  });

  it('defaultBranch reads origin/HEAD', async () => {
    transport.script = { git: () => ({ stdout: 'refs/remotes/origin/main\n' }) };
    expect(await env.git.defaultBranch(ROOT)).toEqual({ ok: true, value: 'main' });
    expect(gitCalls().at(-1)?.argv).toEqual([
      ...GIT_HEAD,
      'for-each-ref',
      '--format=%(symref)',
      'refs/remotes/origin/HEAD',
    ]);
  });

  it('changedPaths reads status and sorts the paths', async () => {
    transport.script = { git: () => ({ stdout: ' M b.txt\0?? a.txt\0' }) };
    expect(await env.git.changedPaths(ROOT)).toEqual({ ok: true, value: ['a.txt', 'b.txt'] });
    expect(gitCalls().at(-1)?.argv).toEqual([
      ...GIT_HEAD,
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
    ]);
  });

  it('stage adds the paths with literal pathspecs, and the git variables cross through WSLENV', async () => {
    expect(await env.git.stage(ROOT, ['a.txt'])).toEqual({ ok: true });
    const call = gitCalls().at(-1);
    expect(call?.argv).toEqual([...GIT_HEAD, 'add', '--all', '--', 'a.txt']);
    const names = (call?.env['WSLENV'] ?? '').split(':');
    expect(names).toEqual(
      expect.arrayContaining(['GIT_TERMINAL_PROMPT', 'GCM_INTERACTIVE', 'GIT_LITERAL_PATHSPECS']),
    );
    expect(call?.env['GIT_TERMINAL_PROMPT']).toBe('0');
    expect(call?.env['GCM_INTERACTIVE']).toBe('never');
  });

  it('commit passes the message as one argument', async () => {
    expect(await env.git.commit(ROOT, 'DEMO-1: a summary with spaces')).toEqual({ ok: true });
    expect(gitCalls().at(-1)?.argv).toEqual([
      ...GIT_HEAD,
      'commit',
      '-m',
      'DEMO-1: a summary with spaces',
    ]);
  });

  it('push sets the upstream on origin', async () => {
    expect(await env.git.push(ROOT, 'feature/x')).toEqual({ ok: true });
    expect(gitCalls().at(-1)?.argv).toEqual([
      ...GIT_HEAD,
      'push',
      '--set-upstream',
      'origin',
      'feature/x',
    ]);
  });

  it('aheadOfUpstream reads the branch and counts ahead from local refs', async () => {
    transport.script = {
      git: (args) => {
        if (args[0] === 'rev-parse') return { stdout: 'feature/x\n' };
        if (args[0] === 'for-each-ref') {
          return { stdout: 'refs/heads/feature/x\trefs/remotes/origin/feature/x\n' };
        }
        return { stdout: '2\n' };
      },
    };
    expect(await env.git.aheadOfUpstream(ROOT)).toEqual({
      ok: true,
      value: { upstream: true, ahead: 2 },
    });
    expect(gitCalls().at(-1)?.argv).toEqual([...GIT_HEAD, 'rev-list', '--count', '@{u}..HEAD']);
  });

  it('ignoredEntries runs ls-files with -C and parses the entries', async () => {
    transport.script = { git: () => ({ stdout: 'node_modules/\0dist/\0' }) };
    expect(await env.git.ignoredEntries(ROOT)).toEqual(new Set(['node_modules/', 'dist/']));
    expect(gitCalls().at(-1)?.argv).toEqual([
      ...GIT_HEAD,
      '-C',
      ROOT,
      'ls-files',
      '-z',
      '--others',
      '--ignored',
      '--exclude-standard',
      '--directory',
    ]);
  });

  it('git missing in the distribution gives git-missing', async () => {
    transport.script = { git: () => ({ code: 1, stderr: GIT_MISSING_STDERR }) };
    expect(await env.git.currentBranch(ROOT)).toEqual({ ok: false, code: 'git-missing' });
    expect(await env.git.ignoredEntries(ROOT)).toBeNull();
  });

  it('a stall gives timeout', async () => {
    transport.script = { git: () => ({ timedOut: true }) };
    expect(await env.git.currentBranch(ROOT)).toEqual({ ok: false, code: 'timeout' });
  });

  it('a folder that is not a repository gives not-a-repo, and other failures give failed', async () => {
    transport.script = {
      git: () => ({
        code: 128,
        stderr: 'fatal: not a git repository (or any parent up to mount point /mnt)\n',
      }),
    };
    expect(await env.git.currentBranch(ROOT)).toEqual({ ok: false, code: 'not-a-repo' });
    transport.script = { git: () => ({ code: 1, stderr: 'fatal: something else\n' }) };
    expect(await env.git.currentBranch(ROOT)).toEqual({ ok: false, code: 'failed' });
  });
});

describe('no throw and no fallback when the transport cannot start (AC6)', () => {
  /** A share root that cannot hold anything: its parent is a plain file, so every call on it fails. */
  function brokenBackend(): Environment {
    const blocker = join(base, 'blocker');
    writeFileSync(blocker, 'a file, not a folder');
    transport = fakeWslTransport(join(blocker, 'share'), { cannotStart: true });
    return createWslEnvironment({ distribution: DISTRO, transport });
  }

  it('every files method rejects with a Node code', async () => {
    const dead = brokenBackend();
    const attempts: Array<() => Promise<unknown>> = [
      () => dead.files.stat('/x'),
      () => dead.files.lstat('/x'),
      () => dead.files.realpath('/x'),
      () => dead.files.access('/x', 'exists'),
      () => dead.files.readFile('/x'),
      () => dead.files.open('/x', 'r'),
      () => dead.files.writeFile('/x/y', 'z'),
      () => dead.files.mkdir('/x/y'),
      () => dead.files.readdir('/x'),
      () => dead.files.rm('/x'),
      () => dead.files.rmdir('/x'),
      () => dead.files.rename('/x', '/y'),
      () => dead.files.chmod('/x', 0o644),
      () => dead.files.readlink('/x'),
      () => dead.files.symlink('t', '/x/link'),
    ];
    for (const attempt of attempts) {
      await expect(attempt()).rejects.toMatchObject({ code: expect.any(String) });
    }
  });

  it('spawn gives started false, and networkLevel gives proxy-only', async () => {
    const dead = brokenBackend();
    expect(
      await dead.process.spawn('/bin/true', [], {
        cwd: ROOT,
        env: {},
        timeoutMs: 1_000,
        network: 'normal',
      }),
    ).toEqual({ started: false });
    expect(await dead.process.networkLevel()).toBe('proxy-only');
  });

  it('every git operation gives a code, and nothing throws', async () => {
    const dead = brokenBackend();
    const results = [
      await dead.git.currentBranch(ROOT),
      await dead.git.defaultBranch(ROOT),
      await dead.git.changedPaths(ROOT),
      await dead.git.stage(ROOT, ['a.txt']),
      await dead.git.commit(ROOT, 'message'),
      await dead.git.push(ROOT, 'feature/x'),
      await dead.git.aheadOfUpstream(ROOT),
    ];
    for (const result of results) {
      expect(result.ok).toBe(false);
    }
    expect(await dead.git.ignoredEntries(ROOT)).toBeNull();
  });

  it('a watch on a missing share reports through onError, and nothing throws', async () => {
    const dead = brokenBackend();
    const errors: Error[] = [];
    const handle = dead.watch.watchDir(
      ROOT,
      () => undefined,
      (error) => errors.push(error),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    handle.close();
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  it('every call reached the transport, so nothing ran on the local backend', async () => {
    const dead = brokenBackend();
    await dead.git.currentBranch(ROOT);
    await dead.git.defaultBranch(ROOT);
    expect(transport.calls.length).toBeGreaterThanOrEqual(2);
    expect(transport.calls.every((call) => call.argv[0] === '-d' && call.argv[1] === DISTRO)).toBe(
      true,
    );
  });
});

describe('environmentFor builds the WSL backend on Windows only (AC7)', () => {
  it('builds the WSL backend on win32 with the injected transport for the distribution', async () => {
    const made: string[] = [];
    const result = environmentFor(
      { kind: 'wsl', distribution: DISTRO },
      {
        platform: 'win32',
        transportFor: (distribution) => {
          made.push(distribution);
          return transport;
        },
      },
    );
    expect(made).toEqual([DISTRO]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.env.path).toBe(posix);
    expect(result.env.process.platform).toBe('linux');
    await result.env.git.currentBranch('/home/u/project');
    expect(transport.calls.at(-1)?.argv.slice(0, 2)).toEqual(['-d', DISTRO]);
  });

  it('refuses WSL with the fixed reason off Windows, and builds no transport', () => {
    let built = false;
    for (const platform of ['linux', 'darwin'] as const) {
      const result = environmentFor(
        { kind: 'wsl', distribution: DISTRO },
        {
          platform,
          transportFor: () => {
            built = true;
            return transport;
          },
        },
      );
      expect(result).toEqual({ ok: false, reason: WSL_UNAVAILABLE });
    }
    expect(built).toBe(false);
  });

  it('refuses a bad or missing distribution name with UNSUPPORTED_ENVIRONMENT, and echoes nothing', () => {
    const deps = { platform: 'win32' as const, transportFor: () => transport };
    for (const descriptor of [
      { kind: 'wsl', distribution: '-bad name' },
      { kind: 'wsl', distribution: '' },
      { kind: 'wsl' },
      { kind: 'wsl', distribution: 42 },
    ]) {
      const result = environmentFor(descriptor, deps);
      expect(result).toEqual({ ok: false, reason: UNSUPPORTED_ENVIRONMENT });
      expect(JSON.stringify(result)).not.toContain('bad name');
    }
  });

  it('keeps the local kind unchanged, and refuses an unknown kind', () => {
    expect(environmentFor({ kind: 'local' })).toEqual({ ok: true, env: localEnvironment() });
    expect(environmentFor({ kind: 'ssh' })).toEqual({ ok: false, reason: UNSUPPORTED_ENVIRONMENT });
  });
});
