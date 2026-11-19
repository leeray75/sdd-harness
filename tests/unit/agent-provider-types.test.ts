import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ProviderError } from '../../src/agent/provider/types';

const SRC_ROOT = fileURLToPath(new URL('../../src/', import.meta.url));
const SDK_PACKAGES = ['openai', '@anthropic-ai/sdk'];

/** The module specifiers of a file's import and re-export statements, read from its source. */
function importSpecifiers(relativePath: string): string[] {
  const source = readFileSync(`${SRC_ROOT}${relativePath}`, 'utf8');
  const pattern =
    /(?:^|\n)\s*(?:import|export)\b[^'";]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
  const specifiers: string[] = [];
  for (const match of source.matchAll(pattern)) {
    specifiers.push(match[1] ?? match[2] ?? '');
  }
  return specifiers;
}

describe('provider-neutral types', () => {
  it.each(['agent/provider/types.ts', 'agent/loop.ts'])(
    '%s imports neither the openai nor the Anthropic SDK',
    (file) => {
      const specifiers = importSpecifiers(file);
      for (const sdk of SDK_PACKAGES) {
        expect(specifiers.filter((s) => s === sdk || s.startsWith(`${sdk}/`))).toEqual([]);
      }
    },
  );

  it('marks retryable kinds as retryable and the rest as not', () => {
    expect(new ProviderError('rate-limit', 429).retryable).toBe(true);
    expect(new ProviderError('server', 500).retryable).toBe(true);
    expect(new ProviderError('network').retryable).toBe(true);
    expect(new ProviderError('auth', 401).retryable).toBe(false);
    expect(new ProviderError('bad-request', 400).retryable).toBe(false);
    expect(new ProviderError('aborted').retryable).toBe(false);
    expect(new ProviderError('unknown').retryable).toBe(false);
  });

  it('builds its message only from the kind and the status', () => {
    expect(new ProviderError('auth', 401).message).toBe('provider auth error (HTTP 401)');
    expect(new ProviderError('network').message).toBe('provider network error');
  });
});
