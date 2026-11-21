import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { describeError } from '../../src/agent/errors';
import { runAgentLoop } from '../../src/agent/loop';
import { createProvider, type ServerConfig } from '../../src/agent/provider/factory';
import { SPIKE_DEFAULT_MODELS, type SpikeFormat } from '../../src/agent/spike-provider';
import { SERVER_PRESETS, type WireFormat } from '../../src/shared/server-presets';

const FIXTURES = fileURLToPath(new URL('../fixtures/spike/', import.meta.url));
const SENTINEL = 'SENTINEL-KEY-factory-do-not-leak-8842';
const HEADER_SENTINEL = 'SENTINEL-HEADER-factory-do-not-leak-1190';
const EXPLICIT = 'http://gateway.test:4100';
const TOOL_OUTPUT = 'Spike note: the fixture was recorded from the gateway.';

interface Captured {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

/** A fake fetch that records each request and answers with respond(index). */
function recordingFetch(respond: (index: number) => Response | Promise<Response>) {
  const calls: Captured[] = [];
  const fetchImpl = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    });
    return respond(calls.length - 1);
  };
  return { fetch: fetchImpl as typeof globalThis.fetch, calls };
}

function sse(name: string): Response {
  return new Response(readFileSync(join(FIXTURES, name), 'utf8'), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

/** The recorded tool-call turn, then the recorded final turn, for one format. */
function fixtureResponder(format: WireFormat) {
  return (index: number): Response =>
    sse(join(format, index === 0 ? 'turn1-tool-call.sse' : 'turn2-final.sse'));
}

/** Runs the spike loop once on a provider, with read_file answered from a fixed output. */
function runLoop(provider: Parameters<typeof runAgentLoop>[0]['provider'], model: string) {
  const texts: string[] = [];
  return runAgentLoop({
    provider,
    model,
    job: 'reader',
    prompt: 'Read the file notes.txt with the read_file tool, then answer.',
    callTool: async (name) =>
      name === 'read_file' ? { ok: true, output: TOOL_OUTPUT } : { ok: false, reason: 'no tool' },
    onText: (text) => {
      texts.push(text);
    },
  }).then((result) => ({ result, text: texts.join('') }));
}

function refusal(config: ServerConfig, key: string | null = SENTINEL) {
  const result = createProvider(config, key, { maxRetries: 0 });
  if (result.ok) {
    throw new Error('expected a refusal');
  }
  return result.reason;
}

describe('createProvider refusals (AC5)', () => {
  it('refuses an unknown preset and lists the preset ids', () => {
    const reason = refusal({ preset: 'mystery', baseURL: EXPLICIT });
    for (const preset of SERVER_PRESETS) {
      expect(reason).toContain(preset.id);
    }
    expect(reason).not.toContain('mystery');
  });

  it('refuses a format the preset does not offer, naming the preset and the formats it offers', () => {
    expect(refusal({ preset: 'vllm', format: 'anthropic', baseURL: EXPLICIT })).toBe(
      'preset "vllm" does not offer the requested format; it offers openai',
    );
    expect(refusal({ preset: 'llama-cpp', format: 'anthropic', baseURL: EXPLICIT })).toContain(
      'preset "llama-cpp"',
    );
  });

  it('refuses no address when the preset has no default and none is given', () => {
    for (const preset of ['tgi-sglang', 'agentgateway', 'other']) {
      expect(refusal({ preset })).toBe(
        `preset "${preset}" has no default address; a base URL is required`,
      );
      expect(refusal({ preset, baseURL: '   ' })).toContain('no default address');
    }
  });

  it('refuses an address that does not parse as a URL, without echoing it', () => {
    const reason = refusal({ preset: 'other', baseURL: 'not a url SENTINEL-ADDRESS' });
    expect(reason).toBe('the base URL does not parse as a URL');
  });

  it('refuses an address that is not http or https', () => {
    expect(refusal({ preset: 'other', baseURL: 'ftp://gateway.test' })).toBe(
      'the base URL must use http or https',
    );
    expect(refusal({ preset: 'other', baseURL: 'file:///etc/passwd' })).toBe(
      'the base URL must use http or https',
    );
  });

  it('refuses an address with a user name or a password, without echoing it', () => {
    const userOnly = refusal({ preset: 'other', baseURL: 'http://someone@gateway.test' });
    const withPassword = refusal({ preset: 'other', baseURL: `http://u:${SENTINEL}@gateway.test` });
    expect(userOnly).toBe('the base URL must not contain a user name or a password');
    expect(withPassword).toBe('the base URL must not contain a user name or a password');
    expect(withPassword).not.toContain(SENTINEL);
  });

  it('refuses headers that fail validateHeaders, with the same reason', () => {
    expect(
      refusal({
        preset: 'other',
        baseURL: EXPLICIT,
        headers: { Authorization: `Bearer ${SENTINEL}` },
      }),
    ).toBe('the header "Authorization" is reserved (the adapter sets it or it carries the key)');
    expect(refusal({ preset: 'other', baseURL: EXPLICIT, headers: { 'X-Bad Name': 'v' } })).toBe(
      'the header name is not a valid HTTP token',
    );
  });

  it('checks in order: the preset before the format, the format before the address', () => {
    expect(refusal({ preset: 'mystery', format: 'anthropic' })).toContain('unknown');
    expect(refusal({ preset: 'vllm', format: 'anthropic' })).toContain('does not offer');
    expect(refusal({ preset: 'tgi-sglang', headers: { Host: 'x' } })).toContain('no default');
  });

  it('never puts the key or a header value in a refusal', () => {
    const configs: ServerConfig[] = [
      { preset: 'mystery', baseURL: `http://${SENTINEL}` },
      { preset: 'vllm', format: 'anthropic', baseURL: EXPLICIT },
      { preset: 'tgi-sglang' },
      { preset: 'other', baseURL: `http://u:${SENTINEL}@h` },
      { preset: 'other', baseURL: EXPLICIT, headers: { 'X-Team': `${HEADER_SENTINEL}\n` } },
      { preset: 'other', baseURL: EXPLICIT, headers: { Host: HEADER_SENTINEL } },
    ];
    for (const config of configs) {
      const text = refusal(config);
      expect(text).not.toContain(SENTINEL);
      expect(text).not.toContain(HEADER_SENTINEL);
    }
  });
});

describe('createProvider builds (AC5)', () => {
  it('uses the preset default address when the base URL is unset or empty', () => {
    const unset = createProvider({ preset: 'ollama' }, null);
    const empty = createProvider({ preset: 'ollama', baseURL: '' }, null);
    expect(unset).toMatchObject({
      ok: true,
      preset: 'ollama',
      baseURL: 'http://localhost:11434/v1',
    });
    expect(empty).toMatchObject({ ok: true, baseURL: 'http://localhost:11434/v1' });
  });

  it('uses the first format the preset offers when the format is unset or empty', () => {
    expect(createProvider({ preset: 'agentgateway', baseURL: EXPLICIT }, null)).toMatchObject({
      ok: true,
      format: 'openai',
    });
    expect(
      createProvider({ preset: 'agentgateway', format: '', baseURL: EXPLICIT }, null),
    ).toMatchObject({
      ok: true,
      format: 'openai',
    });
    expect(
      createProvider({ preset: 'agentgateway', format: 'anthropic', baseURL: EXPLICIT }, null),
    ).toMatchObject({
      ok: true,
      format: 'anthropic',
    });
  });

  it('prefers the given address to the preset default', () => {
    expect(createProvider({ preset: 'vllm', baseURL: EXPLICIT }, null)).toMatchObject({
      ok: true,
      baseURL: EXPLICIT,
    });
  });
});

describe('createProvider requests (AC5, AC7)', () => {
  it('sends the headers on the request for both formats', async () => {
    for (const format of ['openai', 'anthropic'] as const) {
      const fake = recordingFetch(() => sse(join(format, 'turn2-final.sse')));
      const built = createProvider(
        {
          preset: 'agentgateway',
          format,
          baseURL: EXPLICIT,
          headers: { 'X-Harness-Test': 'e2e' },
        },
        SENTINEL,
        { maxRetries: 0, fetch: fake.fetch },
      );
      if (!built.ok) {
        throw new Error(built.reason);
      }
      await runLoop(built.provider, SPIKE_DEFAULT_MODELS[format]);
      expect(fake.calls[0]?.headers.get('x-harness-test'), format).toBe('e2e');
    }
  });

  it('gives the /v1 forms of one address the same Anthropic request URL', async () => {
    for (const base of [EXPLICIT, `${EXPLICIT}/`, `${EXPLICIT}/v1`, `${EXPLICIT}/v1/`]) {
      const fake = recordingFetch(() => sse(join('anthropic', 'turn2-final.sse')));
      const built = createProvider(
        { preset: 'other', format: 'anthropic', baseURL: base },
        SENTINEL,
        {
          maxRetries: 0,
          fetch: fake.fetch,
        },
      );
      if (!built.ok) {
        throw new Error(built.reason);
      }
      await runLoop(built.provider, SPIKE_DEFAULT_MODELS.anthropic);
      expect(fake.calls[0]?.url, base).toBe(`${EXPLICIT}/v1/messages`);
    }
  });
});

describe('createProvider runs the fixture loop for every preset and format (AC7)', () => {
  for (const preset of SERVER_PRESETS) {
    for (const format of preset.formats) {
      it(`runs the loop to an answer through ${preset.id} on the ${format} format`, async () => {
        const fake = recordingFetch(fixtureResponder(format));
        const built = createProvider(
          {
            preset: preset.id,
            format,
            // Presets without a default address get an explicit one.
            ...(preset.defaultBaseURL === null ? { baseURL: EXPLICIT } : {}),
            headers: { 'X-Harness-Test': 'fixture' },
          },
          SENTINEL,
          { maxRetries: 0, fetch: fake.fetch },
        );
        if (!built.ok) {
          throw new Error(built.reason);
        }
        const { result, text } = await runLoop(
          built.provider,
          SPIKE_DEFAULT_MODELS[format as SpikeFormat],
        );

        expect(result.stopped).toBe('answered');
        expect(result.turns).toBe(2);
        expect(text).toContain('The file');
        expect(fake.calls).toHaveLength(2);
        expect(fake.calls.every((call) => call.headers.get('x-harness-test') === 'fixture')).toBe(
          true,
        );
        expect(JSON.stringify(text)).not.toContain(SENTINEL);
      });
    }
  }
});

describe('createProvider leak checks (AC7)', () => {
  it('keeps the key and a header value out of a provider error and its description', async () => {
    const fake = recordingFetch(
      () =>
        new Response(JSON.stringify({ error: { message: `${SENTINEL} ${HEADER_SENTINEL}` } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const built = createProvider(
      {
        preset: 'other',
        format: 'openai',
        baseURL: EXPLICIT,
        headers: { 'X-Team': HEADER_SENTINEL },
      },
      SENTINEL,
      { maxRetries: 0, fetch: fake.fetch },
    );
    if (!built.ok) {
      throw new Error(built.reason);
    }
    let error: unknown;
    try {
      await runLoop(built.provider, SPIKE_DEFAULT_MODELS.openai);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(SENTINEL);
    expect((error as Error).message).not.toContain(HEADER_SENTINEL);
    expect(describeError(error)).not.toContain(SENTINEL);
    expect(describeError(error)).not.toContain(HEADER_SENTINEL);
  });

  it('keeps the key and a header value out of a network error from a rejected fetch', async () => {
    const failing = (): Promise<Response> =>
      Promise.reject(new TypeError(`${SENTINEL} ${HEADER_SENTINEL} refused`));
    const built = createProvider(
      {
        preset: 'other',
        format: 'anthropic',
        baseURL: EXPLICIT,
        headers: { 'X-Team': HEADER_SENTINEL },
      },
      SENTINEL,
      { maxRetries: 0, fetch: failing as typeof globalThis.fetch },
    );
    if (!built.ok) {
      throw new Error(built.reason);
    }
    let error: unknown;
    try {
      await runLoop(built.provider, SPIKE_DEFAULT_MODELS.anthropic);
    } catch (caught) {
      error = caught;
    }
    expect(describeError(error)).toBe('provider network error');
    expect(JSON.stringify(error ?? null)).not.toContain(SENTINEL);
    expect(JSON.stringify(error ?? null)).not.toContain(HEADER_SENTINEL);
  });
});
