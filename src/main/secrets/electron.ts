// Builds the secret store from Electron's safeStorage (D25). Call it only after app ready:
// it reads app.getPath('userData'). HARNESS_ALLOW_WEAK_SECRETS is read from main's own
// environment and is never passed to the agent (the agent env allowlist drops it).

import { app, safeStorage } from 'electron';
import { join } from 'node:path';
import { redactor } from './redact';
import { createSecretStore, type SecretStore } from './store';

export const SECRETS_FILE_NAME = 'secrets.json';
export const WEAK_OVERRIDE_VAR = 'HARNESS_ALLOW_WEAK_SECRETS';

export function createElectronSecretStore(): SecretStore {
  return createSecretStore({
    crypto: {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      getSelectedStorageBackend: () => safeStorage.getSelectedStorageBackend(),
      encryptString: (plainText: string) => safeStorage.encryptString(plainText),
      decryptString: (encrypted: Buffer) => safeStorage.decryptString(encrypted),
    },
    filePath: join(app.getPath('userData'), SECRETS_FILE_NAME),
    platform: process.platform,
    allowWeakBackend: process.env[WEAK_OVERRIDE_VAR] === '1',
    redactor,
  });
}
