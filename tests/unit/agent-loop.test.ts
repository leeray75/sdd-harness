import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeError } from '../../src/agent/errors';
import { JOB_PROMPTS, jobToolDefinitions } from '../../src/agent/jobs';
import { addUsage, MAX_TURNS, runAgentLoop, type CallTool } from '../../src/agent/loop';
import { createAnthropicProvider } from '../../src/agent/provider/anthropic';
import { createOpenAIProvider } from '../../src/agent/provider/openai';
import type { Provider, ProviderRequest, StreamEvent, Usage } from '../../src/agent/provider/types';
import { redactor, REDACTED } from '../../src/main/secrets/redact';
import { JOB_IDS } from '../../src/shared/agent-protocol';

const FIXTURES = fileURLToPath(new URL('../fixtures/spike/', import.meta.url));
const OPENAI_TOOL_CALL = readFileSync(join(FIXTURES, 'openai/turn1-tool-call.sse'), 'utf8');
const OPENAI_FINAL = readFileSync(join(FIXTURES, 'openai/turn2-final.sse'), 'utf8');
const ANTHROPIC_TOOL_CALL = readFileSync(join(FIXTURES, 'anthropic/turn1-tool-call.sse'), 'utf8');
const ANTHROPIC_FINAL = readFileSync(join(FIXTURES, 'anthropic/turn2-final.sse'), 'utf8');

const SENTINEL = 'SENTINEL-KEY-do-not-leak-8842';
const BASE_URL = 'http://gateway.test';
const MODEL = 'test-model';
const PROMPT = 'Read notes.txt and tell me what it says.';
const FINAL_TEXT_OPENAI =
  'The file notes.txt contains a single spike note stating that the fixture was recorded from the gateway.';
const FINAL_TEXT_ANTHROPIC = 'The file says that the fixture was recorded from the gateway.';
const SPIKE_NOTE = 'Spike note: the fixture was recorded from the gateway.';

/** A provider that replays scripted replies (the last one repeats) and records each request. */
function scriptedProvider(replies: StreamEvent[][]): {
  provider: Provider;
  requests: ProviderRequest[];
} {
  const requests: ProviderRequest[] = [];
  const provider: Provider = {
    listModels() {
      return Promise.resolve([]);
    },
    stream(request) {
      // The loop reuses its message array, so keep a copy of what each request held.
      requests.push(structuredClone(request));
      const events = replies[Math.min(requests.length - 1, replies.length - 1)] ?? [];
      return (async function* () {
        for (const event of events) {
          yield event;
        }
      })();
    },
  };
  return { provider, requests };
}

function toolReply(args: string, id = 'call_1', usage?: Usage): StreamEvent[] {
  return [
    ...(usage ? [{ type: 'usage' as const, ...usage }] : []),
    { type: 'tool-call', id, name: 'read_file', arguments: args },
    { type: 'done', stopReason: 'tool-use' },
  ];
}

function textReply(text: string, usage?: Usage): StreamEvent[] {
  return [
    { type: 'text', text },
    ...(usage ? [{ type: 'usage' as const, ...usage }] : []),
    { type: 'done', stopReason: 'end' },
  ];
}

/** A fetch that returns the given bodies in order (the last one repeats). Records requests. */
function replayFetch(bodies: string[]) {
  const requests: { url: string; headers: Headers; body: string }[] = [];
  const fetchFn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    requests.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body: String(init?.body ?? ''),
    });
    const text = bodies[Math.min(requests.length - 1, bodies.length - 1)] ?? '';
    return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  });
  return { fetchFn: fetchFn as unknown as typeof globalThis.fetch, requests };
}

const noopTool: CallTool = async () => ({ ok: true, output: 'x' });

async function run(
  provider: Provider,
  callTool: CallTool = noopTool,
  onText: (t: string) => void = () => undefined,
) {
  return runAgentLoop({ provider, model: MODEL, job: 'reader', prompt: PROMPT, callTool, onText });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runAgentLoop on a fake provider', () => {
  it('streams text, runs one call, sends its result back, and answers', async () => {
    const { provider, requests } = scriptedProvider([
      toolReply('{"path":"notes.txt"}', 'call_a'),
      textReply('It says a note.'),
    ]);
    const callTool = vi.fn<CallTool>(async () => ({ ok: true, output: SPIKE_NOTE }));
    const chunks: string[] = [];

    const result = await run(provider, callTool, (text) => chunks.push(text));

    expect(result).toMatchObject({ stopped: 'answered', turns: 2, text: 'It says a note.' });
    expect(chunks.join('')).toBe('It says a note.');
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith('read_file', { path: 'notes.txt' });
    expect(requests).toHaveLength(2);
    expect(requests[0]?.tools.map((t) => t.name)).toEqual([
      'read_file',
      'list_files',
      'search_text',
      'read_ticket',
    ]);
    expect(requests[0]?.system).toBe(JOB_PROMPTS.reader.system);
    expect(requests[1]?.messages).toEqual([
      { role: 'user', text: PROMPT },
      {
        role: 'assistant',
        text: '',
        toolCalls: [{ id: 'call_a', name: 'read_file', arguments: '{"path":"notes.txt"}' }],
      },
      { role: 'tool', toolCallId: 'call_a', content: SPIKE_NOTE },
    ]);
  });

  it('runs several tool calls of one reply in order', async () => {
    const { provider } = scriptedProvider([
      [
        { type: 'tool-call', id: 'c1', name: 'read_file', arguments: '{"path":"a"}' },
        { type: 'tool-call', id: 'c2', name: 'read_file', arguments: '{"path":"b"}' },
        { type: 'done', stopReason: 'tool-use' },
      ],
      textReply('done'),
    ]);
    const order: string[] = [];
    const callTool = vi.fn<CallTool>(async (_name, args) => {
      order.push(String(args['path']));
      return { ok: true, output: 'x' };
    });
    await run(provider, callTool);
    expect(order).toEqual(['a', 'b']);
  });

  it('sends unparseable arguments back as a tool error, without calling the tool', async () => {
    const { provider, requests } = scriptedProvider([toolReply('{"path": '), textReply('Sorry.')]);
    const callTool = vi.fn<CallTool>(async () => ({ ok: true, output: 'never' }));
    const result = await run(provider, callTool);
    expect(callTool).not.toHaveBeenCalled();
    expect(result).toMatchObject({ stopped: 'answered', turns: 2, text: 'Sorry.' });
    expect(requests[1]?.messages.at(-1)).toEqual({
      role: 'tool',
      toolCallId: 'call_1',
      content: 'tool error: the arguments were not valid JSON',
    });
  });

  it('sends arguments that parse to a non-object back as a tool error', async () => {
    const { provider, requests } = scriptedProvider([toolReply('["notes.txt"]'), textReply('ok')]);
    const callTool = vi.fn<CallTool>(async () => ({ ok: true, output: 'never' }));
    await run(provider, callTool);
    expect(callTool).not.toHaveBeenCalled();
    expect(requests[1]?.messages.at(-1)).toMatchObject({
      role: 'tool',
      content: 'tool error: the arguments must be a JSON object',
    });
  });

  it('passes a failed or denied tool result to the model as a tool error', async () => {
    const { provider, requests } = scriptedProvider([
      toolReply('{"path":"nope.txt"}'),
      textReply('ok'),
    ]);
    await run(provider, async () => ({ ok: false, reason: 'the file does not exist' }));
    expect(requests[1]?.messages.at(-1)).toMatchObject({
      role: 'tool',
      content: 'tool error: the file does not exist',
    });
  });

  it('turns a throwing callTool into a tool error, not a thrown error', async () => {
    const { provider, requests } = scriptedProvider([toolReply('{"path":"a"}'), textReply('ok')]);
    await run(provider, async () => {
      throw new Error('boom');
    });
    expect(requests[1]?.messages.at(-1)).toMatchObject({
      role: 'tool',
      content: 'tool error: the tool could not run',
    });
  });

  it('stops after MAX_TURNS model requests and does not run calls from the last reply', async () => {
    const { provider, requests } = scriptedProvider([toolReply('{"path":"a.txt"}')]);
    const callTool = vi.fn<CallTool>(async () => ({ ok: true, output: 'a' }));
    const result = await run(provider, callTool);
    expect(MAX_TURNS).toBe(4);
    expect(requests).toHaveLength(4);
    expect(callTool).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ stopped: 'turn-limit', turns: 4 });
  });
});

describe('runAgentLoop sends the job system prompt and tools (AC5, D32)', () => {
  it('sends each job its own system prompt and advertised tools on every request of the run', async () => {
    for (const job of JOB_IDS) {
      const { provider, requests } = scriptedProvider([
        toolReply('{"path":"a"}', 'c1'),
        textReply('ok'),
      ]);
      await runAgentLoop({
        provider,
        model: MODEL,
        job,
        prompt: PROMPT,
        callTool: async () => ({ ok: true, output: 'x' }),
        onText: () => undefined,
      });
      expect(requests).toHaveLength(2);
      for (const request of requests) {
        expect(request.system).toBe(JOB_PROMPTS[job].system);
        expect(request.tools).toEqual(jobToolDefinitions(job));
      }
    }
  });

  it('advertises the writer run_command and the reviewer no write tool', async () => {
    const writer = scriptedProvider([textReply('ok')]);
    await runAgentLoop({
      provider: writer.provider,
      model: MODEL,
      job: 'writer',
      prompt: PROMPT,
      callTool: noopTool,
      onText: () => undefined,
    });
    const reviewer = scriptedProvider([textReply('ok')]);
    await runAgentLoop({
      provider: reviewer.provider,
      model: MODEL,
      job: 'reviewer',
      prompt: PROMPT,
      callTool: noopTool,
      onText: () => undefined,
    });
    const writerNames = writer.requests[0]?.tools.map((tool) => tool.name) ?? [];
    const reviewerNames = reviewer.requests[0]?.tools.map((tool) => tool.name) ?? [];
    expect(writerNames).toContain('run_command');
    expect(reviewerNames).toContain('run_command');
    expect(reviewerNames).not.toContain('write_file');
    expect(reviewerNames).not.toContain('edit_file');
  });

  it('gives the run the job the caller names: a reviewer run is not sent the reader prompt', async () => {
    const { provider, requests } = scriptedProvider([textReply('ok')]);
    await runAgentLoop({
      provider,
      model: MODEL,
      job: 'reviewer',
      prompt: PROMPT,
      callTool: noopTool,
      onText: () => undefined,
    });
    expect(requests[0]?.system).not.toBe(JOB_PROMPTS.reader.system);
    expect(requests[0]?.system).toBe(JOB_PROMPTS.reviewer.system);
  });
});

describe('runAgentLoop usage (AC5)', () => {
  it('reports each turn usage and the run total', async () => {
    const { provider } = scriptedProvider([
      toolReply('{"path":"a"}', 'c1', { inputTokens: 10, outputTokens: 2 }),
      textReply('ok', { inputTokens: 20, outputTokens: 5, cacheReadTokens: 4 }),
    ]);
    const result = await run(provider);
    expect(result.usage).toEqual({
      perTurn: [
        { inputTokens: 10, outputTokens: 2 },
        { inputTokens: 20, outputTokens: 5, cacheReadTokens: 4 },
      ],
      total: { inputTokens: 30, outputTokens: 7, cacheReadTokens: 4 },
    });
  });

  it('reports null for a turn that sent no usage, and the total of the turns that did', async () => {
    const { provider } = scriptedProvider([
      toolReply('{"path":"a"}'),
      textReply('ok', { inputTokens: 3, outputTokens: 1 }),
    ]);
    const result = await run(provider);
    expect(result.usage).toEqual({
      perTurn: [null, { inputTokens: 3, outputTokens: 1 }],
      total: { inputTokens: 3, outputTokens: 1 },
    });
  });

  it('reports null totals when no turn sent usage', async () => {
    const { provider } = scriptedProvider([textReply('ok')]);
    const result = await run(provider);
    expect(result.usage).toEqual({ perTurn: [null], total: null });
  });

  it('adds cache counts to the total only when a turn sent them', () => {
    expect(addUsage(null, null)).toBeNull();
    expect(addUsage({ inputTokens: 1, outputTokens: 1 }, null)).toEqual({
      inputTokens: 1,
      outputTokens: 1,
    });
    expect(
      addUsage(
        { inputTokens: 1, outputTokens: 1 },
        { inputTokens: 2, outputTokens: 2, cacheWriteTokens: 5 },
      ),
    ).toEqual({ inputTokens: 3, outputTokens: 3, cacheWriteTokens: 5 });
  });
});

describe('runAgentLoop fixture replay per format (AC9)', () => {
  it('runs the openai adapter: one read_file call, answered, usage totals, bearer key only in the header', async () => {
    const { fetchFn, requests } = replayFetch([OPENAI_TOOL_CALL, OPENAI_FINAL]);
    const provider = createOpenAIProvider({
      baseURL: BASE_URL,
      key: SENTINEL,
      maxRetries: 0,
      fetch: fetchFn,
    });
    const callTool = vi.fn<CallTool>(async () => ({ ok: true, output: SPIKE_NOTE }));
    const chunks: string[] = [];

    const result = await runAgentLoop({
      provider,
      model: MODEL,
      job: 'reader',
      prompt: PROMPT,
      callTool,
      onText: (text) => chunks.push(text),
    });

    expect(result).toMatchObject({ stopped: 'answered', turns: 2, text: FINAL_TEXT_OPENAI });
    expect(chunks.join('')).toBe(FINAL_TEXT_OPENAI);
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith('read_file', { path: 'notes.txt' });
    expect(result.usage.total).toEqual({ inputTokens: 715, outputTokens: 46 });
    expect(requests[0]?.url).toBe(`${BASE_URL}/v1/chat/completions`);
    expect(requests[0]?.headers.get('authorization')).toBe(`Bearer ${SENTINEL}`);
    for (const request of requests) {
      expect(request.body).not.toContain(SENTINEL);
    }
    expect(requests[1]?.body).toContain('chatcmpl-tool-a469c41edb3231b8');
  });

  it('runs the anthropic adapter: one read_file call, answered, usage totals, bearer key only in the header', async () => {
    const { fetchFn, requests } = replayFetch([ANTHROPIC_TOOL_CALL, ANTHROPIC_FINAL]);
    const provider = createAnthropicProvider({
      baseURL: BASE_URL,
      key: SENTINEL,
      maxRetries: 0,
      fetch: fetchFn,
    });
    const callTool = vi.fn<CallTool>(async () => ({ ok: true, output: SPIKE_NOTE }));

    const result = await runAgentLoop({
      provider,
      model: MODEL,
      job: 'reader',
      prompt: PROMPT,
      callTool,
      onText: () => undefined,
    });

    expect(result).toMatchObject({ stopped: 'answered', turns: 2, text: FINAL_TEXT_ANTHROPIC });
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith('read_file', { path: 'notes.txt' });
    expect(result.usage.total).toEqual({
      inputTokens: 963,
      outputTokens: 71,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(requests[0]?.url).toBe(`${BASE_URL}/v1/messages`);
    expect(requests[0]?.headers.get('authorization')).toBe(`Bearer ${SENTINEL}`);
    for (const request of requests) {
      expect(request.body).not.toContain(SENTINEL);
    }
    // The second request carries the tool_use block and the tool_result.
    expect(requests[1]?.body).toContain('"type":"tool_use"');
    expect(requests[1]?.body).toContain('"type":"tool_result"');
  });
});

describe('runAgentLoop errors with a sentinel key (AC9, AC4)', () => {
  it('a 401 whose body and Authorization header echo the sentinel leaks nothing through naming or redaction', async () => {
    redactor.register(SENTINEL);
    const fetchFn = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const sent = new Headers(init?.headers).get('authorization') ?? '';
      expect(sent).toContain(SENTINEL);
      return new Response(`invalid key ${SENTINEL} ${sent}`, {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    });
    const provider = createAnthropicProvider({
      baseURL: BASE_URL,
      key: SENTINEL,
      maxRetries: 0,
      fetch: fetchFn as unknown as typeof globalThis.fetch,
    });

    let error: unknown;
    try {
      await run(provider);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeDefined();
    const named = describeError(error);
    expect(named).toBe('provider auth error (HTTP 401)');
    expect(named).not.toContain(SENTINEL);
    expect(redactor.redact(named)).toBe(named);
  });

  it('a fetch that throws an Error with the sentinel in its message leaks nothing through naming or redaction', async () => {
    redactor.register(SENTINEL);
    const fetchFn = vi.fn(async () => {
      throw new TypeError(`socket reset while sending ${SENTINEL}`);
    });
    const provider = createOpenAIProvider({
      baseURL: BASE_URL,
      key: SENTINEL,
      maxRetries: 0,
      fetch: fetchFn as unknown as typeof globalThis.fetch,
    });
    let error: unknown;
    try {
      await run(provider);
    } catch (caught) {
      error = caught;
    }
    const named = describeError(error);
    expect(named).not.toContain(SENTINEL);
    expect(redactor.redact(named)).not.toContain(SENTINEL);
    expect(named).toBe('provider network error');
  });

  it('redaction masks the sentinel in any text it is given, so a stray copy would not leak', () => {
    redactor.register(SENTINEL);
    expect(redactor.redact(`stray ${SENTINEL}`)).toBe(`stray ${REDACTED}`);
  });
});

describe('runAgentLoop output', () => {
  it('writes no key to stdout or stderr during a replayed run', async () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      out.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      out.push(String(chunk));
      return true;
    });
    const { fetchFn } = replayFetch([OPENAI_TOOL_CALL, OPENAI_FINAL]);
    const provider = createOpenAIProvider({
      baseURL: BASE_URL,
      key: SENTINEL,
      maxRetries: 0,
      fetch: fetchFn,
    });
    await run(provider, async () => ({ ok: true, output: 'Spike note' }));
    expect(out.join('')).not.toContain(SENTINEL);
  });
});
