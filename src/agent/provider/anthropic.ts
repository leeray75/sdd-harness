// Anthropic Messages adapter (AC3, AC5). Streams POST /v1/messages through the Anthropic SDK and
// turns the raw stream events into the neutral stream events. The SDK types stay inside this file.
// The SDK adds /v1/messages itself, so the base URL is normalized to the root (no /v1, D27).

import Anthropic from '@anthropic-ai/sdk';
import { toProviderError } from './errors';
import {
  type Message,
  type ModelInfo,
  type Provider,
  type ProviderRequest,
  type StopReason,
  type StreamEvent,
  type ToolDefinition,
  type Usage,
} from './types';

/** Sent when no key is set, so the SDK can start. Servers that need no key ignore it. */
const NO_KEY_PLACEHOLDER = 'no-key-set';
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MAX_TOKENS = 1024;

export interface AnthropicProviderOptions {
  /**
   * The gateway root. A trailing /v1 is optional and is stripped (normalizeAnthropicBaseUrl),
   * because the SDK adds /v1/messages itself (D27).
   */
  baseURL: string;
  /**
   * The key, or null when none is set (the placeholder is sent as the Bearer token). The key is
   * sent as Authorization: Bearer, the only auth mode (D26): @anthropic-ai/sdk 1.10.0 sends
   * Bearer for apiKey too, so there is no x-api-key mode.
   */
  key: string | null;
  /** SDK retries for 429, 5xx and connection failures. Default 2. */
  maxRetries?: number;
  /** Extra headers sent on every request, as defaultHeaders. The factory validates them (D27). */
  headers?: Record<string, string>;
  /** Used when a request does not set maxTokens. Default 1024. */
  maxTokens?: number;
  /** Replaces the global fetch. Tests inject a fake here. */
  fetch?: typeof globalThis.fetch;
}

/**
 * Strips trailing slashes, then one trailing /v1, then trailing slashes again. The result is the
 * root the SDK adds /v1/messages to, so the root and root + /v1 give the same address (D27).
 */
export function normalizeAnthropicBaseUrl(baseURL: string): string {
  const root = baseURL.replace(/\/+$/, '');
  const withoutV1 = root.endsWith('/v1') ? root.slice(0, -'/v1'.length) : root;
  return withoutV1.replace(/\/+$/, '');
}

/** Builds the Anthropic provider. The key is held only inside the SDK client. */
export function createAnthropicProvider(options: AnthropicProviderOptions): Provider {
  // Both credential options are always passed (apiKey as null), so the SDK never reads
  // ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN. webhookKey is null for the same reason.
  // The SDK's anthropic-version default is kept (no defaultHeaders pin for it).
  const client = new Anthropic({
    baseURL: normalizeAnthropicBaseUrl(options.baseURL),
    // An empty key counts as no key, so the placeholder is sent as the Bearer token (AC4).
    authToken: options.key || NO_KEY_PLACEHOLDER,
    apiKey: null,
    webhookKey: null,
    maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
    ...(options.headers ? { defaultHeaders: options.headers } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return {
    stream: (request, signal) => streamMessages(client, request, signal, options.maxTokens),
    listModels: (signal) => listAnthropicModels(client, signal),
  };
}

/** The Anthropic field that holds a model's input limit (AC3). */
const ANTHROPIC_CONTEXT_FIELD = 'max_input_tokens';
/**
 * The OpenAI-shape fields, read when an entry carries no max_input_tokens. The spec's AC3 fallback
 * covers a gateway that answers /v1/models in the OpenAI list shape (D28 records what it returned).
 */
const FALLBACK_CONTEXT_FIELDS = ['max_model_len', 'context_length', 'context_window'] as const;

/** The value when it is a positive integer, else null. */
function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

/** The context window of one listed model: max_input_tokens, else the first fallback field. */
function anthropicContextWindow(entry: Record<string, unknown>): number | null {
  const direct = positiveInteger(entry[ANTHROPIC_CONTEXT_FIELD]);
  if (direct !== null) {
    return direct;
  }
  for (const field of FALLBACK_CONTEXT_FIELDS) {
    const value = positiveInteger(entry[field]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

/** GET /v1/models through the SDK, every page. Entries without a string id are skipped (AC3). */
async function listAnthropicModels(
  client: Anthropic,
  signal: AbortSignal | undefined,
): Promise<ModelInfo[]> {
  const models: ModelInfo[] = [];
  try {
    for await (const item of client.models.list(undefined, signal ? { signal } : undefined)) {
      if (typeof item !== 'object' || item === null) {
        continue;
      }
      const entry = item as unknown as Record<string, unknown>;
      const id = entry['id'];
      if (typeof id !== 'string') {
        continue;
      }
      models.push({ id, contextWindow: anthropicContextWindow(entry) });
    }
  } catch (error) {
    throw toProviderError(error);
  }
  return models;
}

type MessageParam = Anthropic.MessageParam;
type ContentBlockParam = Anthropic.ContentBlockParam;

/** Turns a tool call's JSON text into the object tool_use wants. Unparseable text becomes {}. */
function parseToolInput(json: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through: the model's bad arguments are already in the transcript as a tool error.
  }
  return {};
}

/**
 * Maps the neutral history to Anthropic messages. Assistant tool calls become tool_use blocks.
 * Consecutive tool results share one user message of tool_result blocks.
 */
function toAnthropicMessages(messages: Message[]): MessageParam[] {
  const out: MessageParam[] = [];
  let resultBlocks: ContentBlockParam[] | undefined;
  for (const message of messages) {
    if (message.role === 'tool') {
      const block: ContentBlockParam = {
        type: 'tool_result',
        tool_use_id: message.toolCallId,
        content: message.content,
      };
      if (resultBlocks) {
        resultBlocks.push(block);
      } else {
        resultBlocks = [block];
        out.push({ role: 'user', content: resultBlocks });
      }
      continue;
    }
    resultBlocks = undefined;
    if (message.role === 'user') {
      out.push({ role: 'user', content: message.text });
      continue;
    }
    const blocks: ContentBlockParam[] = [];
    if (message.text !== '') {
      blocks.push({ type: 'text', text: message.text });
    }
    for (const call of message.toolCalls) {
      blocks.push({
        type: 'tool_use',
        id: call.id,
        name: call.name,
        input: parseToolInput(call.arguments),
      });
    }
    out.push({ role: 'assistant', content: blocks });
  }
  return out;
}

function toAnthropicTool(tool: ToolDefinition): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as Anthropic.Tool.InputSchema,
  };
}

function toStopReason(reason: string | null | undefined): StopReason {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'end';
    case 'tool_use':
      return 'tool-use';
    case 'max_tokens':
      return 'max-tokens';
    default:
      return 'other';
  }
}

/** A tool_use block being streamed: its id and name, and its input JSON pieces so far. */
interface PendingToolUse {
  id: string;
  name: string;
  json: string;
}

async function* streamMessages(
  client: Anthropic,
  request: ProviderRequest,
  signal: AbortSignal | undefined,
  defaultMaxTokens: number | undefined,
): AsyncGenerator<StreamEvent> {
  const toolUses = new Map<number, PendingToolUse>();
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  let sawUsage = false;
  let stopReason: string | null | undefined;
  try {
    const stream = await client.messages.create(
      {
        model: request.model,
        max_tokens: request.maxTokens ?? defaultMaxTokens ?? DEFAULT_MAX_TOKENS,
        messages: toAnthropicMessages(request.messages),
        // No tools field when there are none, as in the openai adapter (p1-model-probes U1).
        ...(request.tools.length > 0 ? { tools: request.tools.map(toAnthropicTool) } : {}),
        stream: true,
      },
      signal ? { signal } : undefined,
    );
    for await (const event of stream) {
      switch (event.type) {
        case 'message_start': {
          sawUsage = true;
          const start = event.message.usage;
          usage.inputTokens = start.input_tokens;
          usage.outputTokens = start.output_tokens;
          if (typeof start.cache_read_input_tokens === 'number') {
            usage.cacheReadTokens = start.cache_read_input_tokens;
          }
          if (typeof start.cache_creation_input_tokens === 'number') {
            usage.cacheWriteTokens = start.cache_creation_input_tokens;
          }
          break;
        }
        case 'content_block_start': {
          const block = event.content_block;
          if (block.type === 'tool_use') {
            toolUses.set(event.index, { id: block.id, name: block.name, json: '' });
          }
          break;
        }
        case 'content_block_delta': {
          const delta = event.delta;
          if (delta.type === 'text_delta') {
            if (delta.text !== '') {
              yield { type: 'text', text: delta.text };
            }
          } else if (delta.type === 'input_json_delta') {
            const pending = toolUses.get(event.index);
            if (pending) {
              pending.json += delta.partial_json;
            }
          }
          break;
        }
        case 'content_block_stop': {
          const pending = toolUses.get(event.index);
          if (pending) {
            toolUses.delete(event.index);
            yield {
              type: 'tool-call',
              id: pending.id,
              name: pending.name,
              arguments: pending.json === '' ? '{}' : pending.json,
            };
          }
          break;
        }
        case 'message_delta': {
          sawUsage = true;
          stopReason = event.delta.stop_reason;
          // message_delta carries the running totals; the input and cache counts are sent only
          // when they changed, so a missing (null) count keeps the message_start value.
          const end = event.usage;
          usage.outputTokens = end.output_tokens;
          if (typeof end.input_tokens === 'number') {
            usage.inputTokens = end.input_tokens;
          }
          if (typeof end.cache_read_input_tokens === 'number') {
            usage.cacheReadTokens = end.cache_read_input_tokens;
          }
          if (typeof end.cache_creation_input_tokens === 'number') {
            usage.cacheWriteTokens = end.cache_creation_input_tokens;
          }
          break;
        }
        default:
          break;
      }
    }
  } catch (error) {
    throw toProviderError(error);
  }
  if (sawUsage) {
    yield { type: 'usage', ...usage };
  }
  yield { type: 'done', stopReason: toStopReason(stopReason) };
}
