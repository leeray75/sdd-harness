import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createServerStore,
  SERVER_REASONS,
  secretName,
  SERVERS_FILE_NAME,
  type ServerStore,
} from '../../src/main/projects/servers';
import type { Logger } from '../../src/main/log';
import type { SecretStore } from '../../src/main/secrets/store';

// The saved SSH servers (D43, p4-env-ssh, AC1). The store runs on a temp folder and an in-memory secret
// store, so no keychain is touched. Each check reads the saved file and the secret store back, to show
// that a password or passphrase never reaches the file.

const PASSWORD = 'pw-Example-7731';
const PASSPHRASE = 'phrase-Example-4419';
const FINGERPRINT = `SHA256:${'A'.repeat(43)}`;
const OTHER_FINGERPRINT = `SHA256:${'B'.repeat(43)}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface MemorySecrets extends SecretStore {
  values: Map<string, string>;
  failSave: boolean;
}

/** An in-memory secret store with a switch that makes a save fail. */
function memorySecrets(): MemorySecrets {
  const values = new Map<string, string>();
  const store: MemorySecrets = {
    values,
    failSave: false,
    save(name, value) {
      if (store.failSave) throw new Error('secure storage is unavailable');
      values.set(name, value);
    },
    read: (name) => values.get(name) ?? null,
    delete: (name) => values.delete(name),
    listNames: () => [...values.keys()].sort(),
  };
  return store;
}

let base: string;
let file: string;
let secrets: MemorySecrets;
let lines: string[];
let logger: Logger;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'ssh-servers-'));
  file = join(base, SERVERS_FILE_NAME);
  secrets = memorySecrets();
  lines = [];
  logger = { info: (message) => lines.push(message), error: (message) => lines.push(message) };
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

function makeStore(): ServerStore {
  return createServerStore({ filePath: file, secrets, logger });
}

/** The saved file's text, or '' when there is none. */
function savedText(): string {
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

const KEY_AUTH = {
  method: 'key',
  keyPath: join(tmpdir(), 'keys', 'id_ed25519'),
  hasPassphrase: false,
};
const AGENT_AUTH = { method: 'agent' };
const PASSWORD_AUTH = { method: 'password' };

describe('add, list and get (AC1)', () => {
  it('adds a key server with a generated lowercase id, port 22 and no pinned key', async () => {
    const store = makeStore();
    const result = await store.add({
      name: ' Build box ',
      host: 'build.example',
      user: 'deploy',
      auth: KEY_AUTH,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.server).toEqual({
      id: result.server.id,
      name: 'Build box',
      host: 'build.example',
      port: 22,
      user: 'deploy',
      auth: KEY_AUTH,
      hostKey: null,
    });
    expect(result.server.id).toMatch(UUID);
    expect(store.list()).toEqual([result.server]);
    expect(store.get(result.server.id)).toEqual(result.server);
    expect(store.get('00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('returns copies, so a caller cannot change the stored server', async () => {
    const store = makeStore();
    const added = await store.add({
      name: 'Box',
      host: 'box.example',
      user: 'me',
      auth: AGENT_AUTH,
    });
    if (!added.ok) throw new Error('add failed');
    const listed = store.list();
    if (listed[0]?.auth.method !== 'agent') throw new Error('unexpected auth');
    (listed[0].auth as { method: string }).method = 'password';
    expect(store.get(added.server.id)?.auth).toEqual(AGENT_AUTH);
  });

  it('accepts an IPv4 literal and an IPv6 literal bare or in brackets', async () => {
    const store = makeStore();
    expect(
      (await store.add({ name: 'a', host: '192.168.1.20', user: 'u', auth: AGENT_AUTH })).ok,
    ).toBe(true);
    expect((await store.add({ name: 'b', host: '::1', user: 'u', auth: AGENT_AUTH })).ok).toBe(
      true,
    );
    expect(
      (await store.add({ name: 'c', host: '[fe80::1]', user: 'u', auth: AGENT_AUTH })).ok,
    ).toBe(true);
  });

  it('refuses each invalid field with its fixed reason, and echoes no input', async () => {
    const store = makeStore();
    const base_ = { name: 'Box', host: 'box.example', user: 'deploy', auth: AGENT_AUTH };
    const cases: Array<[unknown, string]> = [
      [{ ...base_, name: '' }, SERVER_REASONS.name],
      [{ ...base_, name: 'x'.repeat(81) }, SERVER_REASONS.name],
      [{ ...base_, name: 'two\nlines' }, SERVER_REASONS.name],
      [{ ...base_, host: 'bad host' }, SERVER_REASONS.host],
      [{ ...base_, host: 'user@box' }, SERVER_REASONS.host],
      [{ ...base_, host: '-box' }, SERVER_REASONS.host],
      [{ ...base_, host: '999.1.1.1' }, SERVER_REASONS.host],
      [{ ...base_, port: 0 }, SERVER_REASONS.port],
      [{ ...base_, port: 65536 }, SERVER_REASONS.port],
      [{ ...base_, port: 2.5 }, SERVER_REASONS.port],
      [{ ...base_, port: '22' }, SERVER_REASONS.port],
      [{ ...base_, user: 'Root' }, SERVER_REASONS.user],
      [{ ...base_, user: '' }, SERVER_REASONS.user],
      [{ ...base_, auth: { method: 'token' } }, SERVER_REASONS.auth],
      [{ ...base_, auth: { method: 'agent', extra: 1 } }, SERVER_REASONS.auth],
      [
        { ...base_, auth: { method: 'key', keyPath: 'relative/key', hasPassphrase: false } },
        SERVER_REASONS.keyPath,
      ],
    ];
    for (const [input, reason] of cases) {
      const result = await store.add(input);
      expect(result).toEqual({ ok: false, reason });
    }
    expect(store.list()).toEqual([]);
    expect(existsSync(file)).toBe(false);
  });

  it('requires the secret a sign-in method needs, refuses one it does not need, and refuses a pinned key', async () => {
    const store = makeStore();
    const base_ = { name: 'Box', host: 'box.example', user: 'deploy' };
    expect(await store.add({ ...base_, auth: PASSWORD_AUTH })).toEqual({
      ok: false,
      reason: SERVER_REASONS.secretRequired,
    });
    expect(await store.add({ ...base_, auth: { ...KEY_AUTH, hasPassphrase: true } })).toEqual({
      ok: false,
      reason: SERVER_REASONS.secretRequired,
    });
    expect(await store.add({ ...base_, auth: AGENT_AUTH }, 'extra')).toEqual({
      ok: false,
      reason: SERVER_REASONS.secretUnexpected,
    });
    expect(await store.add({ ...base_, auth: AGENT_AUTH, hostKey: FINGERPRINT })).toEqual({
      ok: false,
      reason: SERVER_REASONS.hostKey,
    });
    expect(await store.add({ ...base_, auth: AGENT_AUTH, extra: true })).toEqual({
      ok: false,
      reason: SERVER_REASONS.invalid,
    });
  });
});

describe('secrets are kept in the secret store, never in the file (AC1, AC12)', () => {
  it('saves a password under the server secret name and keeps it out of the file', async () => {
    const store = makeStore();
    const result = await store.add(
      { name: 'Pass box', host: 'pass.example', user: 'deploy', auth: PASSWORD_AUTH },
      PASSWORD,
    );
    if (!result.ok) throw new Error(result.reason);
    expect(secrets.values.get(secretName(result.server.id, 'password'))).toBe(PASSWORD);
    expect(savedText()).not.toContain(PASSWORD);
    expect(savedText()).toContain(result.server.id);
  });

  it('saves a key passphrase under the passphrase name and keeps it out of the file', async () => {
    const store = makeStore();
    const result = await store.add(
      {
        name: 'Key box',
        host: 'key.example',
        user: 'deploy',
        auth: { ...KEY_AUTH, hasPassphrase: true },
      },
      PASSPHRASE,
    );
    if (!result.ok) throw new Error(result.reason);
    expect(secrets.values.get(secretName(result.server.id, 'passphrase'))).toBe(PASSPHRASE);
    expect(savedText()).not.toContain(PASSPHRASE);
  });

  it('refuses an add whose secret cannot be saved, and leaves no server behind', async () => {
    const store = makeStore();
    secrets.failSave = true;
    const result = await store.add(
      { name: 'Pass box', host: 'pass.example', user: 'deploy', auth: PASSWORD_AUTH },
      PASSWORD,
    );
    expect(result).toEqual({ ok: false, reason: SERVER_REASONS.secretSave });
    expect(store.list()).toEqual([]);
    expect(existsSync(file)).toBe(false);
    expect(secrets.values.size).toBe(0);
  });

  it('a changed password replaces the stored one, and a method change removes a secret the method no longer uses', async () => {
    const store = makeStore();
    const added = await store.add(
      { name: 'Pass box', host: 'pass.example', user: 'deploy', auth: PASSWORD_AUTH },
      PASSWORD,
    );
    if (!added.ok) throw new Error(added.reason);
    const id = added.server.id;

    expect((await store.update(id, { name: 'Renamed' })).ok).toBe(true);
    expect(secrets.values.get(secretName(id, 'password'))).toBe(PASSWORD);

    expect((await store.update(id, { auth: AGENT_AUTH })).ok).toBe(true);
    expect(secrets.values.has(secretName(id, 'password'))).toBe(false);
    expect(savedText()).not.toContain(PASSWORD);
  });
});

describe('update, trust and host key pins (AC1, AC2)', () => {
  it('changes the given fields and keeps the rest', async () => {
    const store = makeStore();
    const added = await store.add({
      name: 'Box',
      host: 'box.example',
      user: 'deploy',
      auth: AGENT_AUTH,
    });
    if (!added.ok) throw new Error(added.reason);
    const updated = await store.update(added.server.id, { name: 'Renamed', user: 'ops' });
    expect(updated).toMatchObject({
      ok: true,
      server: { name: 'Renamed', user: 'ops', host: 'box.example' },
    });
    expect(store.get(added.server.id)?.port).toBe(22);
  });

  it('a changed host or port clears the pinned key, and an unchanged one keeps it', async () => {
    const store = makeStore();
    const added = await store.add({
      name: 'Box',
      host: 'box.example',
      user: 'deploy',
      auth: AGENT_AUTH,
    });
    if (!added.ok) throw new Error(added.reason);
    const id = added.server.id;
    expect(await store.trustHostKey(id, FINGERPRINT)).toMatchObject({
      ok: true,
      server: { hostKey: FINGERPRINT },
    });

    expect(await store.update(id, { name: 'Same host', host: 'box.example' })).toMatchObject({
      ok: true,
      server: { hostKey: FINGERPRINT },
    });
    expect(await store.update(id, { port: 2222 })).toMatchObject({
      ok: true,
      server: { hostKey: null, port: 2222 },
    });

    await store.trustHostKey(id, FINGERPRINT);
    expect(await store.update(id, { host: 'other.example' })).toMatchObject({
      ok: true,
      server: { hostKey: null, host: 'other.example' },
    });
  });

  it('refuses a change that is not a field, an unknown server and an invalid change', async () => {
    const store = makeStore();
    const added = await store.add({
      name: 'Box',
      host: 'box.example',
      user: 'deploy',
      auth: AGENT_AUTH,
    });
    if (!added.ok) throw new Error(added.reason);
    expect(await store.update(added.server.id, { id: 'x' })).toEqual({
      ok: false,
      reason: SERVER_REASONS.invalid,
    });
    expect(await store.update(added.server.id, { hostKey: FINGERPRINT })).toEqual({
      ok: false,
      reason: SERVER_REASONS.invalid,
    });
    expect(await store.update(added.server.id, { host: 'bad host' })).toEqual({
      ok: false,
      reason: SERVER_REASONS.host,
    });
    expect(await store.update('00000000-0000-4000-8000-000000000000', { name: 'x' })).toEqual({
      ok: false,
      reason: SERVER_REASONS.noServer,
    });
  });

  it('asking for a password method without giving one is refused, and a method change is refused without its secret', async () => {
    const store = makeStore();
    const added = await store.add({
      name: 'Box',
      host: 'box.example',
      user: 'deploy',
      auth: AGENT_AUTH,
    });
    if (!added.ok) throw new Error(added.reason);
    expect(await store.update(added.server.id, { auth: PASSWORD_AUTH })).toEqual({
      ok: false,
      reason: SERVER_REASONS.secretRequired,
    });
    expect(store.get(added.server.id)?.auth).toEqual(AGENT_AUTH);
  });

  it('a failed save of a changed password puts the old value back and changes nothing', async () => {
    const store = makeStore();
    const added = await store.add(
      { name: 'Pass box', host: 'pass.example', user: 'deploy', auth: PASSWORD_AUTH },
      PASSWORD,
    );
    if (!added.ok) throw new Error(added.reason);
    // The file is replaced by a folder, so the atomic write cannot land on it.
    rmSync(file);
    mkdirSync(file);
    const result = await store.update(added.server.id, { name: 'Renamed' }, 'new-password-value');
    expect(result).toEqual({ ok: false, reason: SERVER_REASONS.save });
    expect(secrets.values.get(secretName(added.server.id, 'password'))).toBe(PASSWORD);
    expect(store.get(added.server.id)?.name).toBe('Pass box');
  });

  it('trusts a SHA256 fingerprint only, and refuses an unknown server', async () => {
    const store = makeStore();
    const added = await store.add({
      name: 'Box',
      host: 'box.example',
      user: 'deploy',
      auth: AGENT_AUTH,
    });
    if (!added.ok) throw new Error(added.reason);
    expect(await store.trustHostKey(added.server.id, 'MD5:abc')).toEqual({
      ok: false,
      reason: SERVER_REASONS.fingerprint,
    });
    expect(await store.trustHostKey(added.server.id, OTHER_FINGERPRINT)).toMatchObject({
      ok: true,
      server: { hostKey: OTHER_FINGERPRINT },
    });
    expect(await store.trustHostKey('00000000-0000-4000-8000-000000000000', FINGERPRINT)).toEqual({
      ok: false,
      reason: SERVER_REASONS.noServer,
    });
  });
});

describe('remove (AC1)', () => {
  it('is refused while a project uses the server, and then removes the server with its secrets', async () => {
    const store = makeStore();
    const added = await store.add(
      { name: 'Pass box', host: 'pass.example', user: 'deploy', auth: PASSWORD_AUTH },
      PASSWORD,
    );
    if (!added.ok) throw new Error(added.reason);
    const id = added.server.id;

    expect(await store.remove(id, () => true)).toEqual({ ok: false, reason: SERVER_REASONS.inUse });
    expect(store.get(id)).not.toBeNull();
    expect(secrets.values.has(secretName(id, 'password'))).toBe(true);

    const removed = await store.remove(id, () => false);
    expect(removed).toMatchObject({ ok: true, server: { id } });
    expect(store.get(id)).toBeNull();
    expect(secrets.values.size).toBe(0);
    expect(savedText()).not.toContain(id);
    expect(await store.remove(id, () => false)).toEqual({
      ok: false,
      reason: SERVER_REASONS.noServer,
    });
  });
});

describe('the saved file (AC1)', () => {
  it('reloads the saved servers, and a fresh store reads what the first one wrote', async () => {
    const first = makeStore();
    const added = await first.add({
      name: 'Box',
      host: 'box.example',
      user: 'deploy',
      auth: AGENT_AUTH,
    });
    if (!added.ok) throw new Error(added.reason);
    const second = makeStore();
    await second.load();
    expect(second.list()).toEqual([added.server]);
    expect(JSON.parse(savedText())).toEqual({ version: 1, servers: [added.server] });
  });

  it('sets a corrupt file aside with a code-only log line, and starts empty', async () => {
    const secretLike = `not json ${PASSWORD}`;
    writeFileSync(file, secretLike);
    const store = makeStore();
    await store.load();
    expect(store.list()).toEqual([]);
    const moved = readdirSync(base).filter((name) => /^ssh-servers\.json\.corrupt-/.test(name));
    expect(moved).toHaveLength(1);
    expect(readFileSync(join(base, moved[0] ?? ''), 'utf8')).toBe(secretLike);
    expect(lines).toEqual([expect.stringContaining('(reason: not-json)')]);
    expect(lines.join('\n')).not.toContain(PASSWORD);
  });

  it('sets aside a file with another version or an invalid server, with its reason code', async () => {
    writeFileSync(file, JSON.stringify({ version: 2, servers: [] }));
    await makeStore().load();
    expect(lines[0]).toContain('(reason: version)');

    lines.length = 0;
    const invalid = {
      version: 1,
      servers: [
        { id: 'not-a-uuid', name: 'x', host: 'x', user: 'u', auth: AGENT_AUTH, hostKey: null },
      ],
    };
    writeFileSync(file, JSON.stringify(invalid));
    const store = makeStore();
    await store.load();
    expect(store.list()).toEqual([]);
    expect(lines[0]).toContain('(reason: invalid-server)');
  });

  it('loads a valid file with a pinned key and keeps the pin', async () => {
    const store = makeStore();
    const added = await store.add({
      name: 'Box',
      host: 'box.example',
      user: 'deploy',
      auth: AGENT_AUTH,
    });
    if (!added.ok) throw new Error(added.reason);
    await store.trustHostKey(added.server.id, FINGERPRINT);
    const again = makeStore();
    await again.load();
    expect(again.get(added.server.id)?.hostKey).toBe(FINGERPRINT);
    expect(lines).toEqual([]);
  });
});
