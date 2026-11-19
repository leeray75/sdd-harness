import { describe, expect, it } from 'vitest';
import {
  chooseSpikeProvider,
  SPIKE_DEFAULT_MODELS,
  SPIKE_PROVIDER_REFUSAL,
} from '../../src/agent/spike-provider';

const BASE_URL = 'http://gateway.test:4100';
const SENTINEL = 'SENTINEL-KEY-do-not-leak-3317';

describe('chooseSpikeProvider (AC7)', () => {
  it('uses the openai format when HARNESS_SPIKE_PROVIDER is unset, with the openai default model', () => {
    const choice = chooseSpikeProvider(
      { provider: undefined, model: undefined, baseURL: BASE_URL },
      SENTINEL,
    );
    expect(choice).toMatchObject({
      ok: true,
      format: 'openai',
      model: 'qwen3.8-flash-next-nothink',
    });
  });

  it('treats an empty HARNESS_SPIKE_PROVIDER as unset', () => {
    expect(chooseSpikeProvider({ provider: '', model: '', baseURL: BASE_URL }, null)).toMatchObject(
      {
        ok: true,
        format: 'openai',
      },
    );
  });

  it('uses the openai format for openai', () => {
    expect(
      chooseSpikeProvider({ provider: 'openai', model: undefined, baseURL: BASE_URL }, null),
    ).toMatchObject({
      ok: true,
      format: 'openai',
      model: SPIKE_DEFAULT_MODELS.openai,
    });
  });

  it('uses the anthropic format and its default model for anthropic', () => {
    const choice = chooseSpikeProvider(
      { provider: 'anthropic', model: undefined, baseURL: BASE_URL },
      SENTINEL,
    );
    expect(choice).toMatchObject({ ok: true, format: 'anthropic', model: 'claude-haiku-5-5' });
    if (choice.ok) {
      expect(typeof choice.provider.stream).toBe('function');
    }
  });

  it('lets HARNESS_SPIKE_MODEL override the default for either format', () => {
    expect(
      chooseSpikeProvider({ provider: 'anthropic', model: 'some-model', baseURL: BASE_URL }, null),
    ).toMatchObject({ ok: true, model: 'some-model' });
    expect(
      chooseSpikeProvider({ provider: undefined, model: 'other-model', baseURL: BASE_URL }, null),
    ).toMatchObject({ ok: true, model: 'other-model' });
  });

  it('refuses any other value with the exact message, and builds no provider', () => {
    const choice = chooseSpikeProvider(
      { provider: 'bedrock', model: undefined, baseURL: BASE_URL },
      null,
    );
    expect(choice).toEqual({ ok: false, reason: SPIKE_PROVIDER_REFUSAL });
    expect(SPIKE_PROVIDER_REFUSAL).toBe('HARNESS_SPIKE_PROVIDER must be openai or anthropic');
    expect(choice).not.toHaveProperty('provider');
  });

  it('keeps the key out of the refusal text', () => {
    const choice = chooseSpikeProvider(
      { provider: 'nope', model: undefined, baseURL: BASE_URL },
      SENTINEL,
    );
    expect(JSON.stringify(choice)).not.toContain(SENTINEL);
  });
});
