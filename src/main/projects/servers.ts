// The saved SSH servers (D43, p4-env-ssh). A server is where an SSH project's files and programs are: its
// address, its user, how to sign in and the host key pinned for it. The list is one JSON file in app data,
// `ssh-servers.json`, saved whole through the one atomic writer after each write. No password or key
// passphrase is ever in that file: each one lives in the secret store under `ssh-<serverId>-password` or
// `ssh-<serverId>-passphrase`, and is read only at connect time (the transport, D43).
//
// The file is `{ "version": 1, "servers": [...] }`. A file that cannot be read, is not JSON, has another
// version or holds an invalid server is renamed aside (`ssh-servers.json.corrupt-<timestamp>`) with one
// log line giving only a reason code, and the store starts empty (as the project store does, D40).
//
// Refusals are fixed text and never echo the input. Every write runs one at a time, and a failed save
// leaves the list and the secrets as they were. Main only; the store reads and writes through the local
// environment's files part (D41), so it does not import node:fs.

import { randomUUID } from 'node:crypto';
import { isIPv6 } from 'node:net';
import { dirname, isAbsolute } from 'node:path';
import { hasLineBreak } from '../../shared/project-rules';
import { localEnvironment } from '../env';
import { secretName, type SecretKind } from '../env/ssh-command';
import type { Logger } from '../log';
import { MAX_SECRET_VALUE_LENGTH, type SecretStore } from '../secrets/store';
import { writeFileAtomic } from '../tools/atomic-write';

/** The file name of the saved servers, in app data. */
export const SERVERS_FILE_NAME = 'ssh-servers.json';

export { secretName, type SecretKind } from '../env/ssh-command';

/** How the app signs in to a server (D43). The key's passphrase and a password are never here. */
export type SshAuth =
  | { method: 'key'; keyPath: string; hasPassphrase: boolean }
  | { method: 'agent' }
  | { method: 'password' };

/** One saved server. `hostKey` is a pinned `SHA256:<base64>` fingerprint, or null until it is trusted. */
export interface SshServer {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  auth: SshAuth;
  hostKey: string | null;
}

/** The result of a write: the server it touched, or the fixed reason it was refused. */
export type ServerResult = { ok: true; server: SshServer } | { ok: false; reason: string };

/** The fixed refusal reasons. None echoes a value from the input. */
export const SERVER_REASONS = {
  noServer: 'no saved server with this id',
  invalid: 'the server details are not valid',
  name: 'the name must be 1 to 80 characters with no line break',
  host: 'the host must be a DNS name, an IPv4 address or an IPv6 address',
  port: 'the port must be a whole number from 1 to 65535',
  user: 'the user name is not valid',
  auth: 'the sign-in method is not valid',
  keyPath: 'the key file must be an absolute path to a file',
  secret: 'the password or key passphrase is not valid',
  secretRequired: 'a password or key passphrase is needed for this sign-in method',
  secretUnexpected: 'no password or key passphrase is used with this sign-in method',
  secretSave: 'the password or key passphrase could not be saved, so nothing changed',
  fingerprint: 'the host key fingerprint must be a SHA256 fingerprint',
  hostKey: 'the host key is pinned only by trusting it',
  inUse: 'a project uses this server, so it cannot be removed',
  save: 'the servers could not be saved, so nothing changed',
  failed: 'the action failed',
} as const;

/** The longest server name, in characters. */
export const MAX_SERVER_NAME_LENGTH = 80;

/** The default SSH port. */
export const DEFAULT_SSH_PORT = 22;

/** The fields a caller may set when a server is added or changed. */
const FIELD_KEYS = ['name', 'host', 'port', 'user', 'auth'] as const;

/** The secret a sign-in method needs, or null when it needs none. */
export function secretKindFor(auth: SshAuth): SecretKind | null {
  if (auth.method === 'password') return 'password';
  if (auth.method === 'key' && auth.hasPassphrase) return 'passphrase';
  return null;
}

export interface ServerStoreOptions {
  /** The file, for example `<userData>/ssh-servers.json`. */
  filePath: string;
  /** The secret store that holds each server's password and key passphrase. */
  secrets: SecretStore;
  logger: Logger;
}

export interface ServerStore {
  /** Reads the file once. Called at start; a corrupt file is set aside and the store starts empty. */
  load(): Promise<void>;
  /** The saved servers, in the order they were added. */
  list(): SshServer[];
  /** The server with this id, or null. */
  get(id: string): SshServer | null;
  /**
   * Adds a server. Its host key is not pinned yet. `secret` is the password or key passphrase the
   * sign-in method needs, and it is saved to the secret store, never to the file.
   */
  add(input: unknown, secret?: string): Promise<ServerResult>;
  /** Changes some fields. A changed host or port clears the pinned host key. */
  update(id: string, changes: unknown, secret?: string): Promise<ServerResult>;
  /** Pins a host key fingerprint for the server. Only this pins a key. */
  trustHostKey(id: string, fingerprint: unknown): Promise<ServerResult>;
  /** Drops the server and its secrets. Refused while `inUse(id)` is true. */
  remove(id: string, inUse: (id: string) => boolean): Promise<ServerResult>;
}

type Check<T> = { ok: true; value: T } | { ok: false; reason: string };

function ok<T>(value: T): Check<T> {
  return { ok: true, value };
}

function fail<T = never>(reason: string): Check<T> {
  return { ok: false, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DNS_NAME = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const USER_NAME = /^[a-z_][a-z0-9_.-]{0,31}$/;
const FINGERPRINT = /^SHA256:[A-Za-z0-9+/]{43}$/;
const MAX_KEY_PATH_LENGTH = 1024;

/** The trimmed name when it is 1 to 80 characters with no line break; otherwise null. */
function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const length = Array.from(trimmed).length;
  if (length < 1 || length > MAX_SERVER_NAME_LENGTH) return null;
  if (hasLineBreak(trimmed)) return null;
  return trimmed;
}

/** A DNS name, an IPv4 literal, or an IPv6 literal (bare or in brackets). No space, no `@`, no leading `-`. */
function cleanHost(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 255) return null;
  if (value.startsWith('[') && value.endsWith(']')) {
    return isIPv6(value.slice(1, -1)) ? value : null;
  }
  if (IPV4.test(value)) {
    return value.split('.').every((octet) => Number(octet) <= 255) ? value : null;
  }
  if (isIPv6(value)) return value;
  return DNS_NAME.test(value) ? value : null;
}

function cleanPort(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return value >= 1 && value <= 65535 ? value : null;
}

function cleanUser(value: unknown): string | null {
  return typeof value === 'string' && USER_NAME.test(value) ? value : null;
}

/** The sign-in method, with exactly the keys of its shape. A key file must be an absolute local path. */
function cleanAuth(value: unknown): Check<SshAuth> {
  if (!isRecord(value)) return fail(SERVER_REASONS.auth);
  const keys = Object.keys(value).sort().join(',');
  if (value['method'] === 'agent' || value['method'] === 'password') {
    if (keys !== 'method') return fail(SERVER_REASONS.auth);
    return ok<SshAuth>({ method: value['method'] === 'agent' ? 'agent' : 'password' });
  }
  if (value['method'] === 'key') {
    if (keys !== 'hasPassphrase,keyPath,method') return fail(SERVER_REASONS.auth);
    const keyPath = value['keyPath'];
    if (
      typeof keyPath !== 'string' ||
      keyPath === '' ||
      keyPath.length > MAX_KEY_PATH_LENGTH ||
      keyPath.includes('\0') ||
      hasLineBreak(keyPath) ||
      !isAbsolute(keyPath)
    ) {
      return fail(SERVER_REASONS.keyPath);
    }
    const hasPassphrase = value['hasPassphrase'];
    if (typeof hasPassphrase !== 'boolean') return fail(SERVER_REASONS.auth);
    return ok<SshAuth>({ method: 'key', keyPath, hasPassphrase });
  }
  return fail(SERVER_REASONS.auth);
}

/** The fields of a server, each checked. The port defaults to 22 when it is not given. */
interface ServerFields {
  name: string;
  host: string;
  port: number;
  user: string;
  auth: SshAuth;
}

function fieldsOf(input: Record<string, unknown>): Check<ServerFields> {
  const name = cleanName(input['name']);
  if (name === null) return fail(SERVER_REASONS.name);
  const host = cleanHost(input['host']);
  if (host === null) return fail(SERVER_REASONS.host);
  const port = input['port'] === undefined ? DEFAULT_SSH_PORT : cleanPort(input['port']);
  if (port === null) return fail(SERVER_REASONS.port);
  const user = cleanUser(input['user']);
  if (user === null) return fail(SERVER_REASONS.user);
  const auth = cleanAuth(input['auth']);
  if (!auth.ok) return auth;
  return ok({ name, host, port, user, auth: auth.value });
}

/** A copy a caller can keep without changing the store. */
function copyOf(server: SshServer): SshServer {
  return { ...server, auth: { ...server.auth } };
}

/** A server read from the file, or null when any field fails its check. */
function storedServer(value: unknown): SshServer | null {
  if (!isRecord(value)) return null;
  const id = value['id'];
  if (typeof id !== 'string' || !UUID_PATTERN.test(id)) return null;
  const fields = fieldsOf(value);
  if (!fields.ok) return null;
  // A stored name is the trimmed name, as the store wrote it.
  if (fields.value.name !== value['name']) return null;
  const hostKey = value['hostKey'];
  if (hostKey !== null && (typeof hostKey !== 'string' || !FINGERPRINT.test(hostKey))) return null;
  return { id, ...fields.value, hostKey };
}

/** The stored servers, or null when one fails a check or two share an id. */
function storedServers(values: unknown[]): SshServer[] | null {
  const out: SshServer[] = [];
  for (const value of values) {
    const server = storedServer(value);
    if (server === null || out.some((other) => other.id === server.id)) return null;
    out.push(server);
  }
  return out;
}

function isNotFound(error: unknown): boolean {
  return isRecord(error) && error['code'] === 'ENOENT';
}

/** The fixed "not valid" check for an input that holds only the field keys (add) or a subset (update). */
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

export function createServerStore(options: ServerStoreOptions): ServerStore {
  const { filePath, secrets, logger } = options;
  let servers: SshServer[] = [];

  // One write at a time, so each write starts from the list the last one left.
  let queue: Promise<unknown> = Promise.resolve();
  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task);
    queue = run.catch(() => undefined);
    return run;
  }

  /** Saves a whole list. True only when the file was written. */
  async function persist(next: SshServer[]): Promise<boolean> {
    try {
      const files = localEnvironment().files;
      await files.mkdir(dirname(filePath), { recursive: true });
      const text = `${JSON.stringify({ version: 1, servers: next }, null, 2)}\n`;
      const written = await writeFileAtomic(files, filePath, Buffer.from(text, 'utf8'));
      return written.ok;
    } catch {
      return false;
    }
  }

  /** Renames a corrupt file aside and starts empty. The log line gives a reason code only. */
  async function setAside(reason: string): Promise<void> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = `${filePath}.corrupt-${stamp}`;
    servers = [];
    try {
      await localEnvironment().files.rename(filePath, target);
      logger.error(
        `server store: ${SERVERS_FILE_NAME} is not valid (reason: ${reason}); it was set aside and the store starts empty`,
      );
    } catch {
      logger.error(
        `server store: ${SERVERS_FILE_NAME} is not valid (reason: ${reason}); setting it aside failed, so the store starts empty and the next save replaces it`,
      );
    }
  }

  async function loadOnce(): Promise<void> {
    let text: string;
    try {
      text = (await localEnvironment().files.readFile(filePath)).toString('utf8');
    } catch (error) {
      if (isNotFound(error)) {
        servers = [];
        return;
      }
      await setAside('unreadable');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      await setAside('not-json');
      return;
    }
    if (!isRecord(parsed) || parsed['version'] !== 1) {
      await setAside('version');
      return;
    }
    const list = parsed['servers'];
    const checked = Array.isArray(list) ? storedServers(list) : null;
    if (checked === null) {
      await setAside('invalid-server');
      return;
    }
    servers = checked;
  }

  /** The secret's current value: a string, null for no entry, or undefined when it cannot be read. */
  function readSecret(name: string): string | null | undefined {
    try {
      return secrets.read(name);
    } catch {
      return undefined;
    }
  }

  /** Saves one secret. False when the store refuses or fails; nothing is written then. */
  function saveSecret(name: string, value: string): boolean {
    try {
      secrets.save(name, value);
      return true;
    } catch {
      return false;
    }
  }

  /** Puts a secret back to what it was: its old value, or no entry. Never throws. */
  function restoreSecret(name: string, previous: string | null): void {
    try {
      if (previous === null) secrets.delete(name);
      else secrets.save(name, previous);
    } catch {
      // The entry keeps its new value; the next change of this server replaces it.
    }
  }

  /** Removes one secret entry, quietly. */
  function deleteSecret(name: string): void {
    try {
      secrets.delete(name);
    } catch {
      // Nothing to report beyond the refusal the caller already has.
    }
  }

  /** The secret value is given when it is a non-empty string within the store's size limit. */
  function secretGiven(secret: string | undefined): Check<string | undefined> {
    if (secret === undefined) return ok(undefined);
    if (typeof secret !== 'string' || secret.length === 0) return fail(SERVER_REASONS.secret);
    if (secret.length > MAX_SECRET_VALUE_LENGTH) return fail(SERVER_REASONS.secret);
    return ok(secret);
  }

  function indexOf(id: string): number {
    return servers.findIndex((server) => server.id === id);
  }

  return {
    load: () =>
      enqueue(async () => {
        await loadOnce();
      }),

    list: () => servers.map(copyOf),

    get: (id) => {
      const server = servers.find((candidate) => candidate.id === id);
      return server === undefined ? null : copyOf(server);
    },

    add: (input, secret) =>
      enqueue(async (): Promise<ServerResult> => {
        try {
          if (!isRecord(input)) return refuse(SERVER_REASONS.invalid);
          if (input['hostKey'] !== undefined) return refuse(SERVER_REASONS.hostKey);
          if (!onlyKeys(input, FIELD_KEYS)) return refuse(SERVER_REASONS.invalid);
          const fields = fieldsOf(input);
          if (!fields.ok) return refuse(fields.reason);
          const given = secretGiven(secret);
          if (!given.ok) return refuse(given.reason);
          const kind = secretKindFor(fields.value.auth);
          if (kind === null && given.value !== undefined)
            return refuse(SERVER_REASONS.secretUnexpected);
          if (kind !== null && given.value === undefined)
            return refuse(SERVER_REASONS.secretRequired);

          const server: SshServer = { id: randomUUID(), ...fields.value, hostKey: null };
          if (kind !== null && given.value !== undefined) {
            if (!saveSecret(secretName(server.id, kind), given.value)) {
              return refuse(SERVER_REASONS.secretSave);
            }
          }
          const next = [...servers, server];
          if (!(await persist(next))) {
            if (kind !== null) deleteSecret(secretName(server.id, kind));
            return refuse(SERVER_REASONS.save);
          }
          servers = next;
          return { ok: true, server: copyOf(server) };
        } catch {
          return refuse(SERVER_REASONS.failed);
        }
      }),

    update: (id, changes, secret) =>
      enqueue(async (): Promise<ServerResult> => {
        try {
          const index = indexOf(id);
          if (index < 0) return refuse(SERVER_REASONS.noServer);
          const current = servers[index];
          if (current === undefined) return refuse(SERVER_REASONS.noServer);
          if (!isRecord(changes) || !onlyKeys(changes, FIELD_KEYS)) {
            return refuse(SERVER_REASONS.invalid);
          }
          const given = secretGiven(secret);
          if (!given.ok) return refuse(given.reason);
          const fields = fieldsOf({
            name: current.name,
            host: current.host,
            port: current.port,
            user: current.user,
            auth: current.auth,
            ...changes,
          });
          if (!fields.ok) return refuse(fields.reason);

          const kind = secretKindFor(fields.value.auth);
          if (kind === null && given.value !== undefined)
            return refuse(SERVER_REASONS.secretUnexpected);
          // A new kind of secret must be given; the same kind already stored is kept.
          if (kind !== null && given.value === undefined && secretKindFor(current.auth) !== kind) {
            return refuse(SERVER_REASONS.secretRequired);
          }

          // A changed host or port is a different server, so its pinned key no longer applies.
          const moved = fields.value.host !== current.host || fields.value.port !== current.port;
          const updated: SshServer = {
            ...current,
            ...fields.value,
            hostKey: moved ? null : current.hostKey,
          };

          let previous: string | null | undefined;
          const name = kind === null ? null : secretName(id, kind);
          if (name !== null && given.value !== undefined) {
            previous = readSecret(name);
            if (previous === undefined || !saveSecret(name, given.value)) {
              return refuse(SERVER_REASONS.secretSave);
            }
          }
          const next = servers.map((server, at) => (at === index ? updated : server));
          if (!(await persist(next))) {
            if (name !== null && given.value !== undefined && previous !== undefined) {
              restoreSecret(name, previous);
            }
            return refuse(SERVER_REASONS.save);
          }
          servers = next;
          // A secret the sign-in method no longer uses is removed.
          for (const stale of ['password', 'passphrase'] as const) {
            if (stale !== kind) deleteSecret(secretName(id, stale));
          }
          return { ok: true, server: copyOf(updated) };
        } catch {
          return refuse(SERVER_REASONS.failed);
        }
      }),

    trustHostKey: (id, fingerprint) =>
      enqueue(async (): Promise<ServerResult> => {
        try {
          const index = indexOf(id);
          if (index < 0) return refuse(SERVER_REASONS.noServer);
          if (typeof fingerprint !== 'string' || !FINGERPRINT.test(fingerprint)) {
            return refuse(SERVER_REASONS.fingerprint);
          }
          const current = servers[index];
          if (current === undefined) return refuse(SERVER_REASONS.noServer);
          const updated: SshServer = { ...current, hostKey: fingerprint };
          const next = servers.map((server, at) => (at === index ? updated : server));
          if (!(await persist(next))) return refuse(SERVER_REASONS.save);
          servers = next;
          return { ok: true, server: copyOf(updated) };
        } catch {
          return refuse(SERVER_REASONS.failed);
        }
      }),

    remove: (id, inUse) =>
      enqueue(async (): Promise<ServerResult> => {
        try {
          const index = indexOf(id);
          if (index < 0) return refuse(SERVER_REASONS.noServer);
          if (inUse(id)) return refuse(SERVER_REASONS.inUse);
          const removed = servers[index];
          if (removed === undefined) return refuse(SERVER_REASONS.noServer);
          const next = servers.filter((_server, at) => at !== index);
          if (!(await persist(next))) return refuse(SERVER_REASONS.save);
          servers = next;
          deleteSecret(secretName(id, 'password'));
          deleteSecret(secretName(id, 'passphrase'));
          return { ok: true, server: copyOf(removed) };
        } catch {
          return refuse(SERVER_REASONS.failed);
        }
      }),
  };
}

/** A refusal with a fixed reason. */
function refuse(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}
