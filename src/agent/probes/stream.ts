// One timed streamed request for the probes (AC5, AC6, AC7). It runs a single provider.stream call
// with its own AbortSignal, which fires on the per-request timeout or on the caller's signal. It
// records the times of the first and last stream events, and the output tokens from the usage
// event, so the runner can work out latency and speed. It never logs and never reads the
// environment. A failure is kept as a code; only a caller abort is thrown (as ProviderError).

import {
  ProviderError,
  type Provider,
  type ProviderErrorKind,
  type ProviderRequest,
  type ToolCall,
} from '../provider/types';

export interface RequestOptions {
  /** The per-request timeout in ms. */
  timeoutMs: number;
  /** The clock, in ms. Tests inject a fake one. */
  now: () => number;
  /** The caller's signal. Its abort stops the request and is rethrown by the runner. */
  signal?: AbortSignal;
}

/** What one request produced, and the timing the runner needs. */
export interface RequestOutcome {
  text: string;
  toolCalls: ToolCall[];
  /** The request's failure code, or null when the stream finished. */
  failure: ProviderErrorKind | 'timeout' | null;
  /** The clock just before the request. */
  startedAt: number;
  /** The clock at the first stream event of any kind, or null when there was none. */
  firstEventAt: number | null;
  /** The clock at the last stream event, or null when there was none. */
  lastEventAt: number | null;
  /** Output tokens from the usage event, or null when the server sent no usage. */
  outputTokens: number | null;
}

/** Throws the caller-abort error when the caller's signal has fired. */
export function throwIfCallerAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new ProviderError('aborted');
  }
}

/**
 * Runs one request and returns its outcome. A timeout gives 'timeout'; any other failure gives its
 * ProviderError kind. Only a caller abort throws (ProviderError 'aborted'), so no partial result is
 * returned for it.
 */
export async function runRequest(
  provider: Provider,
  request: ProviderRequest,
  options: RequestOptions,
): Promise<RequestOutcome> {
  throwIfCallerAborted(options.signal);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);
  const forwardAbort = (): void => controller.abort();
  options.signal?.addEventListener('abort', forwardAbort, { once: true });

  const outcome: RequestOutcome = {
    text: '',
    toolCalls: [],
    failure: null,
    startedAt: options.now(),
    firstEventAt: null,
    lastEventAt: null,
    outputTokens: null,
  };
  try {
    for await (const event of provider.stream(request, controller.signal)) {
      const at = options.now();
      outcome.firstEventAt ??= at;
      outcome.lastEventAt = at;
      if (event.type === 'text') {
        outcome.text += event.text;
      } else if (event.type === 'tool-call') {
        outcome.toolCalls.push({ id: event.id, name: event.name, arguments: event.arguments });
      } else if (event.type === 'usage') {
        outcome.outputTokens = event.outputTokens;
      }
    }
  } catch (error) {
    if (options.signal?.aborted) {
      throw new ProviderError('aborted');
    }
    if (timedOut) {
      outcome.failure = 'timeout';
    } else {
      outcome.failure = error instanceof ProviderError ? error.kind : 'unknown';
    }
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', forwardAbort);
  }
  throwIfCallerAborted(options.signal);
  return outcome;
}
