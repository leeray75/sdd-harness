// The SSH transport (D43, p4-env-ssh): the seam between the SSH backend and one server. The backend (ssh.ts)
// talks only to the `SshTransport` interface, so the tests use a fake (tests/support/fake-ssh-transport.ts)
// and no network is needed. `appSshTransport` is the app's transport over `ssh2`: the only code under src/
// that imports ssh2 (tests/unit/env-boundary.test.ts). It keeps one client per server, checks the pinned host
// key, reads the credentials at connect time, reads the system name and the user's ids once per connection,
// and never reconnects by itself. Runs only in main.

import { createHash } from 'node:crypto';
import { Client, type ClientChannel, type ConnectConfig, type SFTPWrapper } from 'ssh2';
import type { Logger } from '../log';
import type { SshAuth, SshServer } from '../projects/servers';
import type { SecretStore } from '../secrets/store';
import { localEnvironment } from './local';
import { secretName } from './ssh-command';
import type { ConnectionState } from './types';

/** The reasons a connect fails. Each one maps to a fixed reason in the backend's reconnect. */
export type ConnectFailure =
  'host-key-unknown' | 'host-key-changed' | 'auth-failed' | 'unreachable' | 'unsupported-system';

/** The outcome of a connect. A host key failure carries the offered fingerprint, a public value. */
export type ConnectResult =
  { ok: true } | { ok: false; code: ConnectFailure; fingerprint?: string };

/** The systems the backend supports: the platform read by `uname -s` at connect. */
export type SystemPlatform = 'linux' | 'darwin';

/** The attributes of one remote file, as SFTP gives them. Times are in seconds. */
export interface SftpAttributes {
  mode: number;
  size: number;
  uid: number;
  gid: number;
  atime: number;
  mtime: number;
}

/** One entry of a folder listing. */
export interface SftpEntry {
  name: string;
  attrs: SftpAttributes;
}

/** An open remote file. `read` gives fewer bytes, or none, at the end of the file. */
export interface SftpFile {
  read(position: number, length: number): Promise<Buffer>;
  write(data: Buffer, position: number): Promise<void>;
  stat(): Promise<SftpAttributes>;
  close(): Promise<void>;
}

/** An error with an SFTP status name or `ENOTCONN` as its `code`. */
export type SftpError = Error & { code: string };

/**
 * The SFTP calls the files part needs. Each one resolves a value or rejects with an error whose `code` is
 * an SFTP status name (`NO_SUCH_FILE`, `PERMISSION_DENIED`, `FAILURE`, and so on), or `ENOTCONN` when the
 * session is not up.
 */
export interface SshSftp {
  stat(path: string): Promise<SftpAttributes>;
  lstat(path: string): Promise<SftpAttributes>;
  realpath(path: string): Promise<string>;
  readlink(path: string): Promise<string>;
  readdir(path: string): Promise<SftpEntry[]>;
  mkdir(path: string): Promise<void>;
  rmdir(path: string): Promise<void>;
  /** Removes one file or link (never a folder). */
  unlink(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** True when the server offers the `posix-rename@openssh.com` extension. */
  readonly hasPosixRename: boolean;
  /** Renames over an existing file, through the extension. Only called when `hasPosixRename` is true. */
  posixRename(from: string, to: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  symlink(target: string, path: string): Promise<void>;
  open(path: string, flags: 'r' | 'w' | 'wx'): Promise<SftpFile>;
}

/** The options of one exec request. */
export interface SshExecOptions {
  /** The limit of the request, in milliseconds. On expiry the channel is closed and `timedOut` is set. */
  timeoutMs: number;
  /** Aborting closes the channel and sets `aborted`. */
  signal?: AbortSignal;
  /** Receives each chunk of stdout and stderr while the request runs. */
  onOutput?: (chunk: Buffer) => void;
  /** Collects stdout and stderr, up to maxBytes each, for the caller. */
  capture?: { maxBytes: number };
}

/** How an exec request ended. `started: false` when the server is not connected. Never a rejection. */
export type SshExecResult =
  | { started: false }
  | {
      started: true;
      code: number | null;
      signal: NodeJS.Signals | null;
      timedOut: boolean;
      aborted: boolean;
      stdout?: Buffer;
      stderr?: Buffer;
      truncated?: boolean;
    };

/** The seam between the SSH backend and one server (D43). */
export interface SshTransport {
  /** `connected` while the session is up, `unreachable` otherwise. It never reconnects by itself. */
  state(): ConnectionState;
  /** Calls the listener when the state changes. Returns the function that stops it. */
  onChange(listener: (state: ConnectionState) => void): () => void;
  /** Opens the session, checks the host key, signs in and reads the system name. Never rejects. */
  connect(): Promise<ConnectResult>;
  /** The platform read at the last successful connect, or null before one. */
  platform(): SystemPlatform | null;
  /** The uid and group ids of the signed-in user, read at the last successful connect, or null. */
  identity(): { uid: number; gids: number[] } | null;
  /** Counts up on each successful connect. A per-connection value (the network probe) is kept per id. */
  connectionId(): number;
  /** The SFTP session. Every call rejects with `ENOTCONN` while the session is not up. */
  readonly sftp: SshSftp;
  /** Runs one command string on a new channel. Never rejects; `{ started: false }` when not connected. */
  exec(command: string, options: SshExecOptions): Promise<SshExecResult>;
}

// -- the host key (D43) ---------------------------------------------------------------------------

/** The result of checking an offered host key against the pinned one. */
export type HostKeyDecision =
  { ok: true } | { ok: false; code: 'host-key-unknown' | 'host-key-changed' };

/** The fingerprint of a host key blob: `SHA256:` and the base64 digest without its padding. */
export function fingerprintOf(keyBlob: Buffer): string {
  return `SHA256:${createHash('sha256').update(keyBlob).digest('base64').replace(/=+$/, '')}`;
}

/**
 * The pinned-key rule (D43): no pin is `host-key-unknown`, a different key is `host-key-changed` (and the pin
 * is never replaced here), and the pinned key is accepted.
 */
export function checkHostKey(pinned: string | null, offered: string): HostKeyDecision {
  if (pinned === null) return { ok: false, code: 'host-key-unknown' };
  return pinned === offered ? { ok: true } : { ok: false, code: 'host-key-changed' };
}

// -- the credentials (D43) ------------------------------------------------------------------------

/** The Windows named pipe of the OpenSSH agent, used when SSH_AUTH_SOCK is not set. */
const WINDOWS_AGENT_PIPE = '\\\\.\\pipe\\openssh-ssh-agent';

/** The part of a connect config that carries the sign-in. Read at connect time, never stored. */
export type SignIn = Pick<ConnectConfig, 'agent' | 'password' | 'privateKey' | 'passphrase'>;

/** The sign-in for a server, or false when a stored secret or the key file is missing. */
export type SignInResult = { ok: true; signIn: SignIn } | { ok: false };

/**
 * The credentials of one connect (D43). A password comes from `ssh-<id>-password`, a key passphrase from
 * `ssh-<id>-passphrase`, a private key from its file (read in memory through the local files part), and agent
 * auth uses SSH_AUTH_SOCK or the Windows agent pipe. Nothing here logs or stores a value.
 */
export async function signInFor(
  server: SshServer,
  secrets: SecretStore,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SignInResult> {
  const auth: SshAuth = server.auth;
  if (auth.method === 'agent') {
    const socket =
      env['SSH_AUTH_SOCK'] ?? (process.platform === 'win32' ? WINDOWS_AGENT_PIPE : undefined);
    return { ok: true, signIn: socket === undefined ? {} : { agent: socket } };
  }
  if (auth.method === 'password') {
    const password = readSecret(secrets, secretName(server.id, 'password'));
    return password === null ? { ok: false } : { ok: true, signIn: { password } };
  }
  try {
    const privateKey = await localEnvironment().files.readFile(auth.keyPath);
    if (!auth.hasPassphrase) return { ok: true, signIn: { privateKey } };
    const passphrase = readSecret(secrets, secretName(server.id, 'passphrase'));
    return passphrase === null ? { ok: false } : { ok: true, signIn: { privateKey, passphrase } };
  } catch {
    return { ok: false };
  }
}

/** A stored secret, or null when there is none or it cannot be read. Never throws. */
function readSecret(secrets: SecretStore, name: string): string | null {
  try {
    return secrets.read(name);
  } catch {
    return null;
  }
}

// -- the SFTP adapter -----------------------------------------------------------------------------

/** The SFTP status names by protocol code (SSH_FX_*). */
const STATUS_NAMES: Record<number, string> = {
  0: 'OK',
  1: 'EOF',
  2: 'NO_SUCH_FILE',
  3: 'PERMISSION_DENIED',
  4: 'FAILURE',
  5: 'BAD_MESSAGE',
  6: 'NO_CONNECTION',
  7: 'CONNECTION_LOST',
  8: 'OP_UNSUPPORTED',
};

/** An SFTP status error, named. A failure that is not a status means the session is gone: ENOTCONN. */
function sftpError(error: unknown): SftpError {
  const raw = (error as { code?: unknown } | null)?.code;
  const code = typeof raw === 'number' ? (STATUS_NAMES[raw] ?? 'FAILURE') : 'ENOTCONN';
  return Object.assign(new Error(code), { code });
}

/** The error of a call made while the session is down. */
function notConnected(): SftpError {
  return Object.assign(new Error('ENOTCONN'), { code: 'ENOTCONN' });
}

/** The attributes of ssh2's stats, in the shape the backend reads. */
function attrsOf(stats: {
  mode: number;
  size: number;
  uid: number;
  gid: number;
  atime: number;
  mtime: number;
}): SftpAttributes {
  return {
    mode: stats.mode,
    size: stats.size,
    uid: stats.uid,
    gid: stats.gid,
    atime: stats.atime,
    mtime: stats.mtime,
  };
}

/** True for the SFTP end-of-file status, which a read gives at the end of a file. */
function isEof(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 1;
}

/** An open handle over the session the file was opened on. */
function fileOver(session: () => SFTPWrapper | null, handle: Buffer): SftpFile {
  const run = <T>(
    work: (s: SFTPWrapper, done: (error: unknown, value?: T) => void) => void,
  ): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const s = session();
      if (s === null) {
        reject(notConnected());
        return;
      }
      try {
        work(s, (error, value) => (error ? reject(sftpError(error)) : resolve(value as T)));
      } catch (error) {
        reject(sftpError(error));
      }
    });
  return {
    read: (position, length) =>
      run<Buffer>((s, done) => {
        const buffer = Buffer.alloc(length);
        s.read(handle, buffer, 0, length, position, (error, bytesRead) => {
          if (error && !isEof(error)) return done(error);
          done(undefined, buffer.subarray(0, isEof(error) ? 0 : (bytesRead ?? 0)));
        });
      }),
    write: (data, position) =>
      run<void>((s, done) =>
        s.write(handle, data, 0, data.length, position, (error) => done(error)),
      ),
    stat: () =>
      run<SftpAttributes>((s, done) =>
        s.fstat(handle, (error, stats) => (error ? done(error) : done(undefined, attrsOf(stats)))),
      ),
    close: () => run<void>((s, done) => s.close(handle, (error) => done(error))),
  };
}

/** The SFTP calls over the session that is up now. Each rejects with ENOTCONN when there is none. */
function sftpOver(session: () => SFTPWrapper | null): SshSftp {
  const run = <T>(
    work: (s: SFTPWrapper, done: (error: unknown, value?: T) => void) => void,
  ): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const s = session();
      if (s === null) {
        reject(notConnected());
        return;
      }
      try {
        work(s, (error, value) => (error ? reject(sftpError(error)) : resolve(value as T)));
      } catch (error) {
        reject(sftpError(error));
      }
    });
  return {
    stat: (path) =>
      run<SftpAttributes>((s, done) =>
        s.stat(path, (error, stats) => (error ? done(error) : done(undefined, attrsOf(stats)))),
      ),
    lstat: (path) =>
      run<SftpAttributes>((s, done) =>
        s.lstat(path, (error, stats) => (error ? done(error) : done(undefined, attrsOf(stats)))),
      ),
    realpath: (path) =>
      run<string>((s, done) => s.realpath(path, (error, resolved) => done(error, resolved))),
    readlink: (path) =>
      run<string>((s, done) => s.readlink(path, (error, target) => done(error, target))),
    readdir: (path) =>
      run<SftpEntry[]>((s, done) =>
        s.readdir(path, (error, list) =>
          done(
            error,
            list?.map((entry) => ({ name: entry.filename, attrs: attrsOf(entry.attrs) })),
          ),
        ),
      ),
    mkdir: (path) => run<void>((s, done) => s.mkdir(path, (error) => done(error))),
    rmdir: (path) => run<void>((s, done) => s.rmdir(path, (error) => done(error))),
    unlink: (path) => run<void>((s, done) => s.unlink(path, (error) => done(error))),
    rename: (from, to) => run<void>((s, done) => s.rename(from, to, (error) => done(error))),
    get hasPosixRename() {
      // ssh2 records the extensions the server offered in its version reply.
      const extensions = (session() as unknown as { _extensions?: Record<string, string> } | null)
        ?._extensions;
      return extensions?.['posix-rename@openssh.com'] === '1';
    },
    posixRename: (from, to) =>
      run<void>((s, done) => s.ext_openssh_rename(from, to, (error) => done(error))),
    chmod: (path, mode) => run<void>((s, done) => s.chmod(path, mode, (error) => done(error))),
    symlink: (target, path) =>
      run<void>((s, done) => s.symlink(target, path, (error) => done(error))),
    open: async (path, flags) => {
      const handle = await run<Buffer>((s, done) =>
        s.open(path, flags, (error, opened) => done(error, opened)),
      );
      return fileOver(session, handle);
    },
  };
}

// -- the app transport ----------------------------------------------------------------------------

/** What the app's transport is given: the secrets, the log, and the saved server as it is now. */
export interface AppSshDeps {
  secrets: SecretStore;
  logger: Logger;
  /** The saved server with this id as it is now (its host, its pinned key), or null when it was removed. */
  latest?: (id: string) => SshServer | null;
}

/** The keepalive and the handshake limit (D43). */
const KEEPALIVE_MS = 15_000;
const KEEPALIVE_COUNT = 3;
const READY_TIMEOUT_MS = 20_000;
/** How long a closed channel may take to report its end, in milliseconds. */
const CHANNEL_CLOSE_GRACE_MS = 2_000;

/** The text one command printed, or null when it failed. */
function commandText(client: Client, command: string): Promise<string | null> {
  return new Promise((resolve) => {
    client.exec(command, (error, stream) => {
      if (error) {
        resolve(null);
        return;
      }
      let text = '';
      stream.on('data', (chunk: Buffer) => {
        text += chunk.toString('utf8');
      });
      stream.stderr.resume();
      stream.on('close', (code: number | undefined) => resolve(code === 0 ? text : null));
    });
  });
}

/** The app's transport for one saved server (D43). One client, shared by every project on that server. */
export function appSshTransport(server: SshServer, deps: AppSshDeps): SshTransport {
  let client: Client | null = null;
  let session: SFTPWrapper | null = null;
  let state: ConnectionState = 'unreachable';
  let platformValue: SystemPlatform | null = null;
  let identityValue: { uid: number; gids: number[] } | null = null;
  let sessions = 0;
  const listeners = new Set<(next: ConnectionState) => void>();

  const setState = (next: ConnectionState): void => {
    if (next === state) return;
    state = next;
    for (const listener of [...listeners]) listener(next);
  };

  /** Forgets the session. Called when it is lost, or before a new connect. */
  const drop = (lost: Client): void => {
    if (lost !== client) return;
    client = null;
    session = null;
    if (state === 'connected') {
      deps.logger.info(
        'ssh: a connection was lost; the project is unreachable until it reconnects',
      );
    }
    setState('unreachable');
  };

  /** Reads the system name and the user's ids, and opens the SFTP session, once the handshake is done. */
  async function afterReady(next: Client): Promise<ConnectResult> {
    const system = (await commandText(next, 'uname -s'))?.trim();
    if (system === undefined) return { ok: false, code: 'unreachable' };
    if (system !== 'Linux' && system !== 'Darwin') {
      return { ok: false, code: 'unsupported-system' };
    }
    const uid = Number.parseInt((await commandText(next, 'id -u')) ?? '', 10);
    const gids = ((await commandText(next, 'id -G')) ?? '')
      .trim()
      .split(/\s+/)
      .map((part) => Number.parseInt(part, 10))
      .filter((value) => Number.isInteger(value));
    const opened = await new Promise<SFTPWrapper | null>((resolve) => {
      next.sftp((error, sftp) => resolve(error ? null : sftp));
    });
    if (opened === null) return { ok: false, code: 'unreachable' };
    platformValue = system === 'Linux' ? 'linux' : 'darwin';
    identityValue = { uid: Number.isInteger(uid) ? uid : -1, gids };
    session = opened;
    sessions += 1;
    setState('connected');
    return { ok: true };
  }

  const transport: SshTransport = {
    state: () => state,
    onChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    connect: async (): Promise<ConnectResult> => {
      if (client !== null) {
        // A deliberate new connect replaces the session without the lost-connection note.
        const previous = client;
        client = null;
        session = null;
        setState('unreachable');
        previous.end();
      }
      const current = deps.latest === undefined ? server : deps.latest(server.id);
      if (current === null) return { ok: false, code: 'unreachable' };
      const signed = await signInFor(current, deps.secrets);
      if (!signed.ok) return { ok: false, code: 'auth-failed' };

      const next = new Client();
      client = next;
      let hostFailure: {
        code: 'host-key-unknown' | 'host-key-changed';
        fingerprint: string;
      } | null = null;
      const outcome = await new Promise<ConnectResult>((resolve) => {
        let settled = false;
        const settle = (result: ConnectResult): void => {
          if (settled) return;
          settled = true;
          resolve(result);
        };
        next.on('ready', () => {
          void afterReady(next).then(settle, () => settle({ ok: false, code: 'unreachable' }));
        });
        next.on('error', (error: Error & { level?: string }) => {
          if (hostFailure !== null) {
            settle({ ok: false, code: hostFailure.code, fingerprint: hostFailure.fingerprint });
          } else if (error.level === 'client-authentication') {
            settle({ ok: false, code: 'auth-failed' });
          } else {
            settle({ ok: false, code: 'unreachable' });
          }
        });
        next.on('close', () => {
          settle({ ok: false, code: 'unreachable' });
          drop(next);
        });
        next.on('end', () => drop(next));
        next.connect({
          host: current.host,
          port: current.port,
          username: current.user,
          ...signed.signIn,
          hostVerifier: (key: Buffer) => {
            const offered = fingerprintOf(key);
            const decision = checkHostKey(current.hostKey, offered);
            if (decision.ok) return true;
            hostFailure = { code: decision.code, fingerprint: offered };
            return false;
          },
          readyTimeout: READY_TIMEOUT_MS,
          keepaliveInterval: KEEPALIVE_MS,
          keepaliveCountMax: KEEPALIVE_COUNT,
        });
      });
      if (!outcome.ok) {
        if (client === next) {
          client = null;
          session = null;
          setState('unreachable');
        }
        next.end();
      }
      return outcome;
    },
    platform: () => platformValue,
    identity: () => identityValue,
    connectionId: () => sessions,
    sftp: sftpOver(() => session),
    exec: (command, options) => execOver(() => client, state, command, options),
  };
  return transport;
}

/** One exec request on the connected client. Never rejects; output after a stop is not passed on. */
function execOver(
  current: () => Client | null,
  state: ConnectionState,
  command: string,
  options: SshExecOptions,
): Promise<SshExecResult> {
  const client = current();
  if (client === null || state !== 'connected') return Promise.resolve({ started: false });
  return new Promise<SshExecResult>((resolve) => {
    client.exec(command, (error, channel: ClientChannel) => {
      if (error) {
        resolve({ started: false });
        return;
      }
      let stopping: 'timeout' | 'aborted' | null = null;
      let done = false;
      let graceTimer: NodeJS.Timeout | undefined;
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let kept = 0;
      let truncated = false;
      const keep = (parts: Buffer[], chunk: Buffer): void => {
        if (options.capture === undefined) return;
        if (kept + chunk.length > options.capture.maxBytes) {
          truncated = true;
          return;
        }
        kept += chunk.length;
        parts.push(chunk);
      };
      const finish = (code: number | null, signal: NodeJS.Signals | null): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (graceTimer !== undefined) clearTimeout(graceTimer);
        options.signal?.removeEventListener('abort', onAbort);
        resolve({
          started: true,
          code,
          signal,
          timedOut: stopping === 'timeout',
          aborted: stopping === 'aborted',
          ...(options.capture === undefined
            ? {}
            : { stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), truncated }),
        });
      };
      const stop = (reason: 'timeout' | 'aborted'): void => {
        if (done || stopping !== null) return;
        stopping = reason;
        channel.close();
        graceTimer = setTimeout(() => finish(null, null), CHANNEL_CLOSE_GRACE_MS);
      };
      const onAbort = (): void => stop('aborted');
      const timer = setTimeout(() => stop('timeout'), options.timeoutMs);
      if (options.signal?.aborted === true) onAbort();
      else options.signal?.addEventListener('abort', onAbort, { once: true });

      channel.on('data', (chunk: Buffer) => {
        if (stopping !== null || done) return;
        options.onOutput?.(chunk);
        keep(stdout, chunk);
      });
      channel.stderr.on('data', (chunk: Buffer) => {
        if (stopping !== null || done) return;
        options.onOutput?.(chunk);
        keep(stderr, chunk);
      });
      channel.on('close', (code: number | undefined, signal: string | undefined) =>
        finish(code ?? null, (signal as NodeJS.Signals | undefined) ?? null),
      );
    });
  });
}
