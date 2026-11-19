// Records the spike's streaming fixture from agentgateway (D24). Dev only: run it once by hand
// and commit the two files it writes under tests/fixtures/spike/. It is never run in CI.
//
//   AGENTGATEWAY_BASE_URL=http://host:4100 AGENTGATEWAY_API_KEY=... pnpm record:spike
//   optional: AGENTGATEWAY_MODEL (default qwen3.8-flash-next-nothink)
//
// It makes two streaming chat completions for one read_file round trip: the first asks for
// the tool, the second receives a fixed tool result and gives the final answer. It saves the
// two response bodies only. It never saves request headers, never prints the key, and
// refuses to write if the key string appears in either body.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_MODEL = 'qwen3.8-flash-next-nothink';
const OUT_DIR = fileURLToPath(new URL('../tests/fixtures/spike/', import.meta.url));
const TOOL_CALL_FILE = 'turn1-tool-call.sse';
const FINAL_FILE = 'turn2-final.sse';

const SYSTEM_PROMPT = 'You are a test agent. Use the tools you are given.';
const USER_PROMPT =
  'Read the file notes.txt with the read_file tool, then answer in one sentence what it says.';
/** The fixed result the recording sends back for read_file. */
const TOOL_OUTPUT = 'Spike note: the fixture was recorded from the gateway.';

const READ_FILE_TOOL = {
  type: 'function',
  function: {
    name: 'read_file',
    description: "Read a text file under the agent's root and return its text.",
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path of the file, relative to the root.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
};

type JsonObject = Record<string, unknown>;

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

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

/** Splits an SSE body into its JSON chunks. Fails on a data line that is not JSON. */
function parseChunks(body: string): JsonObject[] {
  const chunks: JsonObject[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith('data:')) {
      continue;
    }
    const payload = line.slice('data:'.length).trim();
    if (payload === '' || payload === '[DONE]') {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      fail('a stream line was not JSON; the response shape is not what the spike expects');
    }
    const chunk = asObject(parsed);
    if (!chunk) {
      fail('a stream chunk was not a JSON object');
    }
    chunks.push(chunk);
  }
  return chunks;
}

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
function parseToolCall(body: string): { id: string; name: string; arguments: string } {
  const calls = new Map<number, ToolCallAccumulator>();
  for (const delta of choiceDeltas(parseChunks(body))) {
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
  return {
    id: call.id !== '' ? call.id : 'call_spike_1',
    name: call.name,
    arguments: call.arguments,
  };
}

/** Joins the text of the final reply. Fails if it holds a tool call or no text. */
function parseFinalText(body: string): string {
  let text = '';
  for (const delta of choiceDeltas(parseChunks(body))) {
    if (delta['tool_calls'] !== undefined) {
      fail('the final reply asked for another tool call; the recording needs a text answer');
    }
    if (typeof delta['content'] === 'string') {
      text += delta['content'];
    }
  }
  if (text.trim() === '') {
    fail('the final reply has no text');
  }
  return text;
}

/** Names the request (models or chat completions) and its full URL, so the failing one is clear. */
function hintFor(status: number, request: string, url: string): string {
  if (status === 404) {
    return `${request} ${url} returned HTTP 404. This request's path is wrong for the gateway: try adding /v1 to AGENTGATEWAY_BASE_URL, or removing it if it is already there. A passing models check does not prove the chat path.`;
  }
  return `${request} ${url} returned HTTP ${status}. Check AGENTGATEWAY_BASE_URL and AGENTGATEWAY_API_KEY.`;
}

async function postStream(base: string, key: string, body: JsonObject): Promise<string> {
  const url = `${base}/chat/completions`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    fail(`could not reach ${base}: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
  if (!response.ok) {
    fail(hintFor(response.status, 'POST (chat completions)', url));
  }
  return response.text();
}

async function checkModels(base: string, key: string, model: string): Promise<void> {
  const url = `${base}/models`;
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
      console.warn(`warning: model ${model} is not in ${base}/models; the next call may fail`);
    }
  }
  console.log(`models check ok at ${base}/models`);
}

async function main(): Promise<void> {
  const base = requireEnv('AGENTGATEWAY_BASE_URL').replace(/\/+$/, '');
  const key = requireEnv('AGENTGATEWAY_API_KEY');
  const model = process.env['AGENTGATEWAY_MODEL']?.trim() || DEFAULT_MODEL;

  await checkModels(base, key, model);

  const messages: JsonObject[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: USER_PROMPT },
  ];

  const firstBody = await postStream(base, key, {
    model,
    stream: true,
    messages,
    tools: [READ_FILE_TOOL],
  });
  const call = parseToolCall(firstBody);
  console.log('turn 1: read_file tool call received');

  const secondBody = await postStream(base, key, {
    model,
    stream: true,
    messages: [
      ...messages,
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
    tools: [READ_FILE_TOOL],
  });
  parseFinalText(secondBody);
  console.log('turn 2: final text received');

  // Refuse before writing anything if the key is in either body.
  if (firstBody.includes(key) || secondBody.includes(key)) {
    fail('refusing to write: the API key appears in a response body');
  }

  await mkdir(OUT_DIR, { recursive: true });
  const toolCallPath = join(OUT_DIR, TOOL_CALL_FILE);
  const finalPath = join(OUT_DIR, FINAL_FILE);
  await writeFile(toolCallPath, firstBody, 'utf8');
  await writeFile(finalPath, secondBody, 'utf8');
  console.log(`wrote ${toolCallPath}`);
  console.log(`wrote ${finalPath}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'unknown error';
  console.error(`record-spike-fixture: ${message}`);
  process.exitCode = 1;
});
