import { describe, expect, it } from 'vitest';
import { toHarnessPlatform } from '../../src/shared/bridge';

describe('toHarnessPlatform', () => {
  it('keeps darwin and linux', () => {
    expect(toHarnessPlatform('darwin')).toBe('darwin');
    expect(toHarnessPlatform('linux')).toBe('linux');
  });

  it('reports win32 and every other platform value as win32', () => {
    expect(toHarnessPlatform('win32')).toBe('win32');
    expect(toHarnessPlatform('freebsd')).toBe('win32');
    expect(toHarnessPlatform('')).toBe('win32');
    expect(toHarnessPlatform('Darwin')).toBe('win32');
  });
});
