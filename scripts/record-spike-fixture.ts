// Records the spike's streaming fixtures from agentgateway (D24). Dev only: run it once per format
// by hand and commit the files it writes under tests/fixtures/spike/<format>/. It is never run in CI.
//
//   AGENTGATEWAY_BASE_URL=http://host:4100 AGENTGATEWAY_API_KEY=... pnpm record:spike
//   AGENTGATEWAY_BASE_URL=http://host:4100 AGENTGATEWAY_API_KEY=... pnpm record:spike anthropic
//   optional: AGENTGATEWAY_MODEL (default qwen3.8-flash-next-nothink for openai, claude-haiku-5-5 for anthropic)
//
// The format is the first argument: openai (default) or anthropic. AGENTGATEWAY_BASE_URL is the
// gateway root without /v1; the script adds the path for each format.
//
// It makes two streaming requests for one read_file round trip: the first asks for the tool, the
// second receives a fixed tool result and gives the final answer. It saves the two response bodies
// only. It never saves request headers, never prints the key, and refuses to write if the key
// string appears in either body.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

type Format = 'openai' | 'anthropic';

const FORMATS: readonly Format[] = ['openai', 'anthropic'];
const DEFAULT_MODELS: Record<Format, string> = {
  openai: 'qwen3.8-flash-next-nothink',
  anthropic: 'claude-haiku-5-5',
};
/**
 * The anthropic-version the installed @anthropic-ai/sdk sends by default (client.js, 1.10.0).
 * The recorder sends the same value, so the recorded fixtures match what the adapter sends. A unit
 * test checks that the SDK header still equals this constant (AC8). If the gateway or Anthropic
 * rejects this version, AC3's fallback (2023-06-01 through defaultHeaders) applies and is recorded.
 */
const ANTHROPIC_VERSION = '2026-10-21';
const MAX_TOKENS = 256;
const OUT_ROOT = fileURLToPath(new URL('../tests/fixtures/spike/', import.meta.url));
const TOOL_CALL_FILE = 'turn1-tool-call.sse';
const FINAL_FILE = 'turn2-final.sse';

const SYSTEM_PROMPT = 'You are a test agent. Use the tools you are given.';
const USER_PROMPT =
  'Read the file notes.txt with the read_file tool, then answer in one sentence what it says.';
/** The fixed result the recording sends back for read_file. */
const TOOL_OUTPUT = 'Spike note: the fixture was recorded from the gateway.';

const READ_FILE_DESCRIPTION = "Read a text file under the agent's root and return its text.";
const READ_FILE_SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Path of the file, relative to the root.' },
  },
  required: ['path'],
  additionalProperties: false,
};

type JsonObject = Record<string, unknown>;

interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

interface ToolCallAccumulator {
  id: string;
  name: string;
  arguments: string;
}

/** A refusal or a failed check. The message is safe to print: it never holds the key. */
class RecordError extends Error {}

function fail(message: string): never {
  throw new RecordError(message);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    fail(`${name} is not set`);
  }
  return value.trim();
}

function parseFormat(arg: string | undefined): Format {
  const format = arg === undefined || arg.trim() === '' ? 'openai' : arg.trim();
  if (!(FORMATS as readonly string[]).includes(format)) {
    fail('the format argument must be openai or anthropic');
  }
  return format as Format;
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function parseJsonObject(payload: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    fail('a stream line was not JSON; the response shape is not what the spike expects');
  }
  const object = asObject(parsed);
  if (!object) {
    fail('a stream chunk was not a JSON object');
  }
  return object;
}

/** The data payloads of an SSE body, in order. Skips empty lines and the [DONE] marker. */
function dataPayloads(body: string): string[] {
  const payloads: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith('data:')) {
      continue;
    }
    const payload = line.slice('data:'.length).trim();
    if (payload === '' || payload === '[DONE]') {
      continue;
    }
    payloads.push(payload);
  }
  return payloads;
}

// ---------- OpenAI-compatible format ----------

/** The deltas of choice 0, in order. */
function choiceDeltas(chunks: JsonObject[]): JsonObject[] {
  const deltas: JsonObject[] = [];
  for (const chunk of chunks) {
    const choices = chunk['choices'];
    const first = Array.isArray(choices) ? asObject(choices[0]) : undefined;
    const delta = asObject(first?.['delta']);
    if (delta) {
      deltas.push(delta);
    }
  }
  return deltas;
}

/** Joins the streamed tool call deltas. Requires exactly one call to read_file. */
function parseOpenAiToolCall(body: string): ToolCall {
  const chunks = dataPayloads(body).map(parseJsonObject);
  const calls = new Map<number, ToolCallAccumulator>();
  for (const delta of choiceDeltas(chunks)) {
    const toolCalls = delta['tool_calls'];
    if (!Array.isArray(toolCalls)) {
      continue;
    }
    for (const raw of toolCalls) {
      const call = asObject(raw);
      if (!call) {
        continue;
      }
      const index = typeof call['index'] === 'number' ? call['index'] : 0;
      const entry = calls.get(index) ?? { id: '', name: '', arguments: '' };
      if (typeof call['id'] === 'string' && call['id'] !== '') {
        entry.id = call['id'];
      }
      const fn = asObject(call['function']);
      if (typeof fn?.['name'] === 'string' && entry.name === '') {
        entry.name = fn['name'];
      }
      if (typeof fn?.['arguments'] === 'string') {
        entry.arguments += fn['arguments'];
      }
      calls.set(index, entry);
    }
  }
  return checkedToolCall(calls, 'openai');
}

/** Joins the text of the final OpenAI-format reply. Fails if it holds a tool call or no text. */
function parseOpenAiFinalText(body: string): string {
  const chunks = dataPayloads(body).map(parseJsonObject);
  let text = '';
  for (const delta of choiceDeltas(chunks)) {
    if (delta['tool_calls'] !== undefined) {
      fail('the final reply asked for another tool call; the recording needs a text answer');
    }
    if (typeof delta['content'] === 'string') {
      text += delta['content'];
    }
  }
  return checkedText(text);
}

// ---------- Anthropic Messages format ----------

interface SseEvent {
  type: string;
  data: JsonObject;
}

/** Parses the Anthropic stream. Each data payload carries its event name in `type`. */
function parseAnthropicEvents(body: string): SseEvent[] {
  return dataPayloads(body).map((payload) => {
    const data = parseJsonObject(payload);
    const type = data['type'];
    if (typeof type !== 'string') {
      fail(
        'an Anthropic stream event had no type; the response shape is not what the spike expects',
      );
    }
    return { type, data };
  });
}

/** Joins the streamed tool_use input for the one read_file call. Requires exactly one tool_use block. */
function parseAnthropicToolCall(body: string): ToolCall {
  const calls = new Map<number, ToolCallAccumulator>();
  for (const event of parseAnthropicEvents(body)) {
    if (event.type === 'error') {
      fail('the Anthropic stream reported an error; check the model and the gateway');
    }
    const index = typeof event.data['index'] === 'number' ? event.data['index'] : 0;
    if (event.type === 'content_block_start') {
      const block = asObject(event.data['content_block']);
      if (block?.['type'] === 'tool_use') {
        const entry = calls.get(index) ?? { id: '', name: '', arguments: '' };
        entry.id = typeof block['id'] === 'string' ? block['id'] : entry.id;
        entry.name = typeof block['name'] === 'string' ? block['name'] : entry.name;
        calls.set(index, entry);
      }
    } else if (event.type === 'content_block_delta') {
      const delta = asObject(event.data['delta']);
      if (delta?.['type'] === 'input_json_delta' && typeof delta['partial_json'] === 'string') {
        const entry = calls.get(index);
        if (entry) {
          entry.arguments += delta['partial_json'];
        }
      }
    }
  }
  return checkedToolCall(calls, 'anthropic');
}

/** Joins the text of the final Anthropic reply. Fails if it holds a tool_use block or no text. */
function parseAnthropicFinalText(body: string): string {
  let text = '';
  for (const event of parseAnthropicEvents(body)) {
    if (event.type === 'error') {
      fail('the Anthropic stream reported an error; check the model and the gateway');
    }
    if (event.type === 'content_block_start') {
      if (asObject(event.data['content_block'])?.['type'] === 'tool_use') {
        fail('the final reply asked for another tool call; the recording needs a text answer');
      }
    }
    if (event.type === 'content_block_delta') {
      const delta = asObject(event.data['delta']);
      if (delta?.['type'] === 'text_delta' && typeof delta['text'] === 'string') {
        text += delta['text'];
      }
    }
  }
  return checkedText(text);
}

// ---------- Shared checks ----------

/** Validates the single read_file call and returns it. */
function checkedToolCall(calls: Map<number, ToolCallAccumulator>, format: Format): ToolCall {
  if (calls.size !== 1) {
    fail(`expected the first reply to hold exactly one tool call, found ${calls.size}`);
  }
  const call = [...calls.values()][0];
  if (!call || call.name !== 'read_file') {
    fail('the first reply did not call read_file; check the model and the tool definition');
  }
  let args: unknown;
  try {
    args = JSON.parse(call.arguments);
  } catch {
    fail('the read_file arguments are not valid JSON');
  }
  if (typeof asObject(args)?.['path'] !== 'string') {
    fail('the read_file arguments do not hold a string path');
  }
  const fallbackId = format === 'anthropic' ? 'toolu_spike_1' : 'call_spike_1';
  return {
    id: call.id !== '' ? call.id : fallbackId,
    name: call.name,
    arguments: call.arguments,
  };
}

function checkedText(text: string): string {
  if (text.trim() === '') {
    fail('the final reply has no text');
  }
  return text;
}

// ---------- Requests ----------

function readFileToolOpenAi(): JsonObject {
  return {
    type: 'function',
    function: {
      name: 'read_file',
      description: READ_FILE_DESCRIPTION,
      parameters: READ_FILE_SCHEMA,
    },
  };
}

function readFileToolAnthropic(): JsonObject {
  return { name: 'read_file', description: READ_FILE_DESCRIPTION, input_schema: READ_FILE_SCHEMA };
}

/** The first request body: the user prompt, with the read_file tool offered. */
function firstBody(format: Format, model: string): JsonObject {
  if (format === 'anthropic') {
    return {
      model,
      max_tokens: MAX_TOKENS,
      stream: true,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: USER_PROMPT }],
      tools: [readFileToolAnthropic()],
    };
  }
  return {
    model,
    stream: true,
    stream_options: { include_usage: true },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: USER_PROMPT },
    ],
    tools: [readFileToolOpenAi()],
  };
}

/** The second request body: the assistant's tool call and the fixed tool result. */
function secondBody(format: Format, model: string, call: ToolCall): JsonObject {
  if (format === 'anthropic') {
    return {
      model,
      max_tokens: MAX_TOKENS,
      stream: true,
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: USER_PROMPT },
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: call.id, name: call.name, input: JSON.parse(call.arguments) },
          ],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: call.id, content: TOOL_OUTPUT }],
        },
      ],
      tools: [readFileToolAnthropic()],
    };
  }
  return {
    model,
    stream: true,
    stream_options: { include_usage: true },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: USER_PROMPT },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: call.arguments },
          },
        ],
      },
      { role: 'tool', tool_call_id: call.id, content: TOOL_OUTPUT },
    ],
    tools: [readFileToolOpenAi()],
  };
}

/** Names the request and its full URL, so the failing one is clear. Never includes the key. */
function hintFor(status: number, request: string, url: string): string {
  if (status === 404) {
    return `${request} ${url} returned HTTP 404. This request's path is wrong for the gateway: AGENTGATEWAY_BASE_URL must be the gateway root without /v1, because the script adds the path. Also check the gateway serves this format.`;
  }
  return `${request} ${url} returned HTTP ${status}. Check AGENTGATEWAY_BASE_URL and AGENTGATEWAY_API_KEY.`;
}

function requestHeaders(format: Format, key: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  if (format === 'anthropic') {
    headers['anthropic-version'] = ANTHROPIC_VERSION;
  }
  return headers;
}

async function postStream(
  format: Format,
  base: string,
  key: string,
  body: JsonObject,
): Promise<string> {
  const path = format === 'anthropic' ? '/v1/messages' : '/v1/chat/completions';
  const url = `${base}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: requestHeaders(format, key),
      body: JSON.stringify(body),
    });
  } catch (error) {
    fail(`could not reach ${base}: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
  if (!response.ok) {
    fail(hintFor(response.status, `POST (${format} stream)`, url));
  }
  return response.text();
}

async function checkModels(base: string, key: string, model: string): Promise<void> {
  const url = `${base}/v1/models`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
    });
  } catch (error) {
    fail(`could not reach ${url}: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
  if (!response.ok) {
    fail(hintFor(response.status, 'GET (models check)', url));
  }
  const listed = asObject(await response.json().catch(() => undefined))?.['data'];
  if (Array.isArray(listed)) {
    const ids = listed.map((item) => asObject(item)?.['id']);
    if (!ids.includes(model)) {
      console.warn(`warning: model ${model} is not in ${url}; the next call may fail`);
    }
  }
  console.log(`models check ok at ${url}`);
}

async function main(): Promise<void> {
  const format = parseFormat(process.argv[2]);
  const base = requireEnv('AGENTGATEWAY_BASE_URL').replace(/\/+$/, '');
  const key = requireEnv('AGENTGATEWAY_API_KEY');
  const model = process.env['AGENTGATEWAY_MODEL']?.trim() || DEFAULT_MODELS[format];
  console.log(`recording ${format} format with model ${model}`);

  if (format === 'openai') {
    await checkModels(base, key, model);
  }

  const firstReply = await postStream(format, base, key, firstBody(format, model));
  const call =
    format === 'anthropic' ? parseAnthropicToolCall(firstReply) : parseOpenAiToolCall(firstReply);
  console.log('turn 1: read_file tool call received');

  const finalReply = await postStream(format, base, key, secondBody(format, model, call));
  if (format === 'anthropic') {
    parseAnthropicFinalText(finalReply);
  } else {
    parseOpenAiFinalText(finalReply);
  }
  console.log('turn 2: final text received');

  // Refuse before writing anything if the key is in either body.
  if (firstReply.includes(key) || finalReply.includes(key)) {
    fail('refusing to write: the API key appears in a response body');
  }

  const outDir = join(OUT_ROOT, format);
  await mkdir(outDir, { recursive: true });
  const toolCallPath = join(outDir, TOOL_CALL_FILE);
  const finalPath = join(outDir, FINAL_FILE);
  await writeFile(toolCallPath, firstReply, 'utf8');
  await writeFile(finalPath, finalReply, 'utf8');
  console.log(`wrote ${toolCallPath}`);
  console.log(`wrote ${finalPath}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'unknown error';
  console.error(`record-spike-fixture: ${message}`);
  process.exitCode = 1;
});
