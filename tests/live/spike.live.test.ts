import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import { runAgentLoop } from '../../src/agent/loop';
import { readFileInRoot } from '../../src/main/tools/read-file';

// Opt-in live check (D24). It completes the same loop as the spike against the server in
// HARNESS_SPIKE_BASE_URL, with read_file run by the same runner main uses, inside a temp root.
// The key is read from the environment and is never printed.
const baseURL = process.env['HARNESS_SPIKE_BASE_URL'];
const key = process.env['HARNESS_SPIKE_API_KEY'];
const model = process.env['HARNESS_SPIKE_MODEL'] || 'qwen3.8-flash-next-nothink';

describe.skipIf(!baseURL)('spike loop against a live server', () => {
  it('completes the loop: a read_file call is run and the model answers', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'spike-live-'));
    try {
      const spikeRoot = join(scratch, 'root');
      mkdirSync(spikeRoot);
      writeFileSync(join(spikeRoot, 'notes.txt'), 'Spike note: the live run reads this file.\n');

      const client = new OpenAI({ baseURL, apiKey: key || 'no-key-set', maxRetries: 0 });
      const calls: string[] = [];
      const result = await runAgentLoop({
        client,
        model,
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
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
