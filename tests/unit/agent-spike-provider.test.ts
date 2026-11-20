import { describe, expect, it } from 'vitest';
import {
  chooseSpikeProvider,
  SPIKE_DEFAULT_MODELS,
  SPIKE_DEFAULT_PRESET,
  type SpikeEnv,
} from '../../src/agent/spike-provider';
import { SERVER_PRESETS } from '../../src/shared/server-presets';

const BASE_URL = 'http://gateway.test:4100';
const SENTINEL = 'SENTINEL-KEY-do-not-leak-3317';
const HEADER_SENTINEL = 'SENTINEL-HEADER-do-not-leak-7058';

/** A spike environment with every variable unset, overridden by the given values. */
function env(overrides: Partial<SpikeEnv> = {}): SpikeEnv {
  return {
    preset: undefined,
    provider: undefined,
    model: undefined,
    baseURL: BASE_URL,
    headers: undefined,
    ...overrides,
  };
}

describe('chooseSpikeProvider: the format (AC6)', () => {
  it('uses the openai format when HARNESS_SPIKE_PROVIDER is unset, with the openai default model', () => {
    const choice = chooseSpikeProvider(env(), SENTINEL);
    expect(choice).toMatchObject({
      ok: true,
      format: 'openai',
      model: 'qwen3.8-flash-next-nothink',
    });
  });

  it('treats an empty HARNESS_SPIKE_PROVIDER as unset', () => {
    expect(chooseSpikeProvider(env({ provider: '', model: '' }), null)).toMatchObject({
      ok: true,
      format: 'openai',
    });
  });

  it('uses the openai format for openai', () => {
    expect(chooseSpikeProvider(env({ provider: 'openai' }), null)).toMatchObject({
      ok: true,
      format: 'openai',
      model: SPIKE_DEFAULT_MODELS.openai,
    });
  });

  it('uses the anthropic format and its default model for anthropic', () => {
    const choice = chooseSpikeProvider(env({ provider: 'anthropic' }), SENTINEL);
    expect(choice).toMatchObject({ ok: true, format: 'anthropic', model: 'claude-haiku-5-5' });
    if (choice.ok) {
      expect(typeof choice.provider.stream).toBe('function');
    }
  });

  it('lets HARNESS_SPIKE_MODEL override the default for either format', () => {
    expect(
      chooseSpikeProvider(env({ provider: 'anthropic', model: 'some-model' }), null),
    ).toMatchObject({ ok: true, model: 'some-model' });
    expect(chooseSpikeProvider(env({ model: 'other-model' }), null)).toMatchObject({
      ok: true,
      model: 'other-model',
    });
  });

  it('refuses a format the preset does not offer, with the factory reason, and builds no provider', () => {
    const choice = chooseSpikeProvider(env({ preset: 'vllm', provider: 'anthropic' }), null);
    expect(choice).toEqual({
      ok: false,
      reason: 'preset "vllm" does not offer the requested format; it offers openai',
    });
    expect(choice).not.toHaveProperty('provider');
  });

  it('refuses a format no preset offers', () => {
    const choice = chooseSpikeProvider(env({ provider: 'bedrock' }), null);
    expect(choice).toEqual({
      ok: false,
      reason:
        'preset "agentgateway" does not offer the requested format; it offers openai, anthropic',
    });
  });

  it('keeps the key out of the refusal text', () => {
    const choice = chooseSpikeProvider(env({ provider: 'nope' }), SENTINEL);
    expect(JSON.stringify(choice)).not.toContain(SENTINEL);
  });
});

describe('chooseSpikeProvider: the preset (AC6)', () => {
  it('uses agentgateway when HARNESS_SPIKE_PRESET is unset or empty', () => {
    expect(SPIKE_DEFAULT_PRESET).toBe('agentgateway');
    expect(chooseSpikeProvider(env(), null)).toMatchObject({ ok: true, preset: 'agentgateway' });
    expect(chooseSpikeProvider(env({ preset: '' }), null)).toMatchObject({
      ok: true,
      preset: 'agentgateway',
    });
  });

  it('takes the preset and its first format, with the address given', () => {
    expect(chooseSpikeProvider(env({ preset: 'litellm' }), null)).toMatchObject({
      ok: true,
      preset: 'litellm',
      format: 'openai',
      baseURL: BASE_URL,
    });
  });

  it('falls back to the preset default address when HARNESS_SPIKE_BASE_URL is unset', () => {
    expect(chooseSpikeProvider(env({ preset: 'ollama', baseURL: undefined }), null)).toMatchObject({
      ok: true,
      preset: 'ollama',
      format: 'openai',
      baseURL: 'http://localhost:11434/v1',
    });
  });

  it('refuses a missing address when the preset has no default', () => {
    expect(chooseSpikeProvider(env({ baseURL: undefined }), null)).toEqual({
      ok: false,
      reason: 'preset "agentgateway" has no default address; a base URL is required',
    });
    expect(chooseSpikeProvider(env({ preset: 'tgi-sglang', baseURL: '' }), null)).toMatchObject({
      ok: false,
    });
  });

  it('refuses an unknown preset and lists the preset ids', () => {
    const choice = chooseSpikeProvider(env({ preset: 'mystery' }), SENTINEL);
    expect(choice.ok).toBe(false);
    if (!choice.ok) {
      for (const preset of SERVER_PRESETS) {
        expect(choice.reason).toContain(preset.id);
      }
    }
    expect(JSON.stringify(choice)).not.toContain(SENTINEL);
  });

  it('refuses an address that is not an http or https URL', () => {
    expect(chooseSpikeProvider(env({ baseURL: 'ftp://gateway.test' }), null)).toEqual({
      ok: false,
      reason: 'the base URL must use http or https',
    });
  });
});

describe('chooseSpikeProvider: the headers (AC6)', () => {
  it('takes valid header lines and builds the provider', () => {
    expect(
      chooseSpikeProvider(env({ headers: 'X-Harness-Test: e2e\nX-Team: platform' }), null),
    ).toMatchObject({ ok: true });
  });

  it('gives no headers for unset or empty HARNESS_SPIKE_HEADERS', () => {
    expect(chooseSpikeProvider(env({ headers: undefined }), null)).toMatchObject({ ok: true });
    expect(chooseSpikeProvider(env({ headers: '' }), null)).toMatchObject({ ok: true });
  });

  it('refuses a line with no colon and nothing runs', () => {
    expect(chooseSpikeProvider(env({ headers: 'X-Team platform' }), null)).toEqual({
      ok: false,
      reason: 'HARNESS_SPIKE_HEADERS: line 1 has no ":" between the name and the value',
    });
  });

  it('refuses a reserved header name, with the factory reason', () => {
    const choice = chooseSpikeProvider(env({ headers: 'x-api-key: 1' }), null);
    expect(choice).toEqual({
      ok: false,
      reason:
        'HARNESS_SPIKE_HEADERS: line 1: the header "x-api-key" is reserved (the adapter sets it or it carries the key)',
    });
  });

  it('keeps the key and a header value out of every refusal', () => {
    const headerRefusals = [
      `Authorization: Bearer ${HEADER_SENTINEL}`,
      `X-Team: ${HEADER_SENTINEL}\u0000`,
      `${HEADER_SENTINEL}`,
    ];
    for (const headers of headerRefusals) {
      const choice = chooseSpikeProvider(env({ headers }), SENTINEL);
      expect(choice.ok).toBe(false);
      expect(JSON.stringify(choice)).not.toContain(SENTINEL);
      expect(JSON.stringify(choice)).not.toContain(HEADER_SENTINEL);
    }
  });
});
