import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fsp, realpathSync } from 'node:fs';
import { isAbsolute, join, posix, relative, sep } from 'node:path';
import { GROUP_MARKER, LAUNCHER } from '../../src/main/env/launcher';
import type {
  ConnectFailure,
  ConnectResult,
  SftpAttributes,
  SftpEntry,
  SftpError,
  SftpFile,
  SshExecOptions,
  SshExecResult,
  SshSftp,
  SshTransport,
  SystemPlatform,
} from '../../src/main/env/ssh-transport';
import type { ConnectionState } from '../../src/main/env/types';
import { splitWords } from './posix-words';

// A fake SSH transport (D43, p4-env-ssh, T6). It never opens a connection. Its SFTP calls act on a temp
// folder that stands for the remote `/`, and each one rejects with `ENOTCONN` while the session is down. Its
// exec requests accept only the command shapes the backend builds: the words are read by the test's own
// splitter and never run by a shell. A launched program runs locally, in the mapped folder, with the
// variables it was given; its first output line is the group marker, and a kill of that group stops it.
// Every exec string is recorded, in order.

/** One exec request as the backend sent it. */
export interface FakeExecCall {
  command: string;
  timeoutMs: number;
}

/** What the fake server answers. Every field has a default that matches a Linux server. */
export interface FakeSshScript {
  /** The connect fails with this code and the session stays down. */
  connectFailure?: ConnectFailure;
  /** The fingerprint a host key failure offers (a public value). */
  fingerprint?: string;
  /** The output of `uname -s` at connect. Default `Linux`. */
  uname?: string;
  /** The signed-in user's uid and group ids. Defaults 1000 and [1000]. */
  uid?: number;
  gids?: number[];
  /** Whether the posix-rename extension is offered. Default true. */
  posixRename?: boolean;
  /** Whether the unshare probe passes. Default false. */
  probe?: boolean;
  /** When true, every launched program stalls until it is killed or its channel closes. */
  stall?: boolean;
  /** When true, git is not installed on the server: a launched git exits 127 with the shell's message. */
  noGit?: boolean;
  /**
   * The answer for a launched program, given its file and arguments: its output chunks and its exit code. When it is
   * set, the program is not run on this machine.
   */
  program?: (argv: readonly string[]) => { code?: number; chunks?: string[] };
  /** When true, every file reports the execute bits (a server whose files are all runnable). */
  executable?: boolean;
}

export interface FakeSsh extends SshTransport {
  /** Every exec string the backend sent, in order. */
  readonly calls: FakeExecCall[];
  readonly script: FakeSshScript;
  /** The number of SFTP bytes read so far (the cap test reads this). */
  readonly bytesServed: number;
  /** The temp folder that stands for the remote `/`. */
  readonly remoteRoot: string;
  /** Takes the session down, as a dropped connection would: the state changes and listeners are told. */
  drop(): void;
  /** Brings the session up again, with no connect check (a test's own reset). */
  raise(): void;
  /** Kills every program still running, and resolves when they have exited (a test's cleanup). */
  killAll(): Promise<void>;
}

/** The error of a call made while the session is down. */
function notConnected(): SftpError {
  return Object.assign(new Error('ENOTCONN'), { code: 'ENOTCONN' });
}

/** An SFTP status for a Node error: NO_SUCH_FILE, PERMISSION_DENIED, or the generic FAILURE. */
function statusOf(error: unknown): SftpError {
  const code = (error as NodeJS.ErrnoException).code;
  const status =
    code === 'ENOENT' ? 'NO_SUCH_FILE' : code === 'EACCES' ? 'PERMISSION_DENIED' : 'FAILURE';
  return Object.assign(new Error(status), { code: status });
}

/** The SFTP attributes of a local file's stats. Times are in whole seconds, as SFTP sends them. */
function attrsOf(stats: {
  mode: number;
  size: number;
  uid: number;
  gid: number;
  atimeMs: number;
  mtimeMs: number;
}): SftpAttributes {
  return {
    mode: stats.mode,
    size: stats.size,
    uid: stats.uid,
    gid: stats.gid,
    atime: Math.floor(stats.atimeMs / 1000),
    mtime: Math.floor(stats.mtimeMs / 1000),
  };
}

/** Collects output for one launched program, up to a cap when the caller asked for it. */
function collector(maxBytes: number | undefined): {
  add(chunk: Buffer): void;
  done(): { buffer: Buffer; truncated: boolean };
} {
  const parts: Buffer[] = [];
  let size = 0;
  let truncated = false;
  return {
    add: (chunk) => {
      if (maxBytes === undefined) return;
      if (size + chunk.length > maxBytes) {
        truncated = true;
        return;
      }
      size += chunk.length;
      parts.push(chunk);
    },
    done: () => ({ buffer: Buffer.concat(parts), truncated }),
  };
}

/** A fake SSH transport over a temp folder that stands for the remote `/`. */
export function fakeSshTransport(remoteRoot: string, script: FakeSshScript = {}): FakeSsh {
  const calls: FakeExecCall[] = [];
  let up = false;
  let platformValue: SystemPlatform | null = null;
  let identityValue: { uid: number; gids: number[] } | null = null;
  let sessions = 0;
  let served = 0;
  let state: ConnectionState = 'unreachable';
  const listeners = new Set<(next: ConnectionState) => void>();
  /** The running programs, by group id, and how to stop each one. */
  const groups = new Map<number, ChildProcess | (() => void)>();
  let nextStallGroup = 90_000;

  const setState = (next: ConnectionState): void => {
    if (next === state) return;
    state = next;
    for (const listener of [...listeners]) listener(next);
  };

  /** The local path of a remote absolute POSIX path. */
  function mapPath(remote: string): string {
    if (!posix.isAbsolute(remote)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    const segments = posix
      .normalize(remote)
      .split('/')
      .filter((part) => part !== '');
    return join(remoteRoot, ...segments);
  }

  /** The remote path of a local path inside the root, or the input when it is not inside the root. */
  function remoteOf(local: string): string {
    const rel = relative(remoteRoot, local);
    if (rel === '') return '/';
    if (rel.startsWith('..') || isAbsolute(rel)) return local;
    return `/${rel.split(sep).join('/')}`;
  }

  /** Runs one SFTP operation: refused while the session is down, and its errors become statuses. */
  async function call<T>(operation: () => Promise<T>): Promise<T> {
    if (!up) throw notConnected();
    try {
      return await operation();
    } catch (error) {
      throw statusOf(error);
    }
  }

  async function openFile(local: string, flags: 'r' | 'w' | 'wx'): Promise<SftpFile> {
    const handle = await fsp.open(local, flags);
    return {
      read: async (position, length) => {
        const buffer = Buffer.alloc(length);
        const result = await handle.read(buffer, 0, length, position);
        served += result.bytesRead;
        return buffer.subarray(0, result.bytesRead);
      },
      write: async (data, position) => {
        await handle.write(data, 0, data.length, position);
      },
      stat: async () => attrsOf(await handle.stat()),
      close: () => handle.close(),
    };
  }

  /** The attributes as the server reports them: with the execute bits when the script says every file is runnable. */
  const executable = (attrs: SftpAttributes): SftpAttributes =>
    script.executable === true ? { ...attrs, mode: attrs.mode | 0o111 } : attrs;

  const sftp: SshSftp = {
    stat: (path) => call(async () => executable(attrsOf(await fsp.stat(mapPath(path))))),
    lstat: (path) => call(async () => executable(attrsOf(await fsp.lstat(mapPath(path))))),
    realpath: (path) => call(async () => remoteOf(realpathSync.native(mapPath(path)))),
    readlink: (path) =>
      call(async () => {
        const target = await fsp.readlink(mapPath(path));
        return isAbsolute(target) ? remoteOf(target) : target;
      }),
    readdir: (path) =>
      call(async (): Promise<SftpEntry[]> => {
        const dir = mapPath(path);
        const names = await fsp.readdir(dir);
        return Promise.all(
          names.map(async (name) => ({ name, attrs: attrsOf(await fsp.lstat(join(dir, name))) })),
        );
      }),
    mkdir: (path) => call(() => fsp.mkdir(mapPath(path))),
    rmdir: (path) => call(() => fsp.rmdir(mapPath(path))),
    unlink: (path) => call(() => fsp.unlink(mapPath(path))),
    // Like OpenSSH's plain rename: it does not replace an existing target.
    rename: (from, to) =>
      call(async () => {
        const target = mapPath(to);
        const taken = await fsp.lstat(target).then(
          () => true,
          () => false,
        );
        if (taken) throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
        await fsp.rename(mapPath(from), target);
      }),
    hasPosixRename: script.posixRename !== false,
    posixRename: (from, to) => call(() => fsp.rename(mapPath(from), mapPath(to))),
    chmod: (path, mode) => call(() => fsp.chmod(mapPath(path), mode)),
    symlink: (target, path) =>
      call(() =>
        fsp.symlink(
          isAbsolute(target) || target.startsWith('/') ? mapPath(target) : target,
          mapPath(path),
        ),
      ),
    open: (path, flags) => call(() => openFile(mapPath(path), flags)),
  };

  /** Kills a program's whole group. Posix programs lead their own group; elsewhere the child is killed. */
  function killProcess(child: ChildProcess): Promise<void> {
    const exited = new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      child.once('exit', () => resolve());
      setTimeout(resolve, 3_000).unref();
    });
    if (process.platform !== 'win32' && child.pid !== undefined) {
      try {
        process.kill(-child.pid, 'SIGKILL');
        return exited;
      } catch {
        // The group has already gone; the child kill below is the fallback.
      }
    }
    child.kill('SIGKILL');
    return exited;
  }

  /** `kill -KILL -- '-<group>'`: stops a group, or reports that there is none. */
  async function killGroup(words: string[]): Promise<SshExecResult> {
    const group = Number(words[3]?.slice(1));
    const target = groups.get(group);
    if (target === undefined)
      return { started: true, code: 1, signal: null, timedOut: false, aborted: false };
    groups.delete(group);
    if (typeof target === 'function') target();
    else await killProcess(target);
    return { started: true, code: 0, signal: null, timedOut: false, aborted: false };
  }

  /** The launched program of `cd -- <cwd> && exec env -- <NAME=value…> sh -c <LAUNCHER> sh <file> <args…>`. */
  async function launched(words: string[], options: SshExecOptions): Promise<SshExecResult> {
    if (words[0] !== 'cd' || words[1] !== '--' || words[3] !== '&&') return unsupported();
    if (words[4] !== 'exec' || words[5] !== 'env' || words[6] !== '--') return unsupported();
    const rest = words.slice(7);
    const pairs: string[] = [];
    let at = 0;
    while (at < rest.length && (rest[at] ?? '').includes('=')) pairs.push(rest[at++] ?? '');
    if (
      rest[at] !== 'sh' ||
      rest[at + 1] !== '-c' ||
      rest[at + 2] !== LAUNCHER ||
      rest[at + 3] !== 'sh'
    ) {
      return unsupported();
    }
    const program = rest.slice(at + 4);
    const [file, ...args] = program;
    const cwd = mapPath(words[2] ?? '/');
    if (file === undefined) return unsupported();

    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const pair of pairs) {
      const eq = pair.indexOf('=');
      env[pair.slice(0, eq)] = pair.slice(eq + 1);
    }

    if (script.stall === true) return stalled(options);
    if (script.program !== undefined) {
      const answer = script.program(program);
      options.onOutput?.(Buffer.from(`${GROUP_MARKER}${process.pid}\n`));
      for (const chunk of answer.chunks ?? []) options.onOutput?.(Buffer.from(chunk));
      return {
        started: true,
        code: answer.code ?? 0,
        signal: null,
        timedOut: false,
        aborted: false,
      };
    }
    if (file === 'git' && script.noGit === true) {
      // git is not installed on the server: the shell reports 127 with its own message.
      const notFound = Buffer.from('sh: 1: git: not found\n');
      return {
        started: true,
        code: 127,
        signal: null,
        timedOut: false,
        aborted: false,
        ...(options.capture === undefined
          ? {}
          : { stdout: Buffer.alloc(0), stderr: notFound, truncated: false }),
      };
    }

    // A `git -C <folder>` names a remote folder: the fake maps it as it maps the cwd.
    const runArgs =
      file === 'git' && args[0] === '-C' && args[1] !== undefined
        ? ['-C', mapPath(args[1]), ...args.slice(2)]
        : args;

    let child: ChildProcess;
    try {
      child = spawn(file, runArgs, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      return { started: true, code: 127, signal: null, timedOut: false, aborted: false };
    }
    if (child.pid === undefined) {
      // The program is not on the path: the shell reports 127, as the remote one would.
      child.on('error', () => undefined);
      return { started: true, code: 127, signal: null, timedOut: false, aborted: false };
    }
    const group = child.pid;
    groups.set(group, child);
    // The launcher's first line: the marker with the group id, before the program's own output. A captured
    // stream holds it too, as the real channel does, so the backend must take it off.
    const markerLine = Buffer.from(`${GROUP_MARKER}${group}\n`);
    options.onOutput?.(markerLine);

    const out = collector(options.capture?.maxBytes);
    const err = collector(options.capture?.maxBytes);
    out.add(markerLine);
    return new Promise<SshExecResult>((resolve) => {
      let settled = false;
      const finish = (result: SshExecResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        groups.delete(group);
        options.signal?.removeEventListener('abort', onAbort);
        const captured = (): Partial<SshExecResult> => {
          if (options.capture === undefined) return {};
          const o = out.done();
          const e = err.done();
          return { stdout: o.buffer, stderr: e.buffer, truncated: o.truncated || e.truncated };
        };
        resolve({ ...result, ...captured() } as SshExecResult);
      };
      const stopWith = (reason: 'timeout' | 'aborted'): void => {
        if (settled) return;
        void killProcess(child).then(() =>
          finish({
            started: true,
            code: null,
            signal: 'SIGKILL',
            timedOut: reason === 'timeout',
            aborted: reason === 'aborted',
          }),
        );
      };
      const onAbort = (): void => stopWith('aborted');
      const timer = setTimeout(() => stopWith('timeout'), options.timeoutMs);
      options.signal?.addEventListener('abort', onAbort, { once: true });
      if (options.signal?.aborted === true) onAbort();

      child.stdout?.on('data', (chunk: Buffer) => {
        if (settled) return;
        options.onOutput?.(chunk);
        out.add(chunk);
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        if (settled) return;
        options.onOutput?.(chunk);
        err.add(chunk);
      });
      child.on('error', () => {
        // A program that cannot start after the marker: the same 127 the shell gives.
        finish({ started: true, code: 127, signal: null, timedOut: false, aborted: false });
      });
      child.on('close', (code, signal) => {
        finish({ started: true, code, signal, timedOut: false, aborted: false });
      });
    });
  }

  /** A program that stalls: it prints a group marker and waits for a kill, a timeout or an abort. */
  function stalled(options: SshExecOptions): Promise<SshExecResult> {
    const group = nextStallGroup++;
    options.onOutput?.(Buffer.from(`${GROUP_MARKER}${group}\n`));
    return new Promise<SshExecResult>((resolve) => {
      let settled = false;
      const finish = (result: SshExecResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        groups.delete(group);
        options.signal?.removeEventListener('abort', onAbort);
        resolve(result);
      };
      const timer = setTimeout(
        () =>
          finish({ started: true, code: null, signal: 'SIGKILL', timedOut: true, aborted: false }),
        options.timeoutMs,
      );
      const onAbort = (): void =>
        finish({ started: true, code: null, signal: 'SIGKILL', timedOut: false, aborted: true });
      options.signal?.addEventListener('abort', onAbort, { once: true });
      if (options.signal?.aborted === true) onAbort();
      groups.set(group, () =>
        finish({ started: true, code: null, signal: 'SIGKILL', timedOut: false, aborted: false }),
      );
    });
  }

  /** A command shape the backend does not build: the fake reports it as a failure, so a test sees it. */
  function unsupported(): SshExecResult {
    return {
      started: true,
      code: 127,
      signal: null,
      timedOut: false,
      aborted: false,
      stderr: Buffer.from('fake: unsupported command'),
    };
  }

  const transport: FakeSsh = {
    get calls() {
      return calls;
    },
    script,
    get bytesServed() {
      return served;
    },
    remoteRoot,
    state: () => state,
    onChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    connect: async (): Promise<ConnectResult> => {
      if (script.connectFailure !== undefined) {
        up = false;
        setState('unreachable');
        const offered =
          script.connectFailure === 'host-key-unknown' ||
          script.connectFailure === 'host-key-changed';
        return offered
          ? { ok: false, code: script.connectFailure, fingerprint: script.fingerprint }
          : { ok: false, code: script.connectFailure };
      }
      const uname = script.uname ?? 'Linux';
      if (uname !== 'Linux' && uname !== 'Darwin') {
        up = false;
        setState('unreachable');
        return { ok: false, code: 'unsupported-system' };
      }
      platformValue = uname === 'Linux' ? 'linux' : 'darwin';
      identityValue = { uid: script.uid ?? 1000, gids: script.gids ?? [1000] };
      sessions += 1;
      up = true;
      setState('connected');
      return { ok: true };
    },
    platform: () => platformValue,
    identity: () => identityValue,
    connectionId: () => sessions,
    sftp,
    exec: async (command, options) => {
      calls.push({ command, timeoutMs: options.timeoutMs });
      if (!up) return { started: false };
      let words: string[];
      try {
        words = splitWords(command);
      } catch {
        return unsupported();
      }
      if (words[0] === 'uname' && words[1] === '-s') {
        return {
          started: true,
          code: 0,
          signal: null,
          timedOut: false,
          aborted: false,
          stdout: Buffer.from(`${script.uname ?? 'Linux'}\n`),
        };
      }
      if (words[0] === 'unshare') {
        return {
          started: true,
          code: script.probe === true ? 0 : 1,
          signal: null,
          timedOut: false,
          aborted: false,
        };
      }
      if (words[0] === 'kill') return killGroup(words);
      if (words[0] === 'cd') return launched(words, options);
      return unsupported();
    },
    drop: () => {
      up = false;
      setState('unreachable');
    },
    raise: () => {
      up = true;
      setState('connected');
    },
    killAll: async () => {
      const running = [...groups.values()];
      groups.clear();
      await Promise.all(
        running.map((target) => (typeof target === 'function' ? target() : killProcess(target))),
      );
    },
  };
  return transport;
}
