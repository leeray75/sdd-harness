// Records the model probes' fixtures from agentgateway (p1-model-probes, AC9). Dev only: run it once
// per format by hand and commit the files it writes under tests/fixtures/probes/<format>/. It is
// never run in CI.
//
//   AGENTGATEWAY_BASE_URL=http://host:4100 AGENTGATEWAY_API_KEY=... pnpm record:probes
//   AGENTGATEWAY_BASE_URL=http://host:4100 AGENTGATEWAY_API_KEY=... pnpm record:probes anthropic
//   optional: AGENTGATEWAY_MODEL (default qwen3.8-flash-next-nothink for openai, claude-haiku-5-5 for anthropic)
//
// The format is the first argument: openai (default) or anthropic. AGENTGATEWAY_BASE_URL is the
// gateway root without /v1; the script adds the path for each format.
//
// It writes four files: models.json (the /models body), chat.sse (the chat probe's stream),
// tool-turn1.sse and tool-turn2.sse (the tool-use probe's two streams). The prompts, the tool and
// the tokens come from the probe modules, so the fixtures match what the probes send. Each reply is
// checked with the probe's own rules before anything is written: a recording the probes would fail
// is refused. The script saves response bodies only, never request headers, never prints the key,
// and refuses to write if the key string appears in any body.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAT_PROMPT, PROBE_TOKEN } from '../src/agent/probes/chat';
import {
  checkLookupCall,
  LOOKUP_TOOL,
  TOOL_CODE,
  TOOL_PROMPT,
  TOOL_RESULT,
} from '../src/agent/probes/tool-use';

type Format = 'openai' | 'anthropic';
type JsonObject = Record<string, unknown>;

const FORMATS: readonly Format[] = ['openai', 'anthropic'];
const DEFAULT_MODELS: Record<Format, string> = {
  openai: 'qwen3.8-flash-next-nothink',
  anthropic: 'claude-haiku-5-5',
};
/**
 * The anthropic-version the installed @anthropic-ai/sdk sends by default (1.10.0). The recorder
 * sends the same value, so the recorded fixtures match what the adapter sends.
 */
const ANTHROPIC_VERSION = '2026-10-21';
/** The probe's default reply limit (runner default maxTokens). */
const MAX_TOKENS = 256;
const OUT_ROOT = fileURLToPath(new URL('../tests/fixtures/probes/', import.meta.url));

/** A tool call read from a stream. */
interface Call {
  id: string;
  name: string;
  arguments: string;
}

/** The text and tool calls of one streamed reply. */
interface Reply {
  text: string;
  calls: Call[];
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

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseJson(payload: string): unknown {
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return fail('a response line is not JSON; the gateway did not return an event stream');
  }
}

/** The JSON payloads of the data lines, without the [DONE] marker. */
function dataPayloads(body: string): string[] {
  return body
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim())
    .filter((payload) => payload !== '' && payload !== '[DONE]');
}

/** Reads the text and the tool calls of an OpenAI-format stream, merging deltas by index. */
function parseOpenAiReply(body: string): Reply {
  let text = '';
  const slots = new Map<number, Call>();
  for (const payload of dataPayloads(body)) {
    const chunk = asObject(parseJson(payload));
    for (const choice of arrayOf(chunk?.['choices'])) {
      const delta = asObject(asObject(choice)?.['delta']);
      const content = delta?.['content'];
      if (typeof content === 'string') {
        text += content;
      }
      for (const item of arrayOf(delta?.['tool_calls'])) {
        const toolCall = asObject(item);
        const index = typeof toolCall?.['index'] === 'number' ? toolCall['index'] : slots.size;
        const slot = slots.get(index) ?? { id: '', name: '', arguments: '' };
        slots.set(index, slot);
        const id = toolCall?.['id'];
        if (typeof id === 'string' && slot.id === '') {
          slot.id = id;
        }
        const fn = asObject(toolCall?.['function']);
        const name = fn?.['name'];
        if (typeof name === 'string' && slot.name === '') {
          slot.name = name;
        }
        const args = fn?.['arguments'];
        if (typeof args === 'string') {
          slot.arguments += args;
        }
      }
    }
  }
  return { text, calls: [...slots.values()] };
}

/** Reads the text and the tool_use blocks of an Anthropic-format stream. */
function parseAnthropicReply(body: string): Reply {
  let text = '';
  const blocks = new Map<number, Call>();
  for (const payload of dataPayloads(body)) {
    const event = asObject(parseJson(payload));
    const index = typeof event?.['index'] === 'number' ? event['index'] : -1;
    if (event?.['type'] === 'content_block_start') {
      const block = asObject(event['content_block']);
      if (block?.['type'] === 'tool_use') {
        blocks.set(index, {
          id: String(block['id'] ?? ''),
          name: String(block['name'] ?? ''),
          arguments: '',
        });
      }
    } else if (event?.['type'] === 'content_block_delta') {
      const delta = asObject(event['delta']);
      if (delta?.['type'] === 'text_delta' && typeof delta['text'] === 'string') {
        text += delta['text'];
      } else if (delta?.['type'] === 'input_json_delta') {
        const partial = delta['partial_json'];
        const call = blocks.get(index);
        if (call && typeof partial === 'string') {
          call.arguments += partial;
        }
      }
    }
  }
  // The adapter sends an empty tool input as {} (anthropic.ts), so the check sees the same text.
  const calls = [...blocks.values()].map((call) => ({
    ...call,
    arguments: call.arguments === '' ? '{}' : call.arguments,
  }));
  return { text, calls };
}

/** The probe's own chat check: the token must appear in the text, case-insensitively. */
function checkChatReply(reply: Reply): void {
  if (!reply.text.toLowerCase().includes(PROBE_TOKEN.toLowerCase())) {
    fail(`the chat reply does not contain ${PROBE_TOKEN}; the probe would fail this recording`);
  }
}

/** The probe's own step-1 check on the first call. */
function checkToolCallReply(reply: Reply): Call {
  const call = reply.calls[0];
  if (call === undefined) {
    fail('the tool reply has no tool call; the probe would fail this recording (no-tool-call)');
  }
  const failure = checkLookupCall(call);
  if (failure !== null) {
    fail(`the tool call fails the probe check (${failure}); the probe would fail this recording`);
  }
  return call;
}

/** The probe's own step-2 check: the code from the tool result must appear in the answer. */
function checkFinalReply(reply: Reply): void {
  if (!reply.text.toLowerCase().includes(TOOL_CODE.toLowerCase())) {
    fail(`the final reply does not contain ${TOOL_CODE}; the probe would fail this recording`);
  }
}

/** The lookup tool in the OpenAI wire shape. */
function toolOpenAi(): JsonObject {
  return {
    type: 'function',
    function: {
      name: LOOKUP_TOOL.name,
      description: LOOKUP_TOOL.description,
      parameters: LOOKUP_TOOL.parameters,
    },
  };
}

/** The lookup tool in the Anthropic wire shape. */
function toolAnthropic(): JsonObject {
  return {
    name: LOOKUP_TOOL.name,
    description: LOOKUP_TOOL.description,
    input_schema: LOOKUP_TOOL.parameters,
  };
}

/** Parses a tool call's JSON text into the object tool_use wants, as the adapter does. */
function toolInput(json: string): JsonObject {
  const parsed = asObject(parseJson(json));
  return parsed ?? {};
}

/** The chat request: no tools field, as the adapters send it when the list is empty (U1). */
function chatBody(format: Format, model: string): JsonObject {
  if (format === 'anthropic') {
    return {
      model,
      max_tokens: MAX_TOKENS,
      stream: true,
      messages: [{ role: 'user', content: CHAT_PROMPT }],
    };
  }
  return {
    model,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: CHAT_PROMPT }],
  };
}

function firstToolBody(format: Format, model: string): JsonObject {
  if (format === 'anthropic') {
    return {
      model,
      max_tokens: MAX_TOKENS,
      stream: true,
      messages: [{ role: 'user', content: TOOL_PROMPT }],
      tools: [toolAnthropic()],
    };
  }
  return {
    model,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: TOOL_PROMPT }],
    tools: [toolOpenAi()],
  };
}

/** The step-2 body: the assistant's text and call, then the fixed tool result (as the probe sends). */
function secondToolBody(format: Format, model: string, reply: Reply, call: Call): JsonObject {
  if (format === 'anthropic') {
    const content: JsonObject[] = [];
    if (reply.text !== '') {
      content.push({ type: 'text', text: reply.text });
    }
    content.push({
      type: 'tool_use',
      id: call.id,
      name: call.name,
      input: toolInput(call.arguments),
    });
    return {
      model,
      max_tokens: MAX_TOKENS,
      stream: true,
      messages: [
        { role: 'user', content: TOOL_PROMPT },
        { role: 'assistant', content },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: call.id, content: TOOL_RESULT }],
        },
      ],
      tools: [toolAnthropic()],
    };
  }
  return {
    model,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: MAX_TOKENS,
    messages: [
      { role: 'user', content: TOOL_PROMPT },
      {
        role: 'assistant',
        content: reply.text === '' ? null : reply.text,
        tool_calls: [
          {
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: call.arguments },
          },
        ],
      },
      { role: 'tool', tool_call_id: call.id, content: TOOL_RESULT },
    ],
    tools: [toolOpenAi()],
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

/** POSTs a streaming request and returns the response body text. Headers are never saved. */
async function postStream(
  format: Format,
  base: string,
  key: string,
  body: JsonObject,
  request: string,
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
    fail(hintFor(response.status, `POST (${request})`, url));
  }
  return response.text();
}

/** GETs /v1/models in the format's headers and returns the body text. */
async function getModels(format: Format, base: string, key: string): Promise<string> {
  const url = `${base}/v1/models`;
  let response: Response;
  try {
    response = await fetch(url, { headers: requestHeaders(format, key) });
  } catch (error) {
    fail(`could not reach ${url}: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
  if (!response.ok) {
    fail(hintFor(response.status, 'GET (models)', url));
  }
  return response.text();
}

/** Warns when the recorded model is not in the listing. The recording still goes on. */
function warnIfModelMissing(listing: string, model: string): void {
  const data = arrayOf(asObject(parseJson(listing))?.['data']);
  const ids = data.map((item) => asObject(item)?.['id']);
  if (!ids.includes(model)) {
    console.warn(`warning: model ${model} is not in the /models listing; the next calls may fail`);
  }
}

async function main(): Promise<void> {
  const format = parseFormat(process.argv[2]);
  const base = requireEnv('AGENTGATEWAY_BASE_URL').replace(/\/+$/, '');
  const key = requireEnv('AGENTGATEWAY_API_KEY');
  const model = process.env['AGENTGATEWAY_MODEL']?.trim() || DEFAULT_MODELS[format];
  console.log(`recording probe fixtures: ${format} format with model ${model}`);

  const models = await getModels(format, base, key);
  warnIfModelMissing(models, model);
  console.log('models listing received');

  const chat = await postStream(format, base, key, chatBody(format, model), 'chat probe');
  checkChatReply(parseReply(format, chat));
  console.log('chat probe: reply with the token received');

  const firstTool = await postStream(
    format,
    base,
    key,
    firstToolBody(format, model),
    'tool probe, step 1',
  );
  const firstReply = parseReply(format, firstTool);
  const call = checkToolCallReply(firstReply);
  console.log('tool probe step 1: lookup_code call received');

  const finalTool = await postStream(
    format,
    base,
    key,
    secondToolBody(format, model, firstReply, call),
    'tool probe, step 2',
  );
  checkFinalReply(parseReply(format, finalTool));
  console.log('tool probe step 2: reply with the code received');

  // Refuse before writing anything if the key is in any body.
  if ([models, chat, firstTool, finalTool].some((body) => body.includes(key))) {
    fail('refusing to write: the API key appears in a response body');
  }

  const outDir = join(OUT_ROOT, format);
  await mkdir(outDir, { recursive: true });
  const files: Array<[string, string]> = [
    ['models.json', models],
    ['chat.sse', chat],
    ['tool-turn1.sse', firstTool],
    ['tool-turn2.sse', finalTool],
  ];
  for (const [name, text] of files) {
    const path = join(outDir, name);
    await writeFile(path, text, 'utf8');
    console.log(`wrote ${path}`);
  }
}

function parseReply(format: Format, body: string): Reply {
  return format === 'anthropic' ? parseAnthropicReply(body) : parseOpenAiReply(body);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'unknown error';
  console.error(`record-probe-fixtures: ${message}`);
  process.exitCode = 1;
});
