import { describe, expect, it } from 'vitest';
import { shouldUsePlainTextEncryption } from '../../src/main/secrets/plain-text';

describe('shouldUsePlainTextEncryption (D25, Linux override)', () => {
  const cases: Array<[NodeJS.Platform, string | undefined, boolean]> = [
    ['linux', '1', true],
    ['linux', undefined, false],
    ['linux', '0', false],
    ['linux', '', false],
    ['darwin', '1', false],
    ['darwin', undefined, false],
    ['win32', '1', false],
    ['win32', undefined, false],
  ];

  it.each(cases)('platform %s with override %j gives %s', (platform, override, expected) => {
    expect(shouldUsePlainTextEncryption(platform, override)).toBe(expected);
  });
});
