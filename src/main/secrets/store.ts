// Secret store for provider keys (D25). Keeps each value only as safeStorage ciphertext in one
// JSON file in app data. Pure apart from the file system: the crypto, the path, the platform,
// the weak-backend override and the redactor are all injected, so tests can use a fake crypto
// and a temp dir. No error this module throws contains a value or ciphertext.

import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { Redactor } from './redact';

/** The part of Electron's safeStorage the store uses. */
export interface SecretCrypto {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend(): string;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface SecretStoreOptions {
  crypto: SecretCrypto;
  /** The secrets file, for example `<userData>/secrets.json`. */
  filePath: string;
  platform: NodeJS.Platform;
  /** When true, a `basic_text` or `unknown` Linux backend is accepted (test-only, D25). */
  allowWeakBackend: boolean;
  redactor: Redactor;
}

export interface SecretStore {
  /** Encrypts and writes a value. Refuses, writing nothing, when encryption is weak or missing. */
  save(name: string, value: string): void;
  /** Returns the decrypted value, or null when there is no entry. Registers it with the redactor. */
  read(name: string): string | null;
  /** Removes an entry. Returns false when there was no entry. Never decrypts. */
  delete(name: string): boolean;
  /** Lists the entry names, sorted. Never decrypts. */
  listNames(): string[];
}

export const MAX_SECRET_VALUE_LENGTH = 4096;
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const FILE_VERSION = 1;
const BACKENDS_WITHOUT_KEYRING = ['basic_text', 'unknown'];

interface SecretsFile {
  version: 1;
  entries: Record<string, string>;
}

function checkName(name: string): void {
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
    throw new Error(
      'secret name must be 1 to 64 lowercase letters, digits or hyphens, starting with a letter or digit',
    );
  }
}

function checkValue(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('secret value must be a non-empty string');
  }
  if (value.length > MAX_SECRET_VALUE_LENGTH) {
    throw new Error(`secret value is longer than ${MAX_SECRET_VALUE_LENGTH} characters`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Throws unless the crypto can really encrypt here. Nothing is written before this passes. */
function checkEncryption(options: SecretStoreOptions): void {
  if (!options.crypto.isEncryptionAvailable()) {
    throw new Error('secure storage is unavailable, so the secret was not saved');
  }
  if (options.platform === 'linux' && !options.allowWeakBackend) {
    const backend = options.crypto.getSelectedStorageBackend();
    if (BACKENDS_WITHOUT_KEYRING.includes(backend)) {
      throw new Error(
        'secure storage has no system keyring here (the backend is weak), so the secret was not saved',
      );
    }
  }
}

/** Reads the file. A missing file is an empty store; an unreadable one is an error. */
function loadFile(filePath: string): SecretsFile {
  if (!existsSync(filePath)) {
    return { version: FILE_VERSION, entries: {} };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    throw new Error('the secrets file could not be read; it is not valid JSON');
  }
  if (!isRecord(parsed) || parsed['version'] !== FILE_VERSION || !isRecord(parsed['entries'])) {
    throw new Error('the secrets file has an unknown format');
  }
  const entries = parsed['entries'];
  if (!Object.values(entries).every((item) => typeof item === 'string')) {
    throw new Error('the secrets file has an unknown format');
  }
  return { version: FILE_VERSION, entries: entries as Record<string, string> };
}

/** Writes the file atomically: a temp file in the same directory, then a rename, mode 0o600. */
function writeFileAtomic(filePath: string, data: SecretsFile): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const temp = join(dir, `.secrets-${randomBytes(8).toString('hex')}.tmp`);
  try {
    writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, filePath);
  } catch {
    try {
      unlinkSync(temp);
    } catch {
      // The temp file may not exist; nothing else to clean up.
    }
    throw new Error('the secrets file could not be written');
  }
}

export function createSecretStore(options: SecretStoreOptions): SecretStore {
  return {
    save(name: string, value: string): void {
      checkName(name);
      checkValue(value);
      checkEncryption(options);
      const file = loadFile(options.filePath);
      const ciphertext = options.crypto.encryptString(value).toString('base64');
      file.entries[name] = ciphertext;
      writeFileAtomic(options.filePath, file);
    },

    read(name: string): string | null {
      checkName(name);
      const file = loadFile(options.filePath);
      const ciphertext = Object.prototype.hasOwnProperty.call(file.entries, name)
        ? file.entries[name]
        : undefined;
      if (ciphertext === undefined) {
        return null;
      }
      let value: string;
      try {
        value = options.crypto.decryptString(Buffer.from(ciphertext, 'base64'));
      } catch {
        throw new Error(`the secret '${name}' could not be decrypted`);
      }
      options.redactor.register(value);
      return value;
    },

    delete(name: string): boolean {
      checkName(name);
      const file = loadFile(options.filePath);
      if (!Object.prototype.hasOwnProperty.call(file.entries, name)) {
        return false;
      }
      delete file.entries[name];
      writeFileAtomic(options.filePath, file);
      return true;
    },

    listNames(): string[] {
      return Object.keys(loadFile(options.filePath).entries).sort();
    },
  };
}
