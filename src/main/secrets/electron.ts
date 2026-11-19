// Builds the secret store from Electron's safeStorage (D25). Call it only after app ready:
// it reads app.getPath('userData'). HARNESS_ALLOW_WEAK_SECRETS is read from main's own
// environment and is never passed to the agent (the agent env allowlist drops it).

import { app, safeStorage } from 'electron';
import { join } from 'node:path';
import { redactor } from './redact';
import { shouldUsePlainTextEncryption } from './plain-text';
import { createSecretStore, type SecretStore } from './store';

export const SECRETS_FILE_NAME = 'secrets.json';
export const WEAK_OVERRIDE_VAR = 'HARNESS_ALLOW_WEAK_SECRETS';

let plainTextDecided = false;

/** Switches on Electron's plain-text backend at most once per process, when the override asks (D25). */
function decidePlainTextOnce(): void {
  if (plainTextDecided) {
    return;
  }
  plainTextDecided = true;
  if (shouldUsePlainTextEncryption(process.platform, process.env[WEAK_OVERRIDE_VAR])) {
    safeStorage.setUsePlainTextEncryption(true);
  }
}

export function createElectronSecretStore(): SecretStore {
  decidePlainTextOnce();
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
