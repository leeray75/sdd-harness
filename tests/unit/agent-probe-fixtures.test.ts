import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { probeModel, listServerModels, type ProbeOptions } from '../../src/agent/probes/run';
import { TOOL_RESULT } from '../../src/agent/probes/tool-use';
import { createProvider } from '../../src/agent/provider/factory';
import { ProviderError, type Provider } from '../../src/agent/provider/types';
import { caught, makeClock, type Clock } from './probe-helpers';

// Replays the recorded probe fixtures (tests/fixtures/probes/<format>) through createProvider and an
// injected fetch, for both wire formats (AC8, AC10). The expectations read the fixture files, so the
// same tests pass on the files the user records with pnpm record:probes. Failing cases are derived
// from the recorded streams, not recorded. Sentinel values stand in for the key and a header, and
// the results, the thrown errors and the console must never hold them.

type Format = 'openai' | 'anthropic';
type Kind = 'models' | 'chat' | 'step1' | 'step2';
type JsonObject = Record<string, unknown>;

interface Reply {
  body: string;
  status?: number;
  /** The request never answers; it ends only when its signal aborts. */
  hang?: boolean;
}
type Route = (kind: Kind, index: number) => Reply;

const FIXTURES = fileURLToPath(new URL('../fixtures/probes/', import.meta.url));
const FILE_FOR: Record<Kind, string> = {
  models: 'models.json',
  chat: 'chat.sse',
  step1: 'tool-turn1.sse',
  step2: 'tool-turn2.sse',
};
const MODEL: Record<Format, string> = {
  openai: 'qwen3.8-flash-next-nothink',
  anthropic: 'claude-haiku-5-5',
};
/** The fields that may hold the context window, in the order the adapter reads them. */
const WINDOW_FIELDS: Record<Format, readonly string[]> = {
  openai: ['max_model_len', 'context_length', 'context_window'],
  anthropic: ['max_input_tokens', 'max_model_len', 'context_length', 'context_window'],
};

const SENTINEL_KEY = 'SENTINEL-KEY-probe-fixtures-7720';
const SENTINEL_HEADER = 'SENTINEL-HEADER-probe-fixtures-7721';
const BASE_URL = 'http://probe-gateway.test';
const ADDRESS_HOST = 'probe-gateway.test';

function fixture(format: Format, kind: Kind): string {
  return readFileSync(join(FIXTURES, format, FILE_FOR[kind]), 'utf8');
}

function defaultRoute(format: Format): Route {
  return (kind) => ({ body: fixture(format, kind) });
}

/**
 * Edits to a recorded stream. The text deltas and the argument deltas are each joined into one
 * string, edited, and written back, so an edit never depends on how the server split a token or a
 * JSON value across deltas (U2). toolName renames the lookup tool wherever the stream names it.
 */
interface StreamEdit {
  text?: (text: string) => string;
  args?: (args: string) => string;
  toolName?: string;
}

interface Slot {
  read: () => string;
  write: (value: string) => void;
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function fieldSlot(object: JsonObject, key: string): Slot {
  return {
    read: () => String(object[key] ?? ''),
    write: (value) => {
      object[key] = value;
    },
  };
}

/** The text and argument slots of one parsed event, in the wire format's shape. */
function slotsOf(format: Format, event: JsonObject): { text: Slot[]; args: Slot[] } {
  const text: Slot[] = [];
  const args: Slot[] = [];
  if (format === 'openai') {
    for (const choice of asArray(event['choices'])) {
      const delta = asObject(asObject(choice)?.['delta']);
      if (delta && typeof delta['content'] === 'string') {
        text.push(fieldSlot(delta, 'content'));
      }
      for (const call of asArray(delta?.['tool_calls'])) {
        const fn = asObject(asObject(call)?.['function']);
        if (fn && typeof fn['arguments'] === 'string') {
          args.push(fieldSlot(fn, 'arguments'));
        }
      }
    }
  } else if (event['type'] === 'content_block_delta') {
    const delta = asObject(event['delta']);
    if (delta && delta['type'] === 'text_delta' && typeof delta['text'] === 'string') {
      text.push(fieldSlot(delta, 'text'));
    }
    if (
      delta &&
      delta['type'] === 'input_json_delta' &&
      typeof delta['partial_json'] === 'string'
    ) {
      args.push(fieldSlot(delta, 'partial_json'));
    }
  }
  return { text, args };
}

/** Joins the slots' values, edits the join, and writes it into the first slot; the rest are emptied. */
function collapse(slots: Slot[], edit: ((value: string) => string) | undefined): void {
  if (edit === undefined || slots.length === 0) {
    return;
  }
  const joined = edit(slots.map((slot) => slot.read()).join(''));
  slots.forEach((slot, index) => slot.write(index === 0 ? joined : ''));
}

/** Renames every string `name` field that equals lookup_code (the tool's name in the stream). */
function renameTool(value: unknown, to: string): void {
  if (Array.isArray(value)) {
    value.forEach((item) => renameTool(item, to));
    return;
  }
  const record = asObject(value);
  if (record === undefined) {
    return;
  }
  for (const key of Object.keys(record)) {
    if (key === 'name' && record[key] === 'lookup_code') {
      record[key] = to;
    } else {
      renameTool(record[key], to);
    }
  }
}

/** Returns the stream with the edit applied to its joined text, its joined arguments or its tool name. */
function rewriteStream(format: Format, body: string, edit: StreamEdit): string {
  const lines = body.split('\n');
  const events: Array<{ line: number; object: JsonObject }> = [];
  lines.forEach((raw, line) => {
    if (!raw.startsWith('data:')) {
      return;
    }
    const payload = raw.slice('data:'.length).trim();
    if (payload === '' || payload === '[DONE]') {
      return;
    }
    const object = asObject(JSON.parse(payload) as unknown);
    if (object) {
      events.push({ line, object });
    }
  });
  const text: Slot[] = [];
  const args: Slot[] = [];
  for (const { object } of events) {
    const slots = slotsOf(format, object);
    text.push(...slots.text);
    args.push(...slots.args);
  }
  collapse(text, edit.text);
  collapse(args, edit.args);
  if (edit.toolName !== undefined) {
    for (const { object } of events) {
      renameTool(object, edit.toolName);
    }
  }
  for (const { line, object } of events) {
    lines[line] = `data: ${JSON.stringify(object)}`;
  }
  return lines.join('\n');
}

/** The chat reply with the token replaced, so the probe finds no token. */
const noToken = (text: string): string => text.replace(/PROBE-OK/gi, 'NOPE-XX');

/** A fake fetch that answers each request by its kind and its index within the kind. */
function replayFetch(route: Route) {
  const counts: Record<Kind, number> = { models: 0, chat: 0, step1: 0, step2: 0 };
  const requests: Array<{ url: string; headers: Headers }> = [];
  const fake = (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? '{}')) as JsonObject;
    let kind: Kind;
    if (url.endsWith('/models')) {
      kind = 'models';
    } else if (!Array.isArray(body['tools']) || body['tools'].length === 0) {
      // The chat request has no tools field (U1); an empty list is also a chat request.
      kind = 'chat';
    } else if (JSON.stringify(body).includes(TOOL_RESULT)) {
      kind = 'step2';
    } else {
      kind = 'step1';
    }
    requests.push({ url, headers: new Headers(init?.headers) });
    const index = counts[kind];
    counts[kind] += 1;
    const reply = route(kind, index);
    if (reply.hang) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          {
            once: true,
          },
        );
      });
    }
    const contentType = kind === 'models' ? 'application/json' : 'text/event-stream';
    return Promise.resolve(
      new Response(reply.body, {
        status: reply.status ?? 200,
        headers: { 'content-type': contentType },
      }),
    );
  };
  return { fetch: fake as typeof globalThis.fetch, requests };
}

/** Builds the provider the way main does: the agentgateway preset, a header and the key. */
function providerFor(format: Format, fetchFn: typeof globalThis.fetch): Provider {
  const built = createProvider(
    {
      preset: 'agentgateway',
      format,
      baseURL: BASE_URL,
      headers: { 'X-Probe-Route': SENTINEL_HEADER },
    },
    SENTINEL_KEY,
    { maxRetries: 0, fetch: fetchFn },
  );
  if (!built.ok) {
    throw new Error('the factory refused the test config');
  }
  return built.provider;
}

/** Moves the clock by gapMs before each event the adapter yields, so timing is deterministic. */
function ticking(inner: Provider, clock: Clock, gapMs: number): Provider {
  return {
    listModels: (signal) => inner.listModels(signal),
    stream: (request, signal) =>
      (async function* () {
        for await (const event of inner.stream(request, signal)) {
          clock.t += gapMs;
          yield event;
        }
      })(),
  };
}

function expectedWindow(format: Format, entry: JsonObject): number | null {
  for (const field of WINDOW_FIELDS[format]) {
    const value = entry[field];
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
      return value;
    }
  }
  return null;
}

function recordedModels(format: Format): JsonObject[] {
  const parsed = JSON.parse(fixture(format, 'models')) as { data: JsonObject[] };
  return parsed.data;
}

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const;

describe.each<Format>(['openai', 'anthropic'])('probe fixtures, %s format', (format) => {
  const model = MODEL[format];
  let consoleSpies: Array<ReturnType<typeof vi.spyOn>> = [];

  beforeEach(() => {
    consoleSpies = CONSOLE_METHODS.map((name) => vi.spyOn(console, name));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Runs the probes for the model against a route, through the factory and the fake fetch. */
  async function probeWith(route: Route, options: Partial<ProbeOptions> = {}) {
    const clock = makeClock();
    const fake = replayFetch(route);
    const provider = providerFor(format, fake.fetch);
    const listing = await listServerModels(ticking(provider, clock, 100), {
      now: clock.now,
      timeoutMs: 5000,
    });
    const windowOf = listing.ok
      ? (listing.models.find((m) => m.id === model)?.contextWindow ?? null)
      : null;
    const result = await probeModel(ticking(provider, clock, 100), model, windowOf, {
      runs: 1,
      timeoutMs: 5000,
      now: clock.now,
      ...options,
    });
    return { listing, result, requests: fake.requests, provider, clock };
  }

  it('lists the recorded models, with the context window each one reports', async () => {
    const clock = makeClock();
    const provider = providerFor(format, replayFetch(defaultRoute(format)).fetch);
    const listing = await listServerModels(provider, { now: clock.now, timeoutMs: 5000 });
    const recorded = recordedModels(format);
    expect(listing.ok).toBe(true);
    if (!listing.ok) {
      return;
    }
    expect(listing.models.map((m) => m.id)).toEqual(recorded.map((m) => m['id']));
    expect(listing.models.map((m) => m.contextWindow)).toEqual(
      recorded.map((m) => expectedWindow(format, m)),
    );
    expect(listing.models.some((m) => m.id === model)).toBe(true);
  });

  it('passes both probes on the recorded streams, with the fake clock timing', async () => {
    const { listing, result, requests } = await probeWith(defaultRoute(format), { runs: 3 });
    expect(listing.ok).toBe(true);
    expect(result.model).toBe(model);
    expect(result.chat).toMatchObject({ status: 'passed', runs: 3, passes: 3, failures: [] });
    expect(result.toolUse).toMatchObject({ status: 'passed', runs: 3, passes: 3, failures: [] });
    // Each event arrives 100 ms after the last, so the first event is at 100 ms.
    expect(result.chat.latencyMs).toBe(100);
    expect(result.toolUse.latencyMs).toBe(100);
    expect(result.chat.tokensPerSecond).toBeGreaterThan(0);
    expect(result.toolUse.tokensPerSecond).toBeGreaterThan(0);
    expect(result.tokensPerSecond).toBeGreaterThan(0);
    // Three chat requests (no tools), then two tool requests per tool-use run.
    expect(requests.filter((r) => r.url.endsWith('/models'))).toHaveLength(1);
    expect(requests).toHaveLength(1 + 3 + 3 * 2);
  });

  it('gives unreliable when some chat runs lack the token', async () => {
    const chat = fixture(format, 'chat');
    const { result } = await probeWith(
      (kind, index) =>
        kind === 'chat' && index === 1
          ? { body: rewriteStream(format, chat, { text: noToken }) }
          : { body: fixture(format, kind) },
      { runs: 3 },
    );
    expect(result.chat).toMatchObject({ status: 'unreliable', runs: 3, passes: 2 });
    expect(result.chat.failures).toEqual(['missing-token']);
    expect(result.toolUse.status).toBe('passed');
  });

  it.each<{
    name: string;
    route: Route;
    probe: 'chat' | 'toolUse';
    failures: string[];
  }>([
    {
      name: 'a chat reply without the token',
      probe: 'chat',
      route: (kind) =>
        kind === 'chat'
          ? { body: rewriteStream(format, fixture(format, 'chat'), { text: noToken }) }
          : { body: fixture(format, kind) },
      failures: ['missing-token'],
    },
    {
      name: 'a text-only reply to the tool prompt',
      probe: 'toolUse',
      route: (kind) =>
        kind === 'step1' ? { body: fixture(format, 'chat') } : { body: fixture(format, kind) },
      failures: ['no-tool-call'],
    },
    {
      name: 'a call to another tool',
      probe: 'toolUse',
      route: (kind) =>
        kind === 'step1'
          ? { body: rewriteStream(format, fixture(format, 'step1'), { toolName: 'read_file' }) }
          : { body: fixture(format, kind) },
      failures: ['wrong-tool'],
    },
    {
      name: 'a call with another name',
      probe: 'toolUse',
      route: (kind) =>
        kind === 'step1'
          ? {
              body: rewriteStream(format, fixture(format, 'step1'), {
                args: (args) => args.replace(/harness/gi, 'other'),
              }),
            }
          : { body: fixture(format, kind) },
      failures: ['wrong-arguments'],
    },
    {
      name: 'a call whose arguments do not parse',
      probe: 'toolUse',
      route: (kind) =>
        kind === 'step1'
          ? {
              // Dropping the closing brace of the joined arguments leaves JSON that does not parse.
              body: rewriteStream(format, fixture(format, 'step1'), {
                args: (args) => args.replace(/\}\s*$/, ''),
              }),
            }
          : { body: fixture(format, kind) },
      failures: ['bad-arguments'],
    },
    {
      name: 'an answer without the code from the tool result',
      probe: 'toolUse',
      route: (kind) =>
        kind === 'step2'
          ? {
              body: rewriteStream(format, fixture(format, 'step2'), {
                text: (text) => text.replace(/ZEBRA-7341/gi, 'ZEBRA-0000'),
              }),
            }
          : { body: fixture(format, kind) },
      failures: ['missing-token'],
    },
    {
      name: 'a server error in step 2',
      probe: 'toolUse',
      route: (kind) =>
        kind === 'step2'
          ? { status: 500, body: JSON.stringify({ error: { message: SENTINEL_KEY } }) }
          : { body: fixture(format, kind) },
      failures: ['server'],
    },
    {
      name: 'a chat request that never answers',
      probe: 'chat',
      route: (kind) =>
        kind === 'chat' ? { body: '', hang: true } : { body: fixture(format, kind) },
      failures: ['timeout'],
    },
  ])('fails the probe with the right code for $name', async ({ route, probe, failures }) => {
    const { result } = await probeWith(route, { timeoutMs: 40 });
    expect(result[probe]).toMatchObject({ status: 'failed', failures });
  });

  it('gives a fixed status for the models listing failure and never shows the key', async () => {
    const clock = makeClock();
    const fake = replayFetch(() => ({
      status: 401,
      body: JSON.stringify({ error: { message: `${SENTINEL_KEY} is not accepted` } }),
    }));
    const provider = providerFor(format, fake.fetch);
    const listing = await listServerModels(provider, { now: clock.now, timeoutMs: 5000 });
    expect(listing).toEqual({ ok: false, latencyMs: 0, failure: 'auth' });
    const error = await caught(() => provider.listModels());
    expect(error).toBeInstanceOf(ProviderError);
    expect(String((error as Error).message)).not.toContain(SENTINEL_KEY);
  });

  it('sends the key and the header to the server, and keeps them out of every result', async () => {
    const { listing, result, requests } = await probeWith(
      (kind) =>
        kind === 'step2'
          ? { status: 500, body: JSON.stringify({ error: { message: SENTINEL_KEY } }) }
          : { body: fixture(format, kind) },
      { runs: 2 },
    );
    expect(requests[0]?.headers.get('x-probe-route')).toBe(SENTINEL_HEADER);
    expect(requests[0]?.headers.get('authorization')).toBe(`Bearer ${SENTINEL_KEY}`);

    const everything = JSON.stringify({ listing, result });
    expect(everything).not.toContain(SENTINEL_KEY);
    expect(everything).not.toContain(SENTINEL_HEADER);
    expect(everything).not.toContain(ADDRESS_HOST);
    for (const spy of consoleSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
