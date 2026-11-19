import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeError } from '../../src/agent/errors';
import { MAX_TURNS, runAgentLoop, type CallTool } from '../../src/agent/loop';
import { redactor, REDACTED } from '../../src/main/secrets/redact';

const FIXTURE_DIR = fileURLToPath(new URL('../fixtures/spike/', import.meta.url));
const TOOL_CALL_BODY = readFileSync(join(FIXTURE_DIR, 'turn1-tool-call.sse'), 'utf8');
const FINAL_BODY = readFileSync(join(FIXTURE_DIR, 'turn2-final.sse'), 'utf8');

const SENTINEL = 'SENTINEL-KEY-do-not-leak-8842';
const BASE_URL = 'http://gateway.test/v1';
const MODEL = 'qwen3.8-flash-next-nothink';
const PROMPT = 'Read notes.txt and tell me what it says.';

/** Builds a streamed reply from chunk payloads. */
function sse(payloads: unknown[]): string {
  return [...payloads.map((p) => `data: ${JSON.stringify(p)}`), 'data: [DONE]', ''].join('\n\n');
}

function toolCallBody(args: string): string {
  return sse([
    {
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_t',
                type: 'function',
                function: { name: 'read_file', arguments: '' },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args } }] } }],
    },
    { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
  ]);
}

function textBody(text: string): string {
  return sse([
    { choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] },
    { choices: [{ index: 0, delta: { content: text } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    { choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } },
  ]);
}

/** A fetch that returns the given bodies in order (the last one repeats). Records requests. */
function replayFetch(bodies: string[]) {
  const requests: { url: string; headers: Headers; body: string }[] = [];
  const fetchSpy = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body: String(init?.body ?? ''),
    });
    const text = bodies[Math.min(requests.length - 1, bodies.length - 1)] ?? '';
    return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  });
  return { fetchSpy, requests };
}

function makeClient(fetchFn: typeof fetch): OpenAI {
  return new OpenAI({ apiKey: SENTINEL, baseURL: BASE_URL, fetch: fetchFn, maxRetries: 0 });
}

function parsedBody(raw: string): { messages: { role: string; [key: string]: unknown }[] } {
  return JSON.parse(raw) as { messages: { role: string; [key: string]: unknown }[] };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runAgentLoop: fixture replay', () => {
  it('streams text, makes one read_file call, sends its result back, and returns the final text', async () => {
    const { fetchSpy, requests } = replayFetch([TOOL_CALL_BODY, FINAL_BODY]);
    const callTool = vi.fn<CallTool>(async () => ({
      ok: true,
      output: 'Spike note: the fixture was recorded from the gateway.',
    }));
    const chunks: string[] = [];

    const result = await runAgentLoop({
      client: makeClient(fetchSpy),
      model: MODEL,
      prompt: PROMPT,
      callTool,
      onText: (text) => chunks.push(text),
    });

    // Text streams in chunks, and the chunks join to the final text.
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(result.text);
    expect(result).toEqual({
      stopped: 'answered',
      turns: 2,
      text: 'The file says: "Spike note: the fixture was recorded from the gateway."',
    });

    // Exactly one read_file call reached the tool runner.
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith('read_file', { path: 'notes.txt' });

    // Two requests: the second carries the assistant tool call and the tool result.
    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toBe(`${BASE_URL}/chat/completions`);
    const first = JSON.parse(requests[0]?.body ?? '') as {
      stream: boolean;
      tools: { function: { name: string } }[];
    };
    expect(first.stream).toBe(true);
    expect(first.tools[0]?.function.name).toBe('read_file');

    const second = parsedBody(requests[1]?.body ?? '');
    const assistant = second.messages.find((m) => m.role === 'assistant');
    expect(assistant?.['tool_calls']).toEqual([
      {
        id: 'chatcmpl-tool-aee2b95659fb40c1',
        type: 'function',
        function: { name: 'read_file', arguments: '{"path": "notes.txt"}' },
      },
    ]);
    const tool = second.messages.find((m) => m.role === 'tool');
    expect(tool).toEqual({
      role: 'tool',
      tool_call_id: 'chatcmpl-tool-aee2b95659fb40c1',
      content: 'Spike note: the fixture was recorded from the gateway.',
    });
  });

  it('sends the key only in the Authorization header, never in the request body', async () => {
    const { fetchSpy, requests } = replayFetch([TOOL_CALL_BODY, FINAL_BODY]);
    await runAgentLoop({
      client: makeClient(fetchSpy),
      model: MODEL,
      prompt: PROMPT,
      callTool: async () => ({ ok: true, output: 'x' }),
      onText: () => undefined,
    });
    for (const request of requests) {
      expect(request.headers.get('authorization')).toBe(`Bearer ${SENTINEL}`);
      expect(request.body).not.toContain(SENTINEL);
    }
  });
});

describe('runAgentLoop: tolerant streams', () => {
  it('accepts chunks with extra vLLM fields and an empty choices array', async () => {
    // The recorded stream already carries prompt_token_ids, token_ids, logprobs and an
    // empty choices chunk; the replay test above covers that shape.
    const { fetchSpy } = replayFetch([TOOL_CALL_BODY, FINAL_BODY]);
    const result = await runAgentLoop({
      client: makeClient(fetchSpy),
      model: MODEL,
      prompt: PROMPT,
      callTool: async () => ({ ok: true, output: 'x' }),
      onText: () => undefined,
    });
    expect(result.stopped).toBe('answered');
  });

  it('sends unparseable arguments back to the model as a tool error, without calling the tool', async () => {
    const { fetchSpy, requests } = replayFetch([toolCallBody('{"path": '), textBody('Sorry.')]);
    const callTool = vi.fn<CallTool>(async () => ({ ok: true, output: 'never' }));

    const result = await runAgentLoop({
      client: makeClient(fetchSpy),
      model: MODEL,
      prompt: PROMPT,
      callTool,
      onText: () => undefined,
    });

    expect(callTool).not.toHaveBeenCalled();
    expect(result).toMatchObject({ stopped: 'answered', turns: 2, text: 'Sorry.' });
    const second = parsedBody(requests[1]?.body ?? '');
    const tool = second.messages.find((m) => m.role === 'tool');
    expect(String(tool?.['content'])).toMatch(/^tool error: /);
  });

  it('sends arguments that parse to a non-object back as a tool error', async () => {
    const { fetchSpy, requests } = replayFetch([toolCallBody('["notes.txt"]'), textBody('ok')]);
    const callTool = vi.fn<CallTool>(async () => ({ ok: true, output: 'never' }));
    await runAgentLoop({
      client: makeClient(fetchSpy),
      model: MODEL,
      prompt: PROMPT,
      callTool,
      onText: () => undefined,
    });
    expect(callTool).not.toHaveBeenCalled();
    const tool = parsedBody(requests[1]?.body ?? '').messages.find((m) => m.role === 'tool');
    expect(String(tool?.['content'])).toMatch(/^tool error: /);
  });

  it('passes a failed or denied tool result to the model as a tool error', async () => {
    const { fetchSpy, requests } = replayFetch([
      toolCallBody('{"path":"nope.txt"}'),
      textBody('ok'),
    ]);
    await runAgentLoop({
      client: makeClient(fetchSpy),
      model: MODEL,
      prompt: PROMPT,
      callTool: async () => ({ ok: false, reason: 'the file does not exist' }),
      onText: () => undefined,
    });
    const tool = parsedBody(requests[1]?.body ?? '').messages.find((m) => m.role === 'tool');
    expect(tool?.['content']).toBe('tool error: the file does not exist');
  });
});

describe('runAgentLoop: turn cap', () => {
  it('stops after MAX_TURNS model requests and does not run calls from the last reply', async () => {
    const { fetchSpy, requests } = replayFetch([toolCallBody('{"path":"a.txt"}')]);
    const callTool = vi.fn<CallTool>(async () => ({ ok: true, output: 'a' }));

    const result = await runAgentLoop({
      client: makeClient(fetchSpy),
      model: MODEL,
      prompt: PROMPT,
      callTool,
      onText: () => undefined,
    });

    expect(MAX_TURNS).toBe(4);
    expect(requests).toHaveLength(4);
    expect(callTool).toHaveBeenCalledTimes(3);
    expect(result.stopped).toBe('turn-limit');
    expect(result.turns).toBe(4);
  });
});

describe('runAgentLoop: nothing sensitive is written', () => {
  it('writes no key to stdout or stderr, and fixtures hold neither Authorization nor the key', async () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      out.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      out.push(String(chunk));
      return true;
    });
    const { fetchSpy } = replayFetch([TOOL_CALL_BODY, FINAL_BODY]);
    const texts: string[] = [];
    await runAgentLoop({
      client: makeClient(fetchSpy),
      model: MODEL,
      prompt: PROMPT,
      callTool: async () => ({ ok: true, output: 'Spike note' }),
      onText: (text) => texts.push(text),
    });

    expect(out.join('')).not.toContain(SENTINEL);
    expect(texts.join('')).not.toContain(SENTINEL);
    for (const body of [TOOL_CALL_BODY, FINAL_BODY]) {
      expect(body).not.toContain('Authorization');
      expect(body).not.toContain(SENTINEL);
    }
  });
});

describe('runAgentLoop: SDK errors with a sentinel key (AC11)', () => {
  /** Runs the loop and returns the error it throws, plus what the agent's error naming and main's redactor make of it. */
  async function failingRun(fetchFn: typeof fetch): Promise<{
    error: unknown;
    named: string;
    redacted: string;
  }> {
    redactor.register(SENTINEL);
    const callTool = vi.fn<CallTool>(async () => ({ ok: true, output: 'unused' }));
    let error: unknown;
    try {
      await runAgentLoop({
        client: makeClient(fetchFn),
        model: MODEL,
        prompt: PROMPT,
        callTool,
        onText: () => undefined,
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeDefined();
    const named = describeError(error);
    return { error, named, redacted: redactor.redact(named) };
  }

  it('a 401 whose body and Authorization header echo the sentinel leaks nothing through naming or redaction', async () => {
    const echoBody = JSON.stringify({
      error: { message: `invalid key ${SENTINEL}; got Bearer ${SENTINEL}` },
    });
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const sent = new Headers(init?.headers).get('authorization') ?? '';
      expect(sent).toContain(SENTINEL);
      return new Response(`${echoBody} ${sent}`, {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    });

    const { named, redacted } = await failingRun(fetchFn as unknown as typeof fetch);
    expect(named).toBe('HTTP 401');
    expect(named).not.toContain(SENTINEL);
    expect(redacted).not.toContain(SENTINEL);
    expect(redacted).toBe('HTTP 401');
  });

  it('a fetch that throws an Error with the sentinel in its message leaks nothing through naming or redaction', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error(`socket reset while sending ${SENTINEL}`);
    });

    const { named, redacted } = await failingRun(fetchFn as unknown as typeof fetch);
    expect(named).not.toContain(SENTINEL);
    expect(redacted).not.toContain(SENTINEL);
    expect(named.length).toBeGreaterThan(0);
  });

  it('redaction masks the sentinel in any text it is given, so a stray copy would not leak', () => {
    redactor.register(SENTINEL);
    expect(redactor.redact(`stray ${SENTINEL}`)).toBe(`stray ${REDACTED}`);
  });
});
