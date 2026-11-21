import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createOpenAIProvider, normalizeOpenAIBaseUrl } from '../../src/agent/provider/openai';
import {
  ProviderError,
  type ProviderRequest,
  type StreamEvent,
} from '../../src/agent/provider/types';

const FIXTURE_DIR = fileURLToPath(new URL('../fixtures/spike/openai/', import.meta.url));
const TOOL_CALL_BODY = readFileSync(join(FIXTURE_DIR, 'turn1-tool-call.sse'), 'utf8');
const FINAL_BODY = readFileSync(join(FIXTURE_DIR, 'turn2-final.sse'), 'utf8');
const FINAL_TEXT =
  'The file notes.txt contains a single spike note stating that the fixture was recorded from the gateway.';

const SENTINEL = 'SENTINEL-KEY-do-not-leak-5510';
const BASE_URL = 'http://gateway.test';
const MODEL = 'qwen3.8-flash-next-nothink';

const REQUEST: ProviderRequest = {
  model: MODEL,
  messages: [{ role: 'user', text: 'Read notes.txt and tell me what it says.' }],
  tools: [
    {
      name: 'read_file',
      description: "Read a text file under the agent's root and return its text.",
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
        additionalProperties: false,
      },
    },
  ],
};

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

function sseResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function errorResponse(status: number): Response {
  return new Response(JSON.stringify({ error: { message: `${SENTINEL} rejected` } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Builds an SSE body from chunk payloads, ending with [DONE]. */
function sse(payloads: unknown[]): string {
  return [...payloads.map((p) => `data: ${JSON.stringify(p)}`), 'data: [DONE]', ''].join('\n\n');
}

async function drain(iterable: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

/** Returns what a run threw. Fails the test if it did not throw. */
async function caught(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('expected the run to throw');
}

function chunk(delta: unknown, finish: string | null = null): unknown {
  return { id: 'c1', choices: [{ index: 0, delta, finish_reason: finish }] };
}

describe('normalizeOpenAIBaseUrl', () => {
  it('strips trailing slashes and appends /v1 when it is missing', () => {
    expect(normalizeOpenAIBaseUrl('http://gateway.test')).toBe('http://gateway.test/v1');
    expect(normalizeOpenAIBaseUrl('http://gateway.test/')).toBe('http://gateway.test/v1');
    expect(normalizeOpenAIBaseUrl('http://gateway.test:4100///')).toBe(
      'http://gateway.test:4100/v1',
    );
  });

  it('does not add a second /v1', () => {
    expect(normalizeOpenAIBaseUrl('http://gateway.test/v1')).toBe('http://gateway.test/v1');
    expect(normalizeOpenAIBaseUrl('http://gateway.test/v1/')).toBe('http://gateway.test/v1');
  });
});

describe('openai adapter requests', () => {
  it('posts chat completions with the tools, stream_options and the bearer key', async () => {
    const fake = recordingFetch(() => sseResponse(FINAL_BODY));
    const provider = createOpenAIProvider({
      baseURL: BASE_URL,
      key: SENTINEL,
      maxRetries: 0,
      fetch: fake.fetch,
    });
    await drain(provider.stream(REQUEST));

    expect(fake.calls).toHaveLength(1);
    const [call] = fake.calls;
    expect(call?.url).toBe('http://gateway.test/v1/chat/completions');
    expect(call?.headers.get('authorization')).toBe(`Bearer ${SENTINEL}`);
    expect(call?.body['stream']).toBe(true);
    expect(call?.body['stream_options']).toEqual({ include_usage: true });
    expect(call?.body['model']).toBe(MODEL);
    expect(JSON.stringify(call?.body)).not.toContain(SENTINEL);
  });

  it('sends the placeholder when the key is null', async () => {
    const fake = recordingFetch(() => sseResponse(FINAL_BODY));
    const provider = createOpenAIProvider({
      baseURL: BASE_URL,
      key: null,
      maxRetries: 0,
      fetch: fake.fetch,
    });
    await drain(provider.stream(REQUEST));
    expect(fake.calls[0]?.headers.get('authorization')).toBe('Bearer no-key-set');
  });

  it('sends max_tokens when the request sets maxTokens', async () => {
    const fake = recordingFetch(() => sseResponse(FINAL_BODY));
    const provider = createOpenAIProvider({
      baseURL: BASE_URL,
      key: SENTINEL,
      maxRetries: 0,
      fetch: fake.fetch,
    });
    await drain(provider.stream({ ...REQUEST, maxTokens: 256 }));
    expect(fake.calls[0]?.body['max_tokens']).toBe(256);
  });
});

describe('openai adapter keys and headers (AC3)', () => {
  it('sends the placeholder when the key is an empty string', async () => {
    const fake = recordingFetch(() => sseResponse(FINAL_BODY));
    const provider = createOpenAIProvider({
      baseURL: BASE_URL,
      key: '',
      maxRetries: 0,
      fetch: fake.fetch,
    });
    await drain(provider.stream(REQUEST));
    expect(fake.calls[0]?.headers.get('authorization')).toBe('Bearer no-key-set');
  });

  it('sends the extra headers on every request, with the bearer key intact', async () => {
    const fake = recordingFetch((index) => sseResponse(index === 0 ? TOOL_CALL_BODY : FINAL_BODY));
    const provider = createOpenAIProvider({
      baseURL: BASE_URL,
      key: SENTINEL,
      headers: { 'X-Team': 'platform', 'X-Route': 'a' },
      maxRetries: 0,
      fetch: fake.fetch,
    });
    await drain(provider.stream(REQUEST));
    await drain(provider.stream(REQUEST));
    expect(fake.calls).toHaveLength(2);
    for (const call of fake.calls) {
      expect(call.headers.get('x-team')).toBe('platform');
      expect(call.headers.get('x-route')).toBe('a');
      expect(call.headers.get('authorization')).toBe(`Bearer ${SENTINEL}`);
    }
  });

  it('keeps the /v1 handling: a base URL with /v1 is not given a second one', async () => {
    const fake = recordingFetch(() => sseResponse(FINAL_BODY));
    const provider = createOpenAIProvider({
      baseURL: `${BASE_URL}/v1/`,
      key: SENTINEL,
      maxRetries: 0,
      fetch: fake.fetch,
    });
    await drain(provider.stream(REQUEST));
    expect(fake.calls[0]?.url).toBe('http://gateway.test/v1/chat/completions');
  });
});

describe('openai adapter on the recorded fixtures', () => {
  it('turns the tool-call turn into one read_file call, usage and tool-use', async () => {
    const fake = recordingFetch(() => sseResponse(TOOL_CALL_BODY));
    const provider = createOpenAIProvider({
      baseURL: BASE_URL,
      key: SENTINEL,
      maxRetries: 0,
      fetch: fake.fetch,
    });
    const events = await drain(provider.stream(REQUEST));

    expect(events.some((e) => e.type === 'text')).toBe(false);
    const calls = events.filter((e) => e.type === 'tool-call');
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.type === 'tool-call' && call.name).toBe('read_file');
    expect(call?.type === 'tool-call' && call.id).toBe('chatcmpl-tool-a469c41edb3231b8');
    const args =
      call?.type === 'tool-call' ? (JSON.parse(call.arguments) as { path?: unknown }) : {};
    expect(typeof args.path).toBe('string');

    expect(events).toContainEqual({ type: 'usage', inputTokens: 330, outputTokens: 26 });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'tool-use' });
  });

  it('streams the final turn as text in order, then usage and end', async () => {
    const fake = recordingFetch(() => sseResponse(FINAL_BODY));
    const provider = createOpenAIProvider({
      baseURL: BASE_URL,
      key: SENTINEL,
      maxRetries: 0,
      fetch: fake.fetch,
    });
    const events = await drain(provider.stream(REQUEST));

    const text = events.flatMap((e) => (e.type === 'text' ? [e.text] : [])).join('');
    expect(text).toBe(FINAL_TEXT);
    expect(events.some((e) => e.type === 'tool-call')).toBe(false);
    expect(events).toContainEqual({ type: 'usage', inputTokens: 385, outputTokens: 20 });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end' });
  });
});

describe('openai adapter stream handling', () => {
  it('emits each text delta as its own text event, in order', async () => {
    const body = sse([
      chunk({ content: 'Hel' }),
      chunk({ content: 'lo' }),
      chunk({ content: ' world' }, 'stop'),
    ]);
    const fake = recordingFetch(() => sseResponse(body));
    const provider = createOpenAIProvider({
      baseURL: BASE_URL,
      key: SENTINEL,
      maxRetries: 0,
      fetch: fake.fetch,
    });
    const events = await drain(provider.stream(REQUEST));
    expect(events).toEqual([
      { type: 'text', text: 'Hel' },
      { type: 'text', text: 'lo' },
      { type: 'text', text: ' world' },
      { type: 'done', stopReason: 'end' },
    ]);
  });

  it('merges a call whose name and arguments come in separate chunks, with extra fields and no-choice chunks', async () => {
    const body = sse([
      { id: 'c1', choices: [] },
      chunk({
        tool_calls: [{ index: 0, id: 'call_a', function: { name: 'read_file', arguments: '' } }],
      }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: '{"pa' } }] }),
      chunk(
        { tool_calls: [{ index: 0, extra: 'ignored', function: { arguments: 'th":"a.txt"}' } }] },
        'tool_calls',
      ),
    ]);
    const fake = recordingFetch(() => sseResponse(body));
    const provider = createOpenAIProvider({
      baseURL: BASE_URL,
      key: SENTINEL,
      maxRetries: 0,
      fetch: fake.fetch,
    });
    const events = await drain(provider.stream(REQUEST));
    expect(events).toEqual([
      { type: 'tool-call', id: 'call_a', name: 'read_file', arguments: '{"path":"a.txt"}' },
      { type: 'done', stopReason: 'tool-use' },
    ]);
  });

  it('numbers a call with no id or index as call_<slot>, and starts a new slot for a named id with no index', async () => {
    const body = sse([
      chunk({ tool_calls: [{ function: { name: 'read_file', arguments: '{"path":"y"}' } }] }),
      chunk(
        {
          tool_calls: [
            { id: 'call_x', function: { name: 'read_file', arguments: '{"path":"x"}' } },
          ],
        },
        'tool_calls',
      ),
    ]);
    const fake = recordingFetch(() => sseResponse(body));
    const provider = createOpenAIProvider({
      baseURL: BASE_URL,
      key: SENTINEL,
      maxRetries: 0,
      fetch: fake.fetch,
    });
    const events = await drain(provider.stream(REQUEST));
    expect(events).toEqual([
      { type: 'tool-call', id: 'call_0', name: 'read_file', arguments: '{"path":"y"}' },
      { type: 'tool-call', id: 'call_x', name: 'read_file', arguments: '{"path":"x"}' },
      { type: 'done', stopReason: 'tool-use' },
    ]);
  });

  it('maps cached prompt tokens to cacheReadTokens', async () => {
    const body = sse([
      chunk({ content: 'ok' }, 'stop'),
      {
        id: 'c1',
        choices: [],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 2,
          total_tokens: 12,
          prompt_tokens_details: { cached_tokens: 4 },
        },
      },
    ]);
    const fake = recordingFetch(() => sseResponse(body));
    const provider = createOpenAIProvider({
      baseURL: BASE_URL,
      key: SENTINEL,
      maxRetries: 0,
      fetch: fake.fetch,
    });
    const events = await drain(provider.stream(REQUEST));
    expect(events).toContainEqual({
      type: 'usage',
      inputTokens: 10,
      outputTokens: 2,
      cacheReadTokens: 4,
    });
  });
});

describe('openai adapter errors', () => {
  it('maps 401 to auth, with no retry when maxRetries is 0', async () => {
    const fake = recordingFetch(() => errorResponse(401));
    const provider = createOpenAIProvider({
      baseURL: BASE_URL,
      key: SENTINEL,
      maxRetries: 0,
      fetch: fake.fetch,
    });
    const error = await caught(() => drain(provider.stream(REQUEST)));
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ kind: 'auth', status: 401, retryable: false });
    expect(fake.calls).toHaveLength(1);
    expect((error as Error).message).toBe('provider auth error (HTTP 401)');
    expect((error as Error).message).not.toContain(SENTINEL);
  });

  it('maps 429 to rate-limit, retryable', async () => {
    const fake = recordingFetch(() => errorResponse(429));
    const provider = createOpenAIProvider({
      baseURL: BASE_URL,
      key: SENTINEL,
      maxRetries: 0,
      fetch: fake.fetch,
    });
    const error = await caught(() => drain(provider.stream(REQUEST)));
    expect(error).toMatchObject({ kind: 'rate-limit', status: 429, retryable: true });
  });

  it('retries a 500 once when maxRetries is 1, then throws a server error', async () => {
    const fake = recordingFetch(() => errorResponse(500));
    const provider = createOpenAIProvider({
      baseURL: BASE_URL,
      key: SENTINEL,
      maxRetries: 1,
      fetch: fake.fetch,
    });
    const error = await caught(() => drain(provider.stream(REQUEST)));
    expect(fake.calls).toHaveLength(2);
    expect(error).toMatchObject({ kind: 'server', status: 500, retryable: true });
    expect(JSON.stringify(error)).not.toContain(SENTINEL);
  }, 15_000);

  it('maps a network failure to network, with no status, and keeps the sentinel out of the error', async () => {
    const fetchImpl = (): Promise<Response> =>
      Promise.reject(new TypeError(`${SENTINEL} connection refused`));
    const provider = createOpenAIProvider({
      baseURL: BASE_URL,
      key: SENTINEL,
      maxRetries: 0,
      fetch: fetchImpl as typeof globalThis.fetch,
    });
    const error = await caught(() => drain(provider.stream(REQUEST)));
    expect(error).toMatchObject({ kind: 'network', retryable: true });
    expect((error as ProviderError).status).toBeUndefined();
    expect((error as Error).message).not.toContain(SENTINEL);
  });

  it('maps an abort to aborted, not retryable', async () => {
    const fetchImpl = (_input: string | URL, init?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    const provider = createOpenAIProvider({
      baseURL: BASE_URL,
      key: SENTINEL,
      maxRetries: 0,
      fetch: fetchImpl as typeof globalThis.fetch,
    });
    const controller = new AbortController();
    const pending = caught(() => drain(provider.stream(REQUEST, controller.signal)));
    setTimeout(() => controller.abort(), 0);
    const error = await pending;
    expect(error).toMatchObject({ kind: 'aborted', retryable: false });
  });
});

/** A /models body in the OpenAI list shape. */
function modelsResponse(data: unknown[]): Response {
  return new Response(JSON.stringify({ object: 'list', data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('openai adapter listing (AC2)', () => {
  it('GETs /v1/models with the bearer key and returns each id', async () => {
    const fake = recordingFetch(() => modelsResponse([{ id: 'model-a' }, { id: 'model-b' }]));
    const provider = createOpenAIProvider({
      baseURL: BASE_URL,
      key: SENTINEL,
      maxRetries: 0,
      fetch: fake.fetch,
    });
    const models = await provider.listModels();

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.url).toBe('http://gateway.test/v1/models');
    expect(fake.calls[0]?.headers.get('authorization')).toBe(`Bearer ${SENTINEL}`);
    expect(models).toEqual([
      { id: 'model-a', contextWindow: null },
      { id: 'model-b', contextWindow: null },
    ]);
  });

  it('uses the same path when the base URL already ends in /v1', async () => {
    const fake = recordingFetch(() => modelsResponse([]));
    const provider = createOpenAIProvider({
      baseURL: 'http://gateway.test/v1/',
      key: null,
      maxRetries: 0,
      fetch: fake.fetch,
    });
    await provider.listModels();
    expect(fake.calls[0]?.url).toBe('http://gateway.test/v1/models');
  });

  it('reads max_model_len as the context window, then the other fields in order', async () => {
    const fake = recordingFetch(() =>
      modelsResponse([
        { id: 'vllm', max_model_len: 32768, context_length: 4096 },
        { id: 'other', context_length: 8192, context_window: 2048 },
        { id: 'last', context_window: 1024 },
      ]),
    );
    const provider = createOpenAIProvider({
      baseURL: BASE_URL,
      key: null,
      maxRetries: 0,
      fetch: fake.fetch,
    });
    expect(await provider.listModels()).toEqual([
      { id: 'vllm', contextWindow: 32768 },
      { id: 'other', contextWindow: 8192 },
      { id: 'last', contextWindow: 1024 },
    ]);
  });

  it('returns null when no context field is a positive integer', async () => {
    const fake = recordingFetch(() =>
      modelsResponse([
        { id: 'zero', max_model_len: 0 },
        { id: 'text', max_model_len: '8192' },
        { id: 'fraction', context_length: 1.5 },
        { id: 'none' },
      ]),
    );
    const provider = createOpenAIProvider({
      baseURL: BASE_URL,
      key: null,
      maxRetries: 0,
      fetch: fake.fetch,
    });
    const models = await provider.listModels();
    expect(models.map((m) => m.contextWindow)).toEqual([null, null, null, null]);
  });

  it('skips entries without a string id', async () => {
    const fake = recordingFetch(() =>
      modelsResponse([{ id: 'kept' }, { id: 7 }, { name: 'no-id' }, null]),
    );
    const provider = createOpenAIProvider({
      baseURL: BASE_URL,
      key: null,
      maxRetries: 0,
      fetch: fake.fetch,
    });
    expect(await provider.listModels()).toEqual([{ id: 'kept', contextWindow: null }]);
  });

  it('sends the extra headers on the listing request', async () => {
    const fake = recordingFetch(() => modelsResponse([]));
    const provider = createOpenAIProvider({
      baseURL: BASE_URL,
      key: null,
      maxRetries: 0,
      headers: { 'X-Probe-Route': 'route-sentinel-7' },
      fetch: fake.fetch,
    });
    await provider.listModels();
    expect(fake.calls[0]?.headers.get('x-probe-route')).toBe('route-sentinel-7');
  });

  it('maps an HTTP error to its kind, without the server message or the key', async () => {
    const fake = recordingFetch(() => errorResponse(401));
    const provider = createOpenAIProvider({
      baseURL: BASE_URL,
      key: SENTINEL,
      maxRetries: 0,
      fetch: fake.fetch,
    });
    const error = await caught(() => provider.listModels());
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ kind: 'auth', status: 401 });
    expect(String((error as Error).message)).not.toContain(SENTINEL);
  });

  it('maps a 429 to rate-limit', async () => {
    const fake = recordingFetch(() => errorResponse(429));
    const provider = createOpenAIProvider({
      baseURL: BASE_URL,
      key: null,
      maxRetries: 0,
      fetch: fake.fetch,
    });
    expect(await caught(() => provider.listModels())).toMatchObject({ kind: 'rate-limit' });
  });
});

describe('openai adapter system prompt (AC3, D32)', () => {
  const USER_MESSAGE = { role: 'user', content: 'Read notes.txt and tell me what it says.' };

  it('sends the system prompt as a leading system message, before the history', async () => {
    const fake = recordingFetch(() => sseResponse(FINAL_BODY));
    const provider = createOpenAIProvider({
      baseURL: BASE_URL,
      key: SENTINEL,
      maxRetries: 0,
      fetch: fake.fetch,
    });
    await drain(provider.stream({ ...REQUEST, system: 'You are the reader.' }));

    expect(fake.calls[0]?.body['messages']).toEqual([
      { role: 'system', content: 'You are the reader.' },
      USER_MESSAGE,
    ]);
  });

  it('sends no system message when the system prompt is unset, as before the field existed', async () => {
    const fake = recordingFetch(() => sseResponse(FINAL_BODY));
    const provider = createOpenAIProvider({
      baseURL: BASE_URL,
      key: SENTINEL,
      maxRetries: 0,
      fetch: fake.fetch,
    });
    await drain(provider.stream(REQUEST));

    expect(fake.calls[0]?.body['messages']).toEqual([USER_MESSAGE]);
  });

  it('sends no system message when the system prompt is an empty string', async () => {
    const unset = recordingFetch(() => sseResponse(FINAL_BODY));
    await drain(
      createOpenAIProvider({
        baseURL: BASE_URL,
        key: SENTINEL,
        maxRetries: 0,
        fetch: unset.fetch,
      }).stream(REQUEST),
    );
    const empty = recordingFetch(() => sseResponse(FINAL_BODY));
    await drain(
      createOpenAIProvider({
        baseURL: BASE_URL,
        key: SENTINEL,
        maxRetries: 0,
        fetch: empty.fetch,
      }).stream({ ...REQUEST, system: '' }),
    );

    expect(empty.calls[0]?.body['messages']).toEqual([USER_MESSAGE]);
    expect(empty.calls[0]?.body).toEqual(unset.calls[0]?.body);
  });
});

describe('openai adapter tools field (p1-model-probes U1)', () => {
  it('omits the tools field from the request when the tool list is empty', async () => {
    const fake = recordingFetch(() => sseResponse(FINAL_BODY));
    const provider = createOpenAIProvider({
      baseURL: BASE_URL,
      key: SENTINEL,
      maxRetries: 0,
      fetch: fake.fetch,
    });
    await drain(
      provider.stream({ model: MODEL, messages: [{ role: 'user', text: 'hi' }], tools: [] }),
    );
    expect(fake.calls[0]?.body).not.toHaveProperty('tools');
    expect(fake.calls[0]?.body['stream']).toBe(true);
  });

  it('sends the tools field when the tool list is not empty', async () => {
    const fake = recordingFetch(() => sseResponse(FINAL_BODY));
    const provider = createOpenAIProvider({
      baseURL: BASE_URL,
      key: SENTINEL,
      maxRetries: 0,
      fetch: fake.fetch,
    });
    await drain(provider.stream(REQUEST));
    expect(fake.calls[0]?.body['tools']).toHaveLength(1);
  });
});
