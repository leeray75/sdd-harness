// The SSH backend of the environment interface (D43, p4-env-ssh). One object serves one saved server and a
// remote POSIX root. Files go over SFTP through the transport; programs and git run as exec requests built
// by ssh-command.ts; watching polls one folder (poll-watch.ts). Nothing here falls back to the local backend:
// a failing transport is a result for each call (a Node code, { started: false }, or a git code), never a
// throw that escapes. The transport is injected (SshTransport), so the tests use a fake
// (tests/support/fake-ssh-transport.ts). Runs only in main.

import { posix } from 'node:path';
import { chooseNetwork, wrapCommand, writerNetworkEnv } from '../commands/network';
import type { SshServer } from '../projects/servers';
import { createGit, type GitLauncher } from '../git/git';
import { createMarkerReader, GROUP_MARKER } from './launcher';
import { pollWatchPart } from './poll-watch';
import { crossingVariables, killLine, spawnLine, UNSHARE_PROBE_LINE } from './ssh-command';
import type {
  ConnectFailure,
  SftpAttributes,
  SftpFile,
  SshExecResult,
  SshTransport,
  SystemPlatform,
} from './ssh-transport';
import type {
  AccessMode,
  ConnectionPart,
  DirEntryInfo,
  Environment,
  FileHandleLike,
  FilesPart,
  FileStat,
  NetworkLevel,
  ProcessPart,
  SpawnOptions,
  SpawnOutcome,
} from './types';

/** The largest block read or written at a time over SFTP, in bytes. */
const BLOCK_BYTES = 32 * 1024;

/** How long the watcher waits between two listings, in milliseconds (the same poll as WSL, D42). */
export const SSH_POLL_MS = 1_000;

/** The options of the SSH backend: the saved server it reaches, the transport to that server, and the poll. */
export interface SshEnvironmentOptions {
  server: SshServer;
  transport: SshTransport;
  /** The watcher's poll interval; the tests shorten it. Defaults to SSH_POLL_MS. */
  pollMs?: number;
}

interface Ctx {
  readonly transport: SshTransport;
}

/** The kind of a remote entry, as far as the backend needs it. `unknown` when the server could not say. */
type Kind = 'missing' | 'file' | 'dir' | 'link' | 'other' | 'unknown';

/** What a path is meant to be for the call that failed: a file, a folder, or either. */
interface Wants {
  path: string;
  wants: 'file' | 'folder' | 'any';
}

const pathPart: Environment['path'] = posix;

/** A Node-style error with a code and no path or server text in its message. */
function codeError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: the path is not available on this server`), { code });
}

/**
 * The Node code of an SFTP failure. NO_SUCH_FILE is ENOENT, PERMISSION_DENIED is EACCES, and the three
 * session errors are ENOTCONN. A generic FAILURE (and any other status) is returned as `FAILURE`, which
 * the caller resolves by looking at the path.
 */
function codeOfStatus(error: unknown): string {
  const raw = (error as { code?: unknown } | null)?.code;
  switch (raw) {
    case 'NO_SUCH_FILE':
      return 'ENOENT';
    case 'PERMISSION_DENIED':
      return 'EACCES';
    case 'NO_CONNECTION':
    case 'CONNECTION_LOST':
    case 'ENOTCONN':
      return 'ENOTCONN';
    default:
      return 'FAILURE';
  }
}

/** The kind of a mode word: its file type bits. */
function kindOfMode(mode: number): Kind {
  const type = mode & 0o170000;
  if (type === 0o100000) return 'file';
  if (type === 0o040000) return 'dir';
  if (type === 0o120000) return 'link';
  return 'other';
}

/** True for a kind that is there (not missing, and not unknown). */
function present(kind: Kind): boolean {
  return kind !== 'missing' && kind !== 'unknown';
}

/** The stat the modules read, from the attributes the server sent. */
function fileStatOf(attrs: SftpAttributes): FileStat {
  const kind = kindOfMode(attrs.mode);
  return {
    isFile: () => kind === 'file',
    isDirectory: () => kind === 'dir',
    isSymbolicLink: () => kind === 'link',
    size: attrs.size,
    mtimeMs: attrs.mtime * 1000,
    mode: attrs.mode,
  };
}

/**
 * Runs one SFTP call and maps its failure to a Node code (D43). NO_SUCH_FILE, PERMISSION_DENIED and the
 * session errors map directly. For a path-based call, a missing path is explained by the path itself: a
 * file where a folder is needed is ENOTDIR, a folder where a file is needed is EISDIR, a file under a
 * file is ENOTDIR, and anything else is ENOENT. A generic FAILURE goes to `onFailure`.
 */
async function sftpCall<T>(
  operation: () => Promise<T>,
  onFailure: () => Promise<string>,
  at?: Wants,
  explain?: (wanted: Wants) => Promise<string>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    let code = codeOfStatus(error);
    if (code === 'ENOENT' && at !== undefined && explain !== undefined) code = await explain(at);
    if (code === 'FAILURE') code = await onFailure();
    throw codeError(code);
  }
}

/** The files part over SFTP. Every path must be absolute POSIX; any other path is ENOENT. */
function filesPartFor(ctx: Ctx): FilesPart {
  const sftp = () => ctx.transport.sftp;

  /** The path as given, when it is absolute POSIX with no NUL; otherwise ENOENT. */
  const absolute = (path: string): string => {
    if (!posix.isAbsolute(path) || path.includes('\0')) throw codeError('ENOENT');
    return path;
  };

  /** What a path is on the server. The call never throws: a failure is `unknown`, except ENOTCONN. */
  const kindOf = async (path: string): Promise<Kind> => {
    try {
      return kindOfMode((await sftp().lstat(path)).mode);
    } catch (error) {
      return codeOfStatus(error) === 'ENOENT' ? 'missing' : 'unknown';
    }
  };

  /** The kind of a path's folder. */
  const parentKind = (path: string): Promise<Kind> => kindOf(posix.dirname(path));

  /** The Node code of a missing path, explained by the path and its folders (see sftpCall). */
  const explain = async ({ path, wants }: Wants): Promise<string> => {
    const kind = await kindOf(path);
    if (kind === 'dir' && wants === 'file') return 'EISDIR';
    if (kind === 'file' && wants === 'folder') return 'ENOTDIR';
    for (let above = posix.dirname(path); ; above = posix.dirname(above)) {
      if ((await kindOf(above)) === 'file') return 'ENOTDIR';
      if (above === posix.dirname(above)) break;
    }
    return 'ENOENT';
  };

  /** The failure of an open for reading: a folder is EISDIR, a missing file ENOENT. */
  const readFailure = (path: string) => async (): Promise<string> => {
    const kind = await kindOf(path);
    if (kind === 'dir') return 'EISDIR';
    if (kind === 'missing') return 'ENOENT';
    return 'EIO';
  };

  /** The failure of an open for writing: a folder, an existing file for `wx`, or a file where a folder is needed. */
  const writeFailure = (path: string, flag: 'w' | 'wx') => async (): Promise<string> => {
    const kind = await kindOf(path);
    if (kind === 'dir') return 'EISDIR';
    if (flag === 'wx' && present(kind)) return 'EEXIST';
    const parent = await parentKind(path);
    if (parent === 'file') return 'ENOTDIR';
    if (parent === 'missing') return 'ENOENT';
    return 'EIO';
  };

  /** The failure of a rename: an existing folder at the target is EEXIST, a missing source ENOENT. */
  const renameFailure = (from: string, to: string) => async (): Promise<string> => {
    if ((await kindOf(to)) === 'dir') return 'EEXIST';
    if ((await kindOf(from)) === 'missing') return 'ENOENT';
    return 'EIO';
  };

  /** Whether the folder has entries (for rmdir's ENOTEMPTY). A failed listing counts as empty. */
  const hasEntries = async (path: string): Promise<boolean> => {
    try {
      return (await sftp().readdir(path)).length > 0;
    } catch {
      return false;
    }
  };

  /** Makes folders over SFTP. Recursive makes each missing folder above the path too. */
  const makeFolders = async (path: string, recursive: boolean): Promise<void> => {
    const wanted: Wants = { path, wants: 'folder' };
    if (!recursive) {
      await sftpCall(
        () => sftp().mkdir(path),
        async () => {
          const kind = await kindOf(path);
          if (present(kind)) return 'EEXIST';
          const parent = await parentKind(path);
          if (parent === 'file') return 'ENOTDIR';
          return 'EIO';
        },
        wanted,
        explain,
      );
      return;
    }
    const kind = await kindOf(path);
    if (kind === 'dir') return;
    if (present(kind)) throw codeError('EEXIST');
    const parent = posix.dirname(path);
    if (parent !== path) {
      const above = await kindOf(parent);
      if (above === 'file') throw codeError('ENOTDIR');
      if (above === 'missing') await makeFolders(parent, true);
    }
    try {
      await makeFolders(path, false);
    } catch (error) {
      // Made by someone else in the meantime: that is the folder the caller asked for.
      if ((error as NodeJS.ErrnoException).code === 'EEXIST' && (await kindOf(path)) === 'dir')
        return;
      throw error;
    }
  };

  /** Removes a path: a file or link, or a folder with `recursive`. A missing path is quiet with `force`. */
  const removePath = async (
    path: string,
    options: { force?: boolean; recursive?: boolean },
  ): Promise<void> => {
    let mode: number;
    try {
      const attrs = await sftpCall(
        () => sftp().lstat(path),
        async () => 'EIO',
        { path, wants: 'any' },
        explain,
      );
      mode = attrs.mode;
    } catch (error) {
      if (options.force === true && (error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    if (kindOfMode(mode) !== 'dir') {
      await sftpCall(
        () => sftp().unlink(path),
        async () => {
          const kind = await kindOf(path);
          if (kind === 'dir') return 'EISDIR';
          if (kind === 'missing') return 'ENOENT';
          return 'EIO';
        },
        { path, wants: 'file' },
        explain,
      );
      return;
    }
    if (options.recursive !== true) throw codeError('EISDIR');
    const entries = await sftpCall(
      () => sftp().readdir(path),
      async () => 'EIO',
      { path, wants: 'folder' },
      explain,
    );
    for (const entry of entries) {
      await removePath(posix.join(path, entry.name), options);
    }
    await sftpCall(
      () => sftp().rmdir(path),
      async () => ((await hasEntries(path)) ? 'ENOTEMPTY' : 'EIO'),
      { path, wants: 'folder' },
      explain,
    );
  };

  /**
   * The execute bit this user sees: the owner bit when the owner is this user, the group bit for a group
   * of this user, otherwise the other bit. The user's ids are read once per connection (D43).
   */
  const executeBit = (attrs: SftpAttributes): number => {
    const who = ctx.transport.identity();
    if (who !== null && attrs.uid === who.uid) return 0o100;
    if (who !== null && who.gids.includes(attrs.gid)) return 0o010;
    return 0o001;
  };

  /**
   * Reads one open file, with an optional cap: at most cap + 1 bytes are read, so a file that grows past the
   * cap is refused without reading more than that (AC4).
   */
  const readAll = async (
    file: SftpFile,
    cap: number | undefined,
    path: string,
  ): Promise<Buffer> => {
    const limit = cap === undefined ? Number.POSITIVE_INFINITY : cap + 1;
    const parts: Buffer[] = [];
    let total = 0;
    while (total < limit) {
      const want = Math.min(BLOCK_BYTES, limit - total);
      const part = await sftpCall(
        () => file.read(total, want),
        readFailure(path),
        { path, wants: 'file' },
        explain,
      );
      if (part.length === 0) break;
      parts.push(part);
      total += part.length;
    }
    if (cap !== undefined && total > cap) throw codeError('EFBIG');
    return Buffer.concat(parts);
  };

  return {
    stat: async (path) => {
      const target = absolute(path);
      const attrs = await sftpCall(
        () => sftp().stat(target),
        async () => 'EIO',
        { path: target, wants: 'any' },
        explain,
      );
      return fileStatOf(attrs);
    },
    lstat: async (path) => {
      const target = absolute(path);
      const attrs = await sftpCall(
        () => sftp().lstat(target),
        async () => 'EIO',
        { path: target, wants: 'any' },
        explain,
      );
      return fileStatOf(attrs);
    },
    realpath: (path) => {
      const target = absolute(path);
      return sftpCall(
        () => sftp().realpath(target),
        async () => 'EIO',
        { path: target, wants: 'any' },
        explain,
      );
    },
    access: async (path: string, mode: AccessMode): Promise<void> => {
      const target = absolute(path);
      const attrs = await sftpCall(
        () => sftp().stat(target),
        async () => 'EIO',
        { path: target, wants: 'any' },
        explain,
      );
      if (mode === 'exists') return;
      if ((attrs.mode & executeBit(attrs)) === 0) throw codeError('EACCES');
    },
    readFile: async (path, options) => {
      const target = absolute(path);
      const file = await sftpCall(
        () => sftp().open(target, 'r'),
        readFailure(target),
        { path: target, wants: 'file' },
        explain,
      );
      try {
        const cap = options?.maxBytes;
        if (cap !== undefined) {
          const info = await sftpCall(
            () => file.stat(),
            async () => 'EIO',
          );
          if (info.size > cap) throw codeError('EFBIG');
        }
        return await readAll(file, cap, target);
      } finally {
        await file.close().catch(() => undefined);
      }
    },
    open: async (path, flag): Promise<FileHandleLike> => {
      const target = absolute(path);
      const file = await sftpCall(
        () => sftp().open(target, flag),
        readFailure(target),
        { path: target, wants: 'file' },
        explain,
      );
      return {
        read: async (buffer, offset, length, position) => {
          const data = await sftpCall(
            () => file.read(position, length),
            readFailure(target),
            { path: target, wants: 'file' },
            explain,
          );
          data.copy(buffer, offset, 0, data.length);
          return { bytesRead: data.length };
        },
        close: () => file.close(),
      };
    },
    writeFile: async (path, data, options) => {
      const target = absolute(path);
      const flag = options?.flag === 'wx' ? 'wx' : 'w';
      const file = await sftpCall(
        () => sftp().open(target, flag),
        writeFailure(target, flag),
        { path: target, wants: 'file' },
        explain,
      );
      const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
      try {
        for (let position = 0; position < bytes.length; position += BLOCK_BYTES) {
          const block = bytes.subarray(position, position + BLOCK_BYTES);
          await sftpCall(
            () => file.write(block, position),
            async () => 'EIO',
          );
        }
      } catch (error) {
        await file.close().catch(() => undefined);
        throw error;
      }
      await sftpCall(
        () => file.close(),
        async () => 'EIO',
      );
    },
    mkdir: async (path, options) => {
      await makeFolders(absolute(path), options?.recursive === true);
    },
    readdir: async (path): Promise<DirEntryInfo[]> => {
      const target = absolute(path);
      const entries = await sftpCall(
        () => sftp().readdir(target),
        async () => {
          const kind = await kindOf(target);
          if (kind === 'file') return 'ENOTDIR';
          return 'EIO';
        },
        { path: target, wants: 'folder' },
        explain,
      );
      return entries.map((entry) => {
        const kind = kindOfMode(entry.attrs.mode);
        return {
          name: entry.name,
          isFile: () => kind === 'file',
          isDirectory: () => kind === 'dir',
          isSymbolicLink: () => kind === 'link',
        };
      });
    },
    rm: async (path, options) => {
      await removePath(absolute(path), options ?? {});
    },
    rmdir: (path) => {
      const target = absolute(path);
      return sftpCall(
        () => sftp().rmdir(target),
        async () => {
          const kind = await kindOf(target);
          if (kind === 'file') return 'ENOTDIR';
          if (kind === 'dir') return (await hasEntries(target)) ? 'ENOTEMPTY' : 'EIO';
          return 'EIO';
        },
        { path: target, wants: 'folder' },
        explain,
      );
    },
    rename: async (from, to) => {
      const source = absolute(from);
      const target = absolute(to);
      const sourceAt: Wants = { path: source, wants: 'any' };
      if (sftp().hasPosixRename) {
        await sftpCall(
          () => sftp().posixRename(source, target),
          renameFailure(source, target),
          sourceAt,
          explain,
        );
        return;
      }
      // Without the extension, a file at the target is removed first, then the rename is made.
      if ((await kindOf(target)) === 'file') {
        await sftpCall(() => sftp().unlink(target), readFailure(target));
      }
      await sftpCall(
        () => sftp().rename(source, target),
        renameFailure(source, target),
        sourceAt,
        explain,
      );
    },
    chmod: async (path, mode) => {
      const target = absolute(path);
      await sftpCall(
        () => sftp().chmod(target, mode),
        async () => ((await kindOf(target)) === 'missing' ? 'ENOENT' : 'EIO'),
        { path: target, wants: 'any' },
        explain,
      );
    },
    readlink: (path) => {
      const target = absolute(path);
      return sftpCall(
        () => sftp().readlink(target),
        async () => {
          const kind = await kindOf(target);
          if (kind === 'file' || kind === 'dir') return 'EINVAL';
          return 'EIO';
        },
        { path: target, wants: 'any' },
        explain,
      );
    },
    symlink: async (target, path) => {
      const at = absolute(path);
      await sftpCall(
        () => sftp().symlink(target, at),
        async () => {
          if (present(await kindOf(at))) return 'EEXIST';
          const parent = await parentKind(at);
          if (parent === 'file') return 'ENOTDIR';
          return 'EIO';
        },
        { path: at, wants: 'any' },
        explain,
      );
    },
  };
}

/** The longest a network probe may take, in milliseconds (D42, D43). */
const PROBE_TIMEOUT_MS = 10_000;
/** The longest a kill request may take, in milliseconds. */
const KILL_TIMEOUT_MS = 10_000;
/** The channel's own limit is this much later than the backend's, so the backend stops the group first (D43). */
const STOP_GRACE_MS = 2_000;

/** One program to run on the server, with its network choice already made. */
interface ProgramRun {
  cwd: string;
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  network: NetworkLevel | undefined;
  options: SpawnOptions;
  /** Collects stdout and stderr separately, up to maxBytes each (git needs both). */
  capture?: { maxBytes: number };
}

/** The output kept apart by stream, when the run asked for it. */
interface Captured {
  stdout: Buffer;
  stderr: Buffer;
  truncated: boolean;
}

/** How a program run ended, and the captured output when it was asked for. */
interface ProgramResult {
  outcome: SpawnOutcome;
  captured?: Captured;
}

/**
 * Runs one program over an exec request, with the group kill on timeout and abort (D43). The group is stopped
 * first, on a second request, then the channel is closed, then the result resolves. Never rejects.
 */
async function runProgram(ctx: Ctx, run: ProgramRun): Promise<ProgramResult> {
  const { options } = run;
  const netPart = run.network === undefined ? {} : { network: run.network };
  let stopped: 'timeout' | 'aborted' | null = null;
  let halting: Promise<void> = Promise.resolve();
  const inner = new AbortController();
  const marker = createMarkerReader();

  /** Stops the program: forwards nothing further, kills its group if it is known, then closes the channel. */
  const halt = (reason: 'timeout' | 'aborted'): Promise<void> => {
    if (stopped !== null) return halting;
    stopped = reason;
    halting = (async () => {
      const group = marker.group;
      if (group !== null) {
        await ctx.transport.exec(killLine(group), { timeoutMs: KILL_TIMEOUT_MS });
      }
      inner.abort();
    })();
    return halting;
  };

  // The marker line is taken out by the shared reader; the rest of the output goes to the caller while the run lasts.
  const onChunk = (chunk: Buffer): void => {
    if (stopped !== null) return;
    const out = marker.feed(chunk);
    if (out !== null) options.onOutput?.(out);
  };

  const onAbort = (): void => void halt('aborted');
  if (options.signal?.aborted === true) onAbort();
  else options.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => void halt('timeout'), options.timeoutMs);

  const line = spawnLine(run.cwd, crossingVariables(run.env), run.command, run.args);
  if (line === null) {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
    return { outcome: { started: false } };
  }
  let result: SshExecResult;
  try {
    result = await ctx.transport.exec(line, {
      timeoutMs: options.timeoutMs + STOP_GRACE_MS,
      signal: inner.signal,
      onOutput: onChunk,
      ...(run.capture === undefined ? {} : { capture: run.capture }),
    });
  } catch {
    result = { started: false };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
  if (result.started && result.timedOut) await halt('timeout');
  await halting;
  const captured: Captured | undefined =
    result.started && result.stdout !== undefined
      ? {
          stdout: result.stdout,
          stderr: result.stderr ?? Buffer.alloc(0),
          truncated: result.truncated === true,
        }
      : undefined;
  const done = (outcome: SpawnOutcome): ProgramResult => ({ outcome, captured });
  if (stopped === 'timeout') {
    return done({
      started: true,
      code: null,
      signal: null,
      timedOut: true,
      aborted: false,
      ...netPart,
    });
  }
  if (stopped === 'aborted') {
    return done({
      started: true,
      code: null,
      signal: null,
      timedOut: false,
      aborted: true,
      ...netPart,
    });
  }
  if (!result.started) return done({ started: false });
  return done({
    started: true,
    code: result.code,
    signal: result.signal,
    timedOut: false,
    aborted: result.aborted,
    ...netPart,
  });
}

/** A captured stream starts with the group marker line the launcher printed; this takes it off. */
function withoutMarker(output: Buffer): Buffer {
  const newline = output.indexOf(0x0a);
  if (newline < 0) return output;
  const first = output.subarray(0, newline).toString('utf8');
  return new RegExp(`^${GROUP_MARKER}\\d+$`).test(first) ? output.subarray(newline + 1) : output;
}

/**
 * git through the same launcher and group kill as a program (D43): the same argument lists, and the same
 * codes as the local launcher. Exit 127 is git-missing, a timeout is `timeout`, and any other failure is `failed`.
 */
function gitLauncherFor(ctx: Ctx): GitLauncher {
  return async (args, options) => {
    const { outcome, captured } = await runProgram(ctx, {
      cwd: options.cwd,
      command: 'git',
      args: [...args],
      env: options.env,
      network: undefined,
      options: {
        cwd: options.cwd,
        env: options.env,
        timeoutMs: options.timeoutMs,
        network: 'normal',
      },
      capture: { maxBytes: options.maxBuffer },
    });
    if (!outcome.started) return { ok: false, kind: 'failed', stderr: '' };
    const stderr = captured?.stderr.toString('utf8') ?? '';
    if (outcome.timedOut) return { ok: false, kind: 'timeout', stderr };
    if (outcome.code === 127) return { ok: false, kind: 'missing', stderr };
    if (outcome.code === 0 && captured !== undefined && !captured.truncated) {
      return { ok: true, stdout: withoutMarker(captured.stdout).toString('utf8') };
    }
    return { ok: false, kind: 'failed', stderr };
  };
}

/** The fixed reason of each failed connect (D43). None names the server, its user, a key or a password. */
export const SSH_RECONNECT_REASONS: Record<ConnectFailure, string> = {
  'host-key-unknown': "this server's host key is not trusted yet; trust it to continue",
  'host-key-changed': "this server's host key has changed, so it was not trusted again",
  'auth-failed': 'the server refused the sign-in',
  unreachable: 'the server could not be reached; reconnect to try again',
  'unsupported-system': 'the server is not a Linux or macOS system',
};

/** The connection part: the transport's state, and reconnect is one connect (D43). Never reconnects by itself. */
function connectionPartFor(transport: SshTransport): ConnectionPart {
  return {
    state: () => transport.state(),
    onChange: (listener) => transport.onChange(listener),
    reconnect: async () => {
      try {
        const result = await transport.connect();
        if (result.ok) return { ok: true };
        return { ok: false, reason: SSH_RECONNECT_REASONS[result.code] };
      } catch {
        return { ok: false, reason: SSH_RECONNECT_REASONS.unreachable };
      }
    },
  };
}

/**
 * The process part: `spawn` runs one program over an exec request (D43). The platform is the one read at
 * connect; the network probe runs once per connection, and only on Linux (macOS is proxy-only).
 */
function processPartFor(ctx: Ctx): ProcessPart {
  /** Whether `unshare --user --map-root-user --net true` works on this connection, remembered per connection. */
  const probes = new Map<number, boolean>();
  const platformOf = (): SystemPlatform => ctx.transport.platform() ?? 'linux';

  const unshareWorks = async (): Promise<boolean> => {
    const id = ctx.transport.connectionId();
    const known = probes.get(id);
    if (known !== undefined) return known;
    const result = await ctx.transport.exec(UNSHARE_PROBE_LINE, { timeoutMs: PROBE_TIMEOUT_MS });
    if (!result.started) return false;
    const works = !result.timedOut && result.code === 0;
    probes.set(id, works);
    return works;
  };

  /** The wrapper choice for this server: the same answer for networkLevel and for a spawn. */
  const choiceFor = async () => {
    const platform = platformOf();
    if (platform !== 'linux')
      return chooseNetwork(platform, { unshareWorks: false, sandboxExecExists: false });
    return chooseNetwork('linux', { unshareWorks: await unshareWorks(), sandboxExecExists: false });
  };

  return {
    get platform() {
      return platformOf();
    },
    networkLevel: async () => (await choiceFor()).level,
    spawn: async (file, argv, options) => {
      if (!posix.isAbsolute(options.cwd) || options.cwd.includes('\0')) return { started: false };
      let command = file;
      let args = [...argv];
      let env = options.env;
      let network: NetworkLevel | undefined;
      // The writer's command gets the network limit and the dead proxies (D31), as on the other backends.
      if (options.network === 'none') {
        const choice = await choiceFor();
        const wrapped = wrapCommand(choice, file, args);
        command = wrapped.command;
        args = wrapped.args;
        env = { ...env, ...writerNetworkEnv() };
        network = choice.level;
      }
      const { outcome } = await runProgram(ctx, {
        cwd: options.cwd,
        command,
        args,
        env,
        network,
        options,
      });
      return outcome;
    },
  };
}

/** The SSH backend for one saved server. Its parts share one transport, and none falls back to local. */
export function createSshEnvironment(options: SshEnvironmentOptions): Environment {
  const ctx: Ctx = { transport: options.transport };
  const files = filesPartFor(ctx);
  return {
    path: pathPart,
    files,
    process: processPartFor(ctx),
    watch: pollWatchPart(files, options.pollMs ?? SSH_POLL_MS),
    git: createGit(gitLauncherFor(ctx)),
    connection: connectionPartFor(options.transport),
  };
}
