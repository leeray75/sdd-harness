// Chooses the spike's provider from HARNESS_SPIKE_PROVIDER (AC7). Pure: it reads only the values
// it is given and builds an adapter, so tests can check the choice without the agent process.
// Unset or 'openai' gives the OpenAI-compatible adapter; 'anthropic' gives the Anthropic adapter
// with Bearer auth (D26). Any other value is refused and nothing runs.

import { createAnthropicProvider } from './provider/anthropic';
import { createOpenAIProvider } from './provider/openai';
import type { Provider } from './provider/types';

export type SpikeFormat = 'openai' | 'anthropic';

/** The model each format uses when HARNESS_SPIKE_MODEL is not set. */
export const SPIKE_DEFAULT_MODELS: Record<SpikeFormat, string> = {
  openai: 'qwen3.8-flash-next-nothink',
  anthropic: 'claude-haiku-5-5',
};

export const SPIKE_PROVIDER_REFUSAL = 'HARNESS_SPIKE_PROVIDER must be openai or anthropic';

export interface SpikeEnv {
  /** HARNESS_SPIKE_PROVIDER, or undefined when unset. */
  provider: string | undefined;
  /** HARNESS_SPIKE_MODEL, or undefined when unset. */
  model: string | undefined;
  /** HARNESS_SPIKE_BASE_URL. The openai format adds /v1 itself; the anthropic format needs none. */
  baseURL: string;
}

export type SpikeChoice =
  | { ok: true; format: SpikeFormat; model: string; provider: Provider }
  | { ok: false; reason: string };

/** Picks the format, the model and the adapter for one spike run. The key is held only in the adapter. */
export function chooseSpikeProvider(env: SpikeEnv, key: string | null): SpikeChoice {
  const raw = env.provider?.trim() ?? '';
  let format: SpikeFormat;
  if (raw === '' || raw === 'openai') {
    format = 'openai';
  } else if (raw === 'anthropic') {
    format = 'anthropic';
  } else {
    return { ok: false, reason: SPIKE_PROVIDER_REFUSAL };
  }
  const model = env.model || SPIKE_DEFAULT_MODELS[format];
  const provider =
    format === 'openai'
      ? createOpenAIProvider({ baseURL: env.baseURL, key })
      : createAnthropicProvider({ baseURL: env.baseURL, key });
  return { ok: true, format, model, provider };
}
