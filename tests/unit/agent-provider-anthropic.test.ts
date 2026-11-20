import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createAnthropicProvider,
  normalizeAnthropicBaseUrl,
} from '../../src/agent/provider/anthropic';
import {
  ProviderError,
  type ProviderRequest,
  type StreamEvent,
} from '../../src/agent/provider/types';

const FIXTURE_DIR = fileURLToPath(new URL('../fixtures/spike/anthropic/', import.meta.url));
const RECORDER = fileURLToPath(new URL('../../scripts/record-spike-fixture.ts', import.meta.url));
const TOOL_CALL_BODY = readFileSync(join(FIXTURE_DIR, 'turn1-tool-call.sse'), 'utf8');
const FINAL_BODY = readFileSync(join(FIXTURE_DIR, 'turn2-final.sse'), 'utf8');
const FINAL_TEXT = 'The file says that the fixture was recorded from the gateway.';
const TOOL_USE_ID = 'toolu_016S66agK5CvCcw98mYJHPvw';

const SENTINEL = 'SENTINEL-KEY-do-not-leak-6604';
const BASE_URL = 'http://gateway.test';
const MODEL = 'claude-haiku-5-5';

const READ_FILE = {
  name: 'read_file',
  description: "Read a text file under the agent's root and return its text.",
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
    additionalProperties: false,
  },
};

const REQUEST: ProviderRequest = {
  model: MODEL,
  messages: [{ role: 'user', text: 'Read notes.txt and tell me what it says.' }],
  tools: [READ_FILE],
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
  return new Response(
    JSON.stringify({
      type: 'error',
      error: { type: 'api_error', message: `${SENTINEL} rejected` },
    }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

/** Builds an Anthropic SSE body from [event type, payload] pairs. */
function anthropicSse(events: Array<[string, Record<string, unknown>]>): string {
  return events
    .map(([type, data]) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
    .join('');
}

function messageStart(usage: Record<string, unknown>): [string, Record<string, unknown>] {
  return [
    'message_start',
    {
      message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: MODEL,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 5,
          output_tokens: 1,
          cache_creation_input_tokens: null,
          cache_read_input_tokens: null,
          ...usage,
        },
      },
    },
  ];
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

/** The anthropic-version constant in the recorder source. Read as text, so the script never runs. */
function recorderVersion(): string {
  const source = readFileSync(RECORDER, 'utf8');
  const match = /const ANTHROPIC_VERSION = '([^']+)';/.exec(source);
  if (!match?.[1]) {
    throw new Error('ANTHROPIC_VERSION not found in the recorder');
  }
  return match[1];
}

function bearerProvider(fake: { fetch: typeof globalThis.fetch }, extra: object = {}) {
  return createAnthropicProvider({
    baseURL: BASE_URL,
    key: SENTINEL,
    maxRetries: 0,
    fetch: fake.fetch,
    ...extra,
  });
}

describe('anthropic adapter requests', () => {
  it('posts /v1/messages with Bearer auth and the tools, and no x-api-key header', async () => {
    const fake = recordingFetch(() => sseResponse(FINAL_BODY));
    await drain(bearerProvider(fake).stream(REQUEST));

    const [call] = fake.calls;
    expect(fake.calls).toHaveLength(1);
    expect(call?.url).toBe('http://gateway.test/v1/messages');
    expect(call?.headers.get('authorization')).toBe(`Bearer ${SENTINEL}`);
    expect(call?.headers.has('x-api-key')).toBe(false);
    expect(call?.body['stream']).toBe(true);
    expect(call?.body['model']).toBe(MODEL);
    expect(call?.body['max_tokens']).toBe(1024);
    expect(call?.body['tools']).toEqual([
      { name: 'read_file', description: READ_FILE.description, input_schema: READ_FILE.parameters },
    ]);
    expect(JSON.stringify(call?.body)).not.toContain(SENTINEL);
  });

  it('checks the SDK anthropic-version header against the recorder constant', async () => {
    const fake = recordingFetch(() => sseResponse(FINAL_BODY));
    await drain(bearerProvider(fake).stream(REQUEST));
    const sent = fake.calls[0]?.headers.get('anthropic-version');
    expect(sent).toBe(recorderVersion());
    expect(sent).not.toBe('2023-06-01');
  });

  it('sends the placeholder as the Bearer token when the key is null', async () => {
    const fake = recordingFetch(() => sseResponse(FINAL_BODY));
    await drain(bearerProvider(fake, { key: null }).stream(REQUEST));
    expect(fake.calls[0]?.headers.get('authorization')).toBe('Bearer no-key-set');
  });

  it('posts to the root address with the port kept', async () => {
    const fake = recordingFetch(() => sseResponse(FINAL_BODY));
    await drain(bearerProvider(fake, { baseURL: 'http://gateway.test:4100' }).stream(REQUEST));
    expect(fake.calls[0]?.url).toBe('http://gateway.test:4100/v1/messages');
  });

  it('sends the placeholder as the Bearer token when the key is an empty string', async () => {
    const fake = recordingFetch(() => sseResponse(FINAL_BODY));
    await drain(bearerProvider(fake, { key: '' }).stream(REQUEST));
    expect(fake.calls[0]?.headers.get('authorization')).toBe('Bearer no-key-set');
  });

  it('uses the request maxTokens first, then the factory maxTokens, then 1024', async () => {
    const fake = recordingFetch(() => sseResponse(FINAL_BODY));
    const provider = bearerProvider(fake, { maxTokens: 512 });
    await drain(provider.stream({ ...REQUEST, maxTokens: 256 }));
    await drain(provider.stream(REQUEST));
    expect(fake.calls[0]?.body['max_tokens']).toBe(256);
    expect(fake.calls[1]?.body['max_tokens']).toBe(512);
  });

  it('maps the history: tool calls become tool_use blocks, results a user tool_result message', async () => {
    const fake = recordingFetch(() => sseResponse(FINAL_BODY));
    await drain(
      bearerProvider(fake).stream({
        model: MODEL,
        tools: [READ_FILE],
        messages: [
          { role: 'user', text: 'Read it.' },
          {
            role: 'assistant',
            text: '',
            toolCalls: [{ id: 'toolu_1', name: 'read_file', arguments: '{"path":"notes.txt"}' }],
          },
          { role: 'tool', toolCallId: 'toolu_1', content: 'the note' },
          { role: 'tool', toolCallId: 'toolu_2', content: 'second result' },
        ],
      }),
    );
    expect(fake.calls[0]?.body['messages']).toEqual([
      { role: 'user', content: 'Read it.' },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'notes.txt' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: 'the note' },
          { type: 'tool_result', tool_use_id: 'toolu_2', content: 'second result' },
        ],
      },
    ]);
  });
});

describe('normalizeAnthropicBaseUrl (AC4)', () => {
  it('strips trailing slashes, then one /v1, then trailing slashes again', () => {
    expect(normalizeAnthropicBaseUrl('http://h:4100')).toBe('http://h:4100');
    expect(normalizeAnthropicBaseUrl('http://h:4100/')).toBe('http://h:4100');
    expect(normalizeAnthropicBaseUrl('http://h:4100/v1')).toBe('http://h:4100');
    expect(normalizeAnthropicBaseUrl('http://h:4100/v1/')).toBe('http://h:4100');
    expect(normalizeAnthropicBaseUrl('http://h:4100/v1//')).toBe('http://h:4100');
    expect(normalizeAnthropicBaseUrl('http://h:4100/v1/v1')).toBe('http://h:4100/v1');
  });
});

describe('anthropic adapter /v1 forms (AC4)', () => {
  it('posts to /v1/messages for each of the four forms of one address', async () => {
    for (const base of [
      'http://h:4100',
      'http://h:4100/',
      'http://h:4100/v1',
      'http://h:4100/v1/',
    ]) {
      const fake = recordingFetch(() => sseResponse(FINAL_BODY));
      await drain(bearerProvider(fake, { baseURL: base }).stream(REQUEST));
      expect(fake.calls[0]?.url, base).toBe('http://h:4100/v1/messages');
    }
  });
});

describe('anthropic adapter extra headers (AC4)', () => {
  it('sends the extra headers on the request, with the Bearer auth and anthropic-version intact', async () => {
    const fake = recordingFetch(() => sseResponse(FINAL_BODY));
    await drain(bearerProvider(fake, { headers: { 'X-Team': 'platform' } }).stream(REQUEST));
    const [call] = fake.calls;
    expect(call?.headers.get('x-team')).toBe('platform');
    expect(call?.headers.get('authorization')).toBe(`Bearer ${SENTINEL}`);
    expect(call?.headers.get('anthropic-version')).toBe(recorderVersion());
    expect(call?.headers.has('x-api-key')).toBe(false);
  });

  it('sends the headers on every request of a run', async () => {
    const fake = recordingFetch((index) => sseResponse(index === 0 ? TOOL_CALL_BODY : FINAL_BODY));
    const provider = bearerProvider(fake, { headers: { 'X-Team': 'platform' } });
    await drain(provider.stream(REQUEST));
    await drain(provider.stream(REQUEST));
    expect(fake.calls).toHaveLength(2);
    for (const call of fake.calls) {
      expect(call.headers.get('x-team')).toBe('platform');
    }
  });
});

describe('anthropic adapter on the recorded fixtures', () => {
  it('turns the tool-call turn into one read_file call, usage and tool-use', async () => {
    const fake = recordingFetch(() => sseResponse(TOOL_CALL_BODY));
    const events = await drain(bearerProvider(fake).stream(REQUEST));

    expect(events.some((e) => e.type === 'text')).toBe(false);
    expect(events.filter((e) => e.type === 'tool-call')).toEqual([
      {
        type: 'tool-call',
        id: TOOL_USE_ID,
        name: 'read_file',
        arguments: '{"path": "notes.txt"}',
      },
    ]);
    // The fixture sends zero cache counts, so the usage event carries them as zeros.
    expect(events).toContainEqual({
      type: 'usage',
      inputTokens: 444,
      outputTokens: 51,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'tool-use' });
  });

  it('streams the final turn as text in order, then usage and end', async () => {
    const fake = recordingFetch(() => sseResponse(FINAL_BODY));
    const events = await drain(bearerProvider(fake).stream(REQUEST));

    expect(events.flatMap((e) => (e.type === 'text' ? [e.text] : [])).join('')).toBe(FINAL_TEXT);
    expect(events.some((e) => e.type === 'tool-call')).toBe(false);
    expect(events).toContainEqual({
      type: 'usage',
      inputTokens: 519,
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end' });
  });
});

describe('anthropic adapter stream handling', () => {
  it('joins input_json_delta pieces into one tool-call at the block stop', async () => {
    const body = anthropicSse([
      messageStart({}),
      [
        'content_block_start',
        {
          index: 1,
          content_block: { type: 'tool_use', id: 'toolu_b', name: 'read_file', input: {} },
        },
      ],
      [
        'content_block_delta',
        { index: 1, delta: { type: 'input_json_delta', partial_json: '{"pa' } },
      ],
      [
        'content_block_delta',
        { index: 1, delta: { type: 'input_json_delta', partial_json: 'th":"c.txt"}' } },
      ],
      ['content_block_stop', { index: 1 }],
      ['message_delta', { delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 7 } }],
      ['message_stop', {}],
    ]);
    const fake = recordingFetch(() => sseResponse(body));
    const events = await drain(bearerProvider(fake).stream(REQUEST));
    expect(events).toEqual([
      { type: 'tool-call', id: 'toolu_b', name: 'read_file', arguments: '{"path":"c.txt"}' },
      { type: 'usage', inputTokens: 5, outputTokens: 7 },
      { type: 'done', stopReason: 'tool-use' },
    ]);
  });

  it('gives an empty tool input as {}', async () => {
    const body = anthropicSse([
      messageStart({}),
      [
        'content_block_start',
        {
          index: 0,
          content_block: { type: 'tool_use', id: 'toolu_e', name: 'read_file', input: {} },
        },
      ],
      ['content_block_stop', { index: 0 }],
      ['message_delta', { delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 2 } }],
    ]);
    const fake = recordingFetch(() => sseResponse(body));
    const events = await drain(bearerProvider(fake).stream(REQUEST));
    expect(events).toContainEqual({
      type: 'tool-call',
      id: 'toolu_e',
      name: 'read_file',
      arguments: '{}',
    });
  });

  it('carries cache counts into the usage event when the provider sends them', async () => {
    const body = anthropicSse([
      messageStart({ cache_read_input_tokens: 3, cache_creation_input_tokens: 2 }),
      ['content_block_start', { index: 0, content_block: { type: 'text', text: '' } }],
      ['content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'ok' } }],
      ['content_block_stop', { index: 0 }],
      ['message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } }],
    ]);
    const fake = recordingFetch(() => sseResponse(body));
    const events = await drain(bearerProvider(fake).stream(REQUEST));
    expect(events).toContainEqual({
      type: 'usage',
      inputTokens: 5,
      outputTokens: 4,
      cacheReadTokens: 3,
      cacheWriteTokens: 2,
    });
  });

  it.each([
    ['end_turn', 'end'],
    ['stop_sequence', 'end'],
    ['max_tokens', 'max-tokens'],
    ['refusal', 'other'],
  ])('maps stop_reason %s to %s', async (reason, expected) => {
    const body = anthropicSse([
      messageStart({}),
      ['message_delta', { delta: { stop_reason: reason }, usage: { output_tokens: 1 } }],
    ]);
    const fake = recordingFetch(() => sseResponse(body));
    const events = await drain(bearerProvider(fake).stream(REQUEST));
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: expected });
  });
});

describe('anthropic adapter errors', () => {
  it('maps 401 to auth, with no retry when maxRetries is 0', async () => {
    const fake = recordingFetch(() => errorResponse(401));
    const error = await caught(() => drain(bearerProvider(fake).stream(REQUEST)));
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ kind: 'auth', status: 401, retryable: false });
    expect(fake.calls).toHaveLength(1);
    expect((error as Error).message).toBe('provider auth error (HTTP 401)');
    expect((error as Error).message).not.toContain(SENTINEL);
  });

  it('maps 429 to rate-limit, retryable', async () => {
    const fake = recordingFetch(() => errorResponse(429));
    const error = await caught(() => drain(bearerProvider(fake).stream(REQUEST)));
    expect(error).toMatchObject({ kind: 'rate-limit', status: 429, retryable: true });
  });

  it('retries a 500 once when maxRetries is 1, then throws a server error', async () => {
    const fake = recordingFetch(() => errorResponse(500));
    const provider = bearerProvider(fake, { maxRetries: 1 });
    const error = await caught(() => drain(provider.stream(REQUEST)));
    expect(fake.calls).toHaveLength(2);
    expect(error).toMatchObject({ kind: 'server', status: 500, retryable: true });
    expect(JSON.stringify(error)).not.toContain(SENTINEL);
  }, 15_000);

  it('maps a network failure to network, with no status, and keeps the sentinel out of the error', async () => {
    const fetchImpl = (): Promise<Response> =>
      Promise.reject(new TypeError(`${SENTINEL} connection refused`));
    const provider = bearerProvider({ fetch: fetchImpl as typeof globalThis.fetch });
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
    const provider = bearerProvider({ fetch: fetchImpl as typeof globalThis.fetch });
    const controller = new AbortController();
    const pending = caught(() => drain(provider.stream(REQUEST, controller.signal)));
    setTimeout(() => controller.abort(), 0);
    expect(await pending).toMatchObject({ kind: 'aborted', retryable: false });
  });
});
