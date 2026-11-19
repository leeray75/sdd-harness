import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runAgentLoop } from '../../src/agent/loop';
import { createAnthropicProvider } from '../../src/agent/provider/anthropic';
import { createOpenAIProvider } from '../../src/agent/provider/openai';
import type { Provider } from '../../src/agent/provider/types';
import { SPIKE_DEFAULT_MODELS, type SpikeFormat } from '../../src/agent/spike-provider';
import { readFileInRoot } from '../../src/main/tools/read-file';

// Opt-in live check (D24, AC10). It completes the same loop as the spike once per wire format,
// against the gateway in HARNESS_SPIKE_BASE_URL (the root, without /v1), with read_file run by the
// same runner main uses, inside a temp root. The key is read from HARNESS_SPIKE_API_KEY and is
// never printed. The suite skips when the base URL is unset and never runs in CI.
const baseURL = process.env['HARNESS_SPIKE_BASE_URL'];
const key = process.env['HARNESS_SPIKE_API_KEY'] || null;
const modelOverride = process.env['HARNESS_SPIKE_MODEL'];

const FORMATS: SpikeFormat[] = ['openai', 'anthropic'];

function providerFor(format: SpikeFormat, base: string): Provider {
  return format === 'openai'
    ? createOpenAIProvider({ baseURL: base, key, maxRetries: 0 })
    : createAnthropicProvider({ baseURL: base, key, maxRetries: 0 });
}

describe.skipIf(!baseURL).each(FORMATS)('spike loop against a live server, %s format', (format) => {
  it('completes the loop: a read_file call is run and the model answers', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'spike-live-'));
    try {
      const spikeRoot = join(scratch, 'root');
      mkdirSync(spikeRoot);
      writeFileSync(join(spikeRoot, 'notes.txt'), 'Spike note: the live run reads this file.\n');

      const calls: string[] = [];
      const result = await runAgentLoop({
        provider: providerFor(format, baseURL ?? ''),
        model: modelOverride || SPIKE_DEFAULT_MODELS[format],
        prompt:
          'Read the file notes.txt with the read_file tool, then answer in one sentence what it says.',
        callTool: async (name, args) => {
          calls.push(name);
          if (name !== 'read_file') {
            return { ok: false, reason: 'no such tool' };
          }
          return readFileInRoot(spikeRoot, args['path']);
        },
        onText: () => undefined,
      });

      expect(result.stopped).toBe('answered');
      expect(calls).toContain('read_file');
      expect(result.text.trim()).not.toBe('');
      expect(result.usage.total).not.toBeNull();
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
