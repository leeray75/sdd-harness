import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRedactor, REDACTED } from '../../src/main/secrets/redact';
import {
  createSecretStore,
  MAX_SECRET_VALUE_LENGTH,
  type SecretCrypto,
  type SecretStore,
} from '../../src/main/secrets/store';

const VALUE = 'SENTINEL-STORE-PLAIN-7741';
const OTHER = 'SENTINEL-STORE-OTHER-9902';

/** A reversible fake: XOR with a fixed byte. Not the identity, so ciphertext differs from plaintext. */
function fakeCrypto(overrides: Partial<SecretCrypto> = {}): SecretCrypto {
  const xor = (bytes: Uint8Array): Buffer => Buffer.from(bytes.map((b) => b ^ 0x5a));
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (plain: string) => xor(Buffer.from(plain, 'utf8')),
    decryptString: (encrypted: Buffer) => Buffer.from(xor(encrypted)).toString('utf8'),
    ...overrides,
  };
}

/** Every file under a directory, as its path and contents. */
function listing(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isFile()) {
      out[entry.name] = readFileSync(path).toString('latin1');
    }
  }
  return out;
}

let dir: string;
let filePath: string;

function makeStore(
  crypto: SecretCrypto = fakeCrypto(),
  options: { platform?: NodeJS.Platform; allowWeakBackend?: boolean } = {},
): { store: SecretStore; redactor: ReturnType<typeof createRedactor> } {
  const redactor = createRedactor();
  const store = createSecretStore({
    crypto,
    filePath,
    platform: options.platform ?? 'win32',
    allowWeakBackend: options.allowWeakBackend ?? false,
    redactor,
  });
  return { store, redactor };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'secret-store-'));
  filePath = join(dir, 'secrets.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('secret store: save and read', () => {
  it('reads back the value that was saved', () => {
    const { store } = makeStore();
    store.save('spike', VALUE);
    expect(store.read('spike')).toBe(VALUE);
  });

  it('returns null for a name that has no entry', () => {
    const { store } = makeStore();
    expect(store.read('spike')).toBeNull();
  });

  it('writes no plaintext to the file or to any other file in the directory', () => {
    const { store } = makeStore();
    store.save('spike', VALUE);
    const files = listing(dir);
    expect(Object.keys(files)).toEqual(['secrets.json']);
    for (const content of Object.values(files)) {
      expect(content).not.toContain(VALUE);
    }
  });

  it('writes the documented JSON shape with base64 ciphertext', () => {
    const { store } = makeStore();
    store.save('spike', VALUE);
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as {
      version: number;
      entries: Record<string, string>;
    };
    expect(parsed.version).toBe(1);
    expect(Object.keys(parsed.entries)).toEqual(['spike']);
    expect(Buffer.from(parsed.entries['spike'] ?? '', 'base64').toString('utf8')).not.toBe(VALUE);
  });

  it('leaves no temp file behind after a save', () => {
    const { store } = makeStore();
    store.save('spike', VALUE);
    store.save('other-one', OTHER);
    expect(readdirSync(dir).sort()).toEqual(['secrets.json']);
  });

  it('overwrites an existing entry with the same name', () => {
    const { store } = makeStore();
    store.save('spike', VALUE);
    store.save('spike', OTHER);
    expect(store.read('spike')).toBe(OTHER);
  });

  it('writes the file with mode 0o600 where the platform has file modes', () => {
    const { store } = makeStore(fakeCrypto(), { platform: 'linux', allowWeakBackend: true });
    store.save('spike', VALUE);
    if (process.platform !== 'win32') {
      expect(statSync(filePath).mode & 0o777).toBe(0o600);
    }
  });
});

describe('secret store: name and value checks', () => {
  it('accepts names that match the pattern', () => {
    const { store } = makeStore();
    store.save('a', VALUE);
    store.save('spike-2', VALUE);
    store.save('0', VALUE);
    store.save('a'.repeat(64), VALUE);
    expect(store.listNames()).toEqual(['0', 'a', 'a'.repeat(64), 'spike-2']);
  });

  it('refuses names that do not match, without echoing them', () => {
    const { store } = makeStore();
    const bad = ['', '-spike', 'Spike', 'my_key', 'a b', 'a'.repeat(65), 'x/../y'];
    for (const name of bad) {
      expect(() => store.save(name, VALUE)).toThrow(/secret name must be/);
    }
    expect(() => store.read('Bad_Name')).toThrow(/secret name must be/);
    expect(() => store.delete('')).toThrow(/secret name must be/);
  });

  it('refuses empty, non-string and oversized values, with a message that names no value', () => {
    const { store } = makeStore();
    expect(() => store.save('spike', '')).toThrow(/non-empty string/);
    expect(() => store.save('spike', 42 as unknown as string)).toThrow(/non-empty string/);
    const oversized = 'x'.repeat(MAX_SECRET_VALUE_LENGTH + 1);
    expect(() => store.save('spike', oversized)).toThrow(/longer than 4096/);
    try {
      store.save('spike', oversized);
    } catch (error) {
      expect(String(error)).not.toContain('xxxxx');
    }
    expect(store.listNames()).toEqual([]);
  });

  it('accepts a value at the length limit', () => {
    const { store } = makeStore();
    const atLimit = 'y'.repeat(MAX_SECRET_VALUE_LENGTH);
    store.save('spike', atLimit);
    expect(store.read('spike')).toBe(atLimit);
  });
});

describe('secret store: delete and listNames never decrypt', () => {
  it('lists names sorted, and reports whether delete removed an entry', () => {
    const { store } = makeStore();
    store.save('zeta', VALUE);
    store.save('alpha', OTHER);
    expect(store.listNames()).toEqual(['alpha', 'zeta']);
    expect(store.delete('alpha')).toBe(true);
    expect(store.delete('alpha')).toBe(false);
    expect(store.listNames()).toEqual(['zeta']);
  });

  it('does not call decryptString for delete or listNames', () => {
    const decryptString = vi.fn((encrypted: Buffer) => encrypted.toString('utf8'));
    const { store } = makeStore(fakeCrypto({ decryptString }));
    store.save('spike', VALUE);
    store.listNames();
    store.delete('spike');
    expect(decryptString).not.toHaveBeenCalled();
  });
});

describe('secret store: refusal when encryption is weak or unavailable (AC2)', () => {
  it('refuses when encryption is unavailable, names no value and writes nothing', () => {
    const { store } = makeStore(fakeCrypto({ isEncryptionAvailable: () => false }), {
      platform: 'win32',
    });
    const before = listing(dir);
    let message = '';
    try {
      store.save('spike', VALUE);
    } catch (error) {
      message = String(error);
    }
    expect(message).toMatch(/secure storage is unavailable/);
    expect(message).not.toContain(VALUE);
    expect(listing(dir)).toEqual(before);
  });

  it('creates nothing on disk when refusing, even in a missing directory', () => {
    const nested = join(dir, 'missing', 'secrets.json');
    const store = createSecretStore({
      crypto: fakeCrypto({ isEncryptionAvailable: () => false }),
      filePath: nested,
      platform: 'win32',
      allowWeakBackend: false,
      redactor: createRedactor(),
    });
    expect(() => store.save('spike', VALUE)).toThrow(/unavailable/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('refuses basic_text on linux with the override off, and leaves the file unchanged', () => {
    const { store: first } = makeStore(fakeCrypto(), { platform: 'linux' });
    first.save('other-one', OTHER);
    const before = listing(dir);

    const { store } = makeStore(fakeCrypto({ getSelectedStorageBackend: () => 'basic_text' }), {
      platform: 'linux',
      allowWeakBackend: false,
    });
    let message = '';
    try {
      store.save('spike', VALUE);
    } catch (error) {
      message = String(error);
    }
    expect(message).toMatch(/weak/);
    expect(message).not.toContain(VALUE);
    expect(listing(dir)).toEqual(before);
  });

  it('refuses the unknown backend on linux with the override off', () => {
    const { store } = makeStore(fakeCrypto({ getSelectedStorageBackend: () => 'unknown' }), {
      platform: 'linux',
      allowWeakBackend: false,
    });
    expect(() => store.save('spike', VALUE)).toThrow(/weak/);
    expect(listing(dir)).toEqual({});
  });

  it('accepts basic_text on linux when the override is on', () => {
    const { store } = makeStore(fakeCrypto({ getSelectedStorageBackend: () => 'basic_text' }), {
      platform: 'linux',
      allowWeakBackend: true,
    });
    store.save('spike', VALUE);
    expect(store.read('spike')).toBe(VALUE);
  });

  it('accepts basic_text on other platforms, since the rule is for linux only', () => {
    const { store } = makeStore(fakeCrypto({ getSelectedStorageBackend: () => 'basic_text' }), {
      platform: 'win32',
      allowWeakBackend: false,
    });
    store.save('spike', VALUE);
    expect(store.read('spike')).toBe(VALUE);
  });

  it('accepts a real keyring backend on linux', () => {
    const { store } = makeStore(
      fakeCrypto({
        getSelectedStorageBackend: () => 'kwallet5',
        isEncryptionAvailable: () => true,
      }),
      { platform: 'linux' },
    );
    store.save('spike', VALUE);
    expect(store.read('spike')).toBe(VALUE);
  });

  it('refuses before the file is touched when the existing file is unreadable', () => {
    writeFileSync(filePath, 'not json', 'utf8');
    const before = listing(dir);
    const { store } = makeStore(fakeCrypto({ isEncryptionAvailable: () => false }));
    expect(() => store.save('spike', VALUE)).toThrow(/unavailable/);
    expect(listing(dir)).toEqual(before);
  });
});

describe('secret store: read errors and registration (AC2, AC5)', () => {
  it('throws for an entry that cannot be decrypted, naming the entry and not the ciphertext', () => {
    const { store } = makeStore();
    store.save('spike', VALUE);
    const ciphertext = (
      JSON.parse(readFileSync(filePath, 'utf8')) as {
        entries: Record<string, string>;
      }
    ).entries['spike'];

    const broken = createSecretStore({
      crypto: fakeCrypto({
        decryptString: () => {
          throw new Error(`cannot decrypt ${VALUE} ${ciphertext}`);
        },
      }),
      filePath,
      platform: 'win32',
      allowWeakBackend: false,
      redactor: createRedactor(),
    });
    let message = '';
    try {
      broken.read('spike');
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain("'spike'");
    expect(message).not.toContain(VALUE);
    expect(message).not.toContain(String(ciphertext));
  });

  it('registers each value it returns, so a later line containing it is redacted (AC5)', () => {
    const { store, redactor } = makeStore();
    store.save('spike', VALUE);
    expect(redactor.redact(`before ${VALUE}`)).toBe(`before ${VALUE}`);
    expect(store.read('spike')).toBe(VALUE);
    expect(redactor.redact(`after ${VALUE}`)).toBe(`after ${REDACTED}`);
  });

  it('throws a clear error for a file in an unknown format, without its contents', () => {
    writeFileSync(filePath, JSON.stringify({ version: 2, entries: { spike: VALUE } }), 'utf8');
    const { store } = makeStore();
    let message = '';
    try {
      store.read('spike');
    } catch (error) {
      message = String(error);
    }
    expect(message).toMatch(/unknown format/);
    expect(message).not.toContain(VALUE);
  });
});
