import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runAgentLoop } from '../../src/agent/loop';
import { createProvider } from '../../src/agent/provider/factory';
import { SPIKE_DEFAULT_MODELS, SPIKE_DEFAULT_PRESET } from '../../src/agent/spike-provider';
import { parseHeaderLines } from '../../src/agent/provider/headers';
import { readFileInRoot } from '../../src/main/tools/read-file';
import { getServerPreset, type WireFormat } from '../../src/shared/server-presets';

// Opt-in live check (D24, AC8 of p1-openai-compatible). It completes the same loop as the spike
// once per wire format the preset offers (default agentgateway: openai and anthropic). The
// providers are built by the factory from HARNESS_SPIKE_PRESET, HARNESS_SPIKE_BASE_URL (or the
// preset's default address) and HARNESS_SPIKE_HEADERS. read_file runs through the same runner
// main uses, inside a temp root. The key is read from HARNESS_SPIKE_API_KEY and is never printed.
// The suite skips when no address results and never runs in CI.
const presetId = process.env['HARNESS_SPIKE_PRESET']?.trim() || SPIKE_DEFAULT_PRESET;
const preset = getServerPreset(presetId);
const baseURL = process.env['HARNESS_SPIKE_BASE_URL']?.trim() || undefined;
const key = process.env['HARNESS_SPIKE_API_KEY'] || null;
const modelOverride = process.env['HARNESS_SPIKE_MODEL'];

/** The address that would be used, or undefined when neither the variable nor a default gives one. */
const address = baseURL ?? preset?.defaultBaseURL ?? undefined;
const headers = parseHeaderLines(process.env['HARNESS_SPIKE_HEADERS'] ?? '');

/** One run per format the preset offers. Unknown presets fall back to openai, then skip below. */
const FORMATS: WireFormat[] = preset ? [...preset.formats] : ['openai'];

describe.skipIf(address === undefined).each(FORMATS)(
  'spike loop against a live server, %s format',
  (format) => {
    it('completes the loop: a read_file call is run and the model answers', async () => {
      if (!headers.ok) {
        throw new Error(`HARNESS_SPIKE_HEADERS refused: ${headers.reason}`);
      }
      const built = createProvider(
        { preset: presetId, format, baseURL: address, headers: headers.headers },
        key,
        { maxRetries: 0 },
      );
      if (!built.ok) {
        throw new Error(`the spike setup was refused: ${built.reason}`);
      }

      const scratch = mkdtempSync(join(tmpdir(), 'spike-live-'));
      try {
        const spikeRoot = join(scratch, 'root');
        mkdirSync(spikeRoot);
        writeFileSync(join(spikeRoot, 'notes.txt'), 'Spike note: the live run reads this file.\n');

        const calls: string[] = [];
        const result = await runAgentLoop({
          provider: built.provider,
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
  },
);
