// OpenAI-compatible adapter (AC2, AC5). Streams chat completions through the openai SDK and
// turns the chunks into the neutral stream events. The SDK types stay inside this file. Tool
// call deltas are merged the way the spike always did: by index or id slots, a name in one chunk
// and arguments in later ones, chunks with no choices, and extra fields ignored.

import OpenAI from 'openai';
import { toProviderError } from './errors';
import {
  ProviderError,
  type Message,
  type ModelInfo,
  type Provider,
  type ProviderRequest,
  type StopReason,
  type StreamEvent,
  type ToolCall,
  type ToolDefinition,
  type Usage,
} from './types';

/** Sent when no key is set, so the SDK can start. Servers that need no key ignore it. */
const NO_KEY_PLACEHOLDER = 'no-key-set';
const DEFAULT_MAX_RETRIES = 2;

export interface OpenAIProviderOptions {
  /** The gateway root. A trailing /v1 is optional; /v1 is added when it is missing. */
  baseURL: string;
  /** The key, or null when none is set (the placeholder is sent). */
  key: string | null;
  /** Extra headers sent on every request, as defaultHeaders. The factory validates them (D27). */
  headers?: Record<string, string>;
  /** SDK retries for 429, 5xx and connection failures. Default 2. */
  maxRetries?: number;
  /** Replaces the global fetch. Tests inject a fake here. */
  fetch?: typeof globalThis.fetch;
}

/** Strips trailing slashes, then appends /v1 unless the URL already ends in /v1. */
export function normalizeOpenAIBaseUrl(baseURL: string): string {
  const trimmed = baseURL.replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

/** Builds the OpenAI-compatible provider. The key is held only inside the SDK client. */
export function createOpenAIProvider(options: OpenAIProviderOptions): Provider {
  const client = new OpenAI({
    baseURL: normalizeOpenAIBaseUrl(options.baseURL),
    // An empty key counts as no key, so the placeholder is sent (AC3).
    apiKey: options.key || NO_KEY_PLACEHOLDER,
    maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
    ...(options.headers ? { defaultHeaders: options.headers } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return {
    stream: (request, signal) => streamChat(client, request, signal),
    listModels: (signal) => listOpenAIModels(client, signal),
  };
}

/** The fields that may hold a model's context window, in the order they are read (AC2). */
const CONTEXT_FIELDS = ['max_model_len', 'context_length', 'context_window'] as const;

/** The value when it is a positive integer, else null. */
function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

/** The first positive integer among the context fields of one listed model, else null. */
function openAIContextWindow(entry: Record<string, unknown>): number | null {
  for (const field of CONTEXT_FIELDS) {
    const value = positiveInteger(entry[field]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

/** GET /v1/models through the SDK, every page. Entries without a string id are skipped (AC2). */
async function listOpenAIModels(
  client: OpenAI,
  signal: AbortSignal | undefined,
): Promise<ModelInfo[]> {
  const models: ModelInfo[] = [];
  try {
    for await (const item of client.models.list(signal ? { signal } : undefined)) {
      if (typeof item !== 'object' || item === null) {
        continue;
      }
      const entry = item as unknown as Record<string, unknown>;
      const id = entry['id'];
      if (typeof id !== 'string') {
        continue;
      }
      models.push({ id, contextWindow: openAIContextWindow(entry) });
    }
  } catch (error) {
    throw toProviderError(error);
  }
  return models;
}

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ToolCallDelta = {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
};

interface PendingCall {
  id: string;
  name: string;
  arguments: string;
}

function toOpenAIMessages(messages: Message[]): ChatMessage[] {
  return messages.map((message): ChatMessage => {
    switch (message.role) {
      case 'user':
        return { role: 'user', content: message.text };
      case 'assistant':
        return {
          role: 'assistant',
          content: message.text === '' ? null : message.text,
          ...(message.toolCalls.length > 0
            ? {
                tool_calls: message.toolCalls.map((call) => ({
                  id: call.id,
                  type: 'function' as const,
                  function: { name: call.name, arguments: call.arguments },
                })),
              }
            : {}),
        };
      case 'tool':
        return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
    }
  });
}

function toOpenAITool(tool: ToolDefinition): OpenAI.Chat.Completions.ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

/** Adds one streamed tool call delta to the calls of this reply, keyed by its slot. */
function mergeToolCallDelta(slots: Map<number, PendingCall>, delta: ToolCallDelta): void {
  let slot: number;
  if (typeof delta.index === 'number') {
    slot = delta.index;
  } else if (delta.id) {
    // A call that names an id but no index starts a new slot.
    slot = slots.size;
  } else {
    // Otherwise it continues the last call.
    slot = Math.max(slots.size - 1, 0);
  }
  const call = slots.get(slot) ?? { id: '', name: '', arguments: '' };
  slots.set(slot, call);
  if (delta.id && call.id === '') {
    call.id = delta.id;
  }
  if (delta.function?.name && call.name === '') {
    call.name = delta.function.name;
  }
  if (delta.function?.arguments) {
    call.arguments += delta.function.arguments;
  }
}

/** The finished calls, in slot order. A call with no id gets call_<slot>. */
function finishCalls(slots: Map<number, PendingCall>): ToolCall[] {
  return [...slots.entries()]
    .sort(([a], [b]) => a - b)
    .map(([slot, call]) => ({
      id: call.id !== '' ? call.id : `call_${slot}`,
      name: call.name,
      arguments: call.arguments,
    }));
}

function toUsage(usage: OpenAI.CompletionUsage): Usage {
  const result: Usage = {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
  };
  const cached = usage.prompt_tokens_details?.cached_tokens;
  if (typeof cached === 'number') {
    result.cacheReadTokens = cached;
  }
  return result;
}

function toStopReason(finish: string | null | undefined): StopReason {
  switch (finish) {
    case 'stop':
      return 'end';
    case 'tool_calls':
    case 'function_call':
      return 'tool-use';
    case 'length':
      return 'max-tokens';
    default:
      return 'other';
  }
}

async function* streamChat(
  client: OpenAI,
  request: ProviderRequest,
  signal: AbortSignal | undefined,
): AsyncGenerator<StreamEvent> {
  const slots = new Map<number, PendingCall>();
  let usage: Usage | undefined;
  let finish: string | null | undefined;
  try {
    const stream = await client.chat.completions.create(
      {
        model: request.model,
        // A system prompt leads the history as a system message. None is added when it is
        // unset or empty (D32).
        messages: [
          ...(request.system ? [{ role: 'system' as const, content: request.system }] : []),
          ...toOpenAIMessages(request.messages),
        ],
        // No tools field when there are none: vLLM rejects an empty list (HTTP 400), so the
        // chat probe must not send one (p1-model-probes U1).
        ...(request.tools.length > 0 ? { tools: request.tools.map(toOpenAITool) } : {}),
        stream: true,
        stream_options: { include_usage: true },
        ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
      },
      signal ? { signal } : undefined,
    );
    for await (const chunk of stream) {
      if (chunk.usage) {
        usage = toUsage(chunk.usage);
      }
      for (const choice of chunk.choices ?? []) {
        if (choice.finish_reason) {
          finish = choice.finish_reason;
        }
        const delta = choice.delta;
        if (typeof delta?.content === 'string' && delta.content !== '') {
          yield { type: 'text', text: delta.content };
        }
        for (const toolDelta of delta?.tool_calls ?? []) {
          mergeToolCallDelta(slots, toolDelta);
        }
      }
    }
  } catch (error) {
    if (error instanceof ProviderError) {
      throw error;
    }
    throw toProviderError(error);
  }
  for (const call of finishCalls(slots)) {
    yield { type: 'tool-call', id: call.id, name: call.name, arguments: call.arguments };
  }
  if (usage) {
    yield { type: 'usage', ...usage };
  }
  yield { type: 'done', stopReason: toStopReason(finish) };
}
