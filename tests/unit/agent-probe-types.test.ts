import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ModelProbeResult, ProbeResult, ServerListing } from '../../src/agent/probes/types';

const PROBES_DIR = fileURLToPath(new URL('../../src/agent/probes/', import.meta.url));

const PROBE: ProbeResult = {
  status: 'unreliable',
  runs: 3,
  passes: 2,
  latencyMs: 812,
  tokensPerSecond: 41.5,
  failures: ['missing-token'],
};

describe('probe result types (AC4)', () => {
  it('are plain data that survive a JSON round trip unchanged', () => {
    const model: ModelProbeResult = {
      model: 'qwen3.8-flash-next-nothink',
      contextWindow: 32768,
      chat: PROBE,
      toolUse: { ...PROBE, status: 'failed', passes: 0, failures: ['wrong-arguments', 'timeout'] },
      tokensPerSecond: 41.5,
    };
    const listing: ServerListing = {
      ok: true,
      latencyMs: 12,
      models: [{ id: 'a', contextWindow: null }],
    };
    const failed: ServerListing = { ok: false, latencyMs: 3, failure: 'timeout' };
    for (const value of [PROBE, model, listing, failed]) {
      expect(JSON.parse(JSON.stringify(value))).toEqual(value);
    }
  });
});

describe('probe module imports (AC8)', () => {
  const files = readdirSync(PROBES_DIR).filter((name) => name.endsWith('.ts'));

  it('imports no SDK and nothing from src/main', () => {
    for (const file of files) {
      const source = readFileSync(join(PROBES_DIR, file), 'utf8');
      const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1] ?? '');
      for (const specifier of specifiers) {
        expect(specifier, file).not.toMatch(/^(openai|@anthropic-ai\/)/);
        expect(specifier, file).not.toMatch(/main/);
      }
    }
  });

  it('never logs and never reads the environment', () => {
    for (const file of files) {
      const source = readFileSync(join(PROBES_DIR, file), 'utf8');
      expect(source, file).not.toMatch(/console\./);
      expect(source, file).not.toMatch(/process\.env/);
    }
  });
});
