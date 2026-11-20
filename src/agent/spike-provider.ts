// Chooses the spike's provider from its variables (AC7, AC6 of p1-openai-compatible). Pure: it reads
// only the values it is given and builds an adapter through the factory, so tests can check the
// choice without the agent process. HARNESS_SPIKE_PRESET picks the server type (default
// agentgateway); HARNESS_SPIKE_PROVIDER picks the wire format (the preset's first format when
// unset); HARNESS_SPIKE_HEADERS adds extra headers; HARNESS_SPIKE_BASE_URL may be unset when the
// preset has a default address. Any refusal is returned as a reason and nothing runs.

import { createProvider } from './provider/factory';
import { parseHeaderLines } from './provider/headers';
import type { Provider } from './provider/types';

export type SpikeFormat = 'openai' | 'anthropic';

/** The preset the spike uses when HARNESS_SPIKE_PRESET is unset or empty. */
export const SPIKE_DEFAULT_PRESET = 'agentgateway';

/** The model each format uses when HARNESS_SPIKE_MODEL is not set. */
export const SPIKE_DEFAULT_MODELS: Record<SpikeFormat, string> = {
  openai: 'qwen3.8-flash-next-nothink',
  anthropic: 'claude-haiku-5-5',
};

export interface SpikeEnv {
  /** HARNESS_SPIKE_PRESET, or undefined when unset. Empty means the default preset. */
  preset: string | undefined;
  /** HARNESS_SPIKE_PROVIDER (the wire format), or undefined when unset. */
  provider: string | undefined;
  /** HARNESS_SPIKE_MODEL, or undefined when unset. */
  model: string | undefined;
  /** HARNESS_SPIKE_BASE_URL, or undefined when unset. The factory adds /v1 or strips it per format. */
  baseURL: string | undefined;
  /** HARNESS_SPIKE_HEADERS, as `Name: value` lines, or undefined when unset. */
  headers: string | undefined;
}

export type SpikeChoice =
  | {
      ok: true;
      preset: string;
      format: SpikeFormat;
      model: string;
      baseURL: string;
      provider: Provider;
    }
  | { ok: false; reason: string };

/**
 * Picks the preset, the format, the model and the adapter for one spike run. The key is held only
 * in the adapter. A refusal reason never holds the key or a header value.
 */
export function chooseSpikeProvider(env: SpikeEnv, key: string | null): SpikeChoice {
  const preset = env.preset?.trim() || SPIKE_DEFAULT_PRESET;

  const parsed = parseHeaderLines(env.headers ?? '');
  if (!parsed.ok) {
    return { ok: false, reason: `HARNESS_SPIKE_HEADERS: ${parsed.reason}` };
  }

  const built = createProvider(
    {
      preset,
      ...(env.provider !== undefined ? { format: env.provider } : {}),
      ...(env.baseURL !== undefined ? { baseURL: env.baseURL } : {}),
      headers: parsed.headers,
    },
    key,
  );
  if (!built.ok) {
    return { ok: false, reason: built.reason };
  }

  const model = env.model || SPIKE_DEFAULT_MODELS[built.format];
  return {
    ok: true,
    preset: built.preset,
    format: built.format,
    model,
    baseURL: built.baseURL,
    provider: built.provider,
  };
}
