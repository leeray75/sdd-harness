// The probe runner (p1-model-probes, AC7). It lists a server's models, and runs the chat probe and
// the tool-use probe for one model, one run after another. It works out each probe's status, the
// medians of latency and speed, and the list of failure codes. Timing uses an injected clock, so
// tests are deterministic. It never logs and never reads the environment.

import { ProviderError, type Provider } from '../provider/types';
import { runChatOnce, type RunAttempt } from './chat';
import { runToolUseOnce } from './tool-use';
import { throwIfCallerAborted, type RequestOutcome } from './stream';
import type { ModelProbeResult, ProbeFailure, ProbeResult, ServerListing } from './types';

export interface ProbeOptions {
  /** Runs per probe. Default 3; at least 1. */
  runs?: number;
  /** The timeout per request, in ms. Default 60000. */
  timeoutMs?: number;
  /** The reply's token limit. Default 256. */
  maxTokens?: number;
  /** The clock, in ms. Default performance.now. */
  now?: () => number;
  /** The caller's signal. Its abort stops the runner, which then throws ProviderError('aborted'). */
  signal?: AbortSignal;
}

const DEFAULT_RUNS = 3;
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MAX_TOKENS = 256;

interface ResolvedOptions {
  runs: number;
  timeoutMs: number;
  maxTokens: number;
  now: () => number;
  signal: AbortSignal | undefined;
}

function resolveOptions(options: ProbeOptions): ResolvedOptions {
  const runs = options.runs ?? DEFAULT_RUNS;
  if (!Number.isInteger(runs) || runs < 1) {
    throw new RangeError('runs must be a whole number of at least 1');
  }
  return {
    runs,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
    now: options.now ?? (() => performance.now()),
    signal: options.signal,
  };
}

/** The median of the values, or null when there are none. Even counts average the middle two. */
export function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] ?? null;
  }
  const low = sorted[mid - 1];
  const high = sorted[mid];
  return low === undefined || high === undefined ? null : (low + high) / 2;
}

/** The output speed of a run: total output tokens over total stream time (null per AC7). */
function runSpeed(requests: RequestOutcome[]): number | null {
  let tokens = 0;
  let streamMs = 0;
  for (const request of requests) {
    if (
      request.outputTokens === null ||
      request.firstEventAt === null ||
      request.lastEventAt === null
    ) {
      return null;
    }
    const span = request.lastEventAt - request.firstEventAt;
    if (span <= 0) {
      return null;
    }
    tokens += request.outputTokens;
    streamMs += span;
  }
  return streamMs > 0 ? (tokens / streamMs) * 1000 : null;
}

/** The timing and outcome of one run, before the medians. */
interface RunSummary {
  passed: boolean;
  failure: ProbeFailure | null;
  /** The first request's time to its first event, or null. */
  latencyMs: number | null;
  /** The run's speed, unrounded, or null. */
  speed: number | null;
}

function summarize(attempt: RunAttempt): RunSummary {
  const first = attempt.requests[0];
  const latencyMs =
    first !== undefined && first.firstEventAt !== null
      ? first.firstEventAt - first.startedAt
      : null;
  return {
    passed: attempt.passed,
    failure: attempt.failure,
    latencyMs,
    speed: runSpeed(attempt.requests),
  };
}

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Builds a ProbeResult from its run summaries: status, counts, medians and failure codes. */
function toProbeResult(runs: RunSummary[]): ProbeResult {
  const passes = runs.filter((run) => run.passed).length;
  let status: ProbeResult['status'];
  if (passes === runs.length) {
    status = 'passed';
  } else if (passes === 0) {
    status = 'failed';
  } else {
    status = 'unreliable';
  }
  const latency = median(runs.flatMap((run) => (run.latencyMs === null ? [] : [run.latencyMs])));
  const speed = median(runs.flatMap((run) => (run.speed === null ? [] : [run.speed])));
  return {
    status,
    runs: runs.length,
    passes,
    latencyMs: latency === null ? null : Math.round(latency),
    tokensPerSecond: speed === null ? null : roundOneDecimal(speed),
    failures: runs.flatMap((run) => (run.passed ? [] : [run.failure ?? 'unknown'])),
  };
}

/**
 * Lists the server's models and times the round trip. A ProviderError gives ok: false with its
 * kind; a timeout gives 'timeout'. A caller abort throws ProviderError('aborted') instead.
 */
export async function listServerModels(
  provider: Provider,
  options: ProbeOptions = {},
): Promise<ServerListing> {
  const resolved = resolveOptions(options);
  throwIfCallerAborted(resolved.signal);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, resolved.timeoutMs);
  const forwardAbort = (): void => controller.abort();
  resolved.signal?.addEventListener('abort', forwardAbort, { once: true });

  const started = resolved.now();
  try {
    const models = await provider.listModels(controller.signal);
    const latencyMs = Math.round(resolved.now() - started);
    throwIfCallerAborted(resolved.signal);
    return {
      ok: true,
      latencyMs,
      models: models.map((model) => ({ id: model.id, contextWindow: model.contextWindow })),
    };
  } catch (error) {
    throwIfCallerAborted(resolved.signal);
    const latencyMs = Math.round(resolved.now() - started);
    const failure = timedOut ? 'timeout' : error instanceof ProviderError ? error.kind : 'unknown';
    return { ok: false, latencyMs, failure };
  } finally {
    clearTimeout(timer);
    resolved.signal?.removeEventListener('abort', forwardAbort);
  }
}

/**
 * Runs the chat probe and then the tool-use probe, each `runs` times, one after another. The
 * context window is passed through from the listing. Its tokensPerSecond is the median over the run
 * speeds of both probes. A caller abort throws ProviderError('aborted') and no partial result.
 */
export async function probeModel(
  provider: Provider,
  model: string,
  contextWindow: number | null,
  options: ProbeOptions = {},
): Promise<ModelProbeResult> {
  const resolved = resolveOptions(options);
  const runOptions = {
    timeoutMs: resolved.timeoutMs,
    maxTokens: resolved.maxTokens,
    now: resolved.now,
    ...(resolved.signal ? { signal: resolved.signal } : {}),
  };

  const chatRuns: RunSummary[] = [];
  for (let index = 0; index < resolved.runs; index += 1) {
    chatRuns.push(summarize(await runChatOnce(provider, model, runOptions)));
  }
  const toolRuns: RunSummary[] = [];
  for (let index = 0; index < resolved.runs; index += 1) {
    toolRuns.push(summarize(await runToolUseOnce(provider, model, runOptions)));
  }

  const speeds = [...chatRuns, ...toolRuns].flatMap((run) =>
    run.speed === null ? [] : [run.speed],
  );
  const overall = median(speeds);
  return {
    model,
    contextWindow,
    chat: toProbeResult(chatRuns),
    toolUse: toProbeResult(toolRuns),
    tokensPerSecond: overall === null ? null : roundOneDecimal(overall),
  };
}
