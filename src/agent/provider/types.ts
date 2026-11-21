// Provider-neutral types for the agent (D23, p1-provider-interface). The agent loop and the
// adapters share these shapes. Nothing here imports an SDK, so no SDK type crosses the
// interface: the adapters translate to and from their wire format on their own side.

/** A JSON Schema object, as the tool's parameters are described to the model. */
export type JsonSchema = Record<string, unknown>;

/** One complete tool call from the model. `arguments` is the JSON text the model wrote. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export type Message =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; toolCalls: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
}

/** Token counts for one model request. Cache counts appear only when the provider sends them. */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export type StopReason = 'end' | 'tool-use' | 'max-tokens' | 'other';

export type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; id: string; name: string; arguments: string }
  | ({ type: 'usage' } & Usage)
  | { type: 'done'; stopReason: StopReason };

export interface ProviderRequest {
  model: string;
  /**
   * The system prompt for the run (D32). When unset or empty, the adapters send nothing for it,
   * so the request is the same as before the field existed.
   */
  system?: string;
  messages: Message[];
  tools: ToolDefinition[];
  /** Upper bound on the reply's tokens. Adapters fall back to their own default when unset. */
  maxTokens?: number;
}

/** One model a server lists. `contextWindow` is null when the server does not report it (AC1). */
export interface ModelInfo {
  id: string;
  contextWindow: number | null;
}

export interface Provider {
  /** Streams one model reply as events. Failures are thrown as ProviderError. */
  stream(request: ProviderRequest, signal?: AbortSignal): AsyncIterable<StreamEvent>;
  /** Lists the server's models, every page. Failures are thrown as ProviderError (p1-model-probes). */
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>;
}

export type ProviderErrorKind =
  'auth' | 'rate-limit' | 'bad-request' | 'server' | 'network' | 'aborted' | 'unknown';

/**
 * A failure from a provider. The message is built only from the kind and the status, so it
 * never holds an SDK message, a header, a URL query or the key.
 */
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly status: number | undefined;
  readonly retryable: boolean;

  constructor(kind: ProviderErrorKind, status?: number) {
    super(
      status !== undefined ? `provider ${kind} error (HTTP ${status})` : `provider ${kind} error`,
    );
    this.name = 'ProviderError';
    this.kind = kind;
    this.status = status;
    this.retryable = kind === 'rate-limit' || kind === 'server' || kind === 'network';
  }
}
