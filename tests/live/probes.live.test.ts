import { describe, expect, it } from 'vitest';
import { listServerModels, probeModel } from '../../src/agent/probes/run';
import { parseHeaderLines } from '../../src/agent/provider/headers';
import { createProvider } from '../../src/agent/provider/factory';
import { SPIKE_DEFAULT_MODELS, SPIKE_DEFAULT_PRESET } from '../../src/agent/spike-provider';
import { getServerPreset, type WireFormat } from '../../src/shared/server-presets';

// Opt-in live check of the model probes (p1-model-probes, AC11). For each wire format the preset
// offers (default agentgateway: openai and anthropic) it lists the server's models and runs the chat
// and tool-use probes on the spike's default model, or on HARNESS_SPIKE_MODEL. Setup is the same as
// the spike's: HARNESS_SPIKE_PRESET, HARNESS_SPIKE_BASE_URL (or the preset's default address),
// HARNESS_SPIKE_HEADERS and HARNESS_SPIKE_API_KEY, which is read here and never printed. The
// providers use maxRetries 0, so retries do not skew latency. Only result data is printed (status,
// passes, latency, speed, context window). The suite skips when no address results and never runs
// in CI.
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
  'model probes against a live server, %s format',
  (format) => {
    it('lists the models and passes neither probe as failed on the spike model', async () => {
      if (!headers.ok) {
        throw new Error(`HARNESS_SPIKE_HEADERS refused: ${headers.reason}`);
      }
      const built = createProvider(
        { preset: presetId, format, baseURL: address, headers: headers.headers },
        key,
        { maxRetries: 0 },
      );
      if (!built.ok) {
        throw new Error(`the probe setup was refused: ${built.reason}`);
      }

      const listing = await listServerModels(built.provider, { timeoutMs: 60000 });
      if (!listing.ok) {
        throw new Error(`the models listing failed: ${listing.failure}`);
      }
      expect(listing.models.length).toBeGreaterThan(0);

      const model = modelOverride || SPIKE_DEFAULT_MODELS[format];
      const listed = listing.models.find((item) => item.id === model);
      const contextWindow = listed?.contextWindow ?? null;
      const result = await probeModel(built.provider, model, contextWindow, { timeoutMs: 60000 });

      // Result data only: no key, no header value and no address is printed.
      process.stdout.write(
        `${JSON.stringify({
          format,
          listing: { latencyMs: listing.latencyMs, models: listing.models.length },
          result,
        })}\n`,
      );
      expect(result.chat.status).not.toBe('failed');
      expect(result.toolUse.status).not.toBe('failed');
    });
  },
);
