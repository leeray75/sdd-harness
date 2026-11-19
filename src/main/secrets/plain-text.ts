// Decides whether Electron's plain-text encryption backend is switched on (D25). Pure: the
// platform and the override value are passed in, so the rule is unit-tested without Electron.

/**
 * True only on Linux with the test-only override on (`HARNESS_ALLOW_WEAK_SECRETS=1`). Without a
 * keyring, Electron 45 reports encryption as unavailable unless this switch is on. Other
 * platforms, and Linux without the override, never switch it on.
 */
export function shouldUsePlainTextEncryption(
  platform: NodeJS.Platform,
  overrideValue: string | undefined,
): boolean {
  return platform === 'linux' && overrideValue === '1';
}
