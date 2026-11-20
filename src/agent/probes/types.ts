// Result types for the model probes (p1-model-probes, AC4). They are plain, JSON-safe data: no
// class instances, functions or Date objects, and no free text from a server, a header, the address
// or the key. Phase 8 sends these shapes over the protocol unchanged, so keep them plain.

import type { ModelInfo, ProviderErrorKind } from '../provider/types';

export type ProbeStatus = 'passed' | 'unreliable' | 'failed';

/** Why one run failed. Each value is a fixed code, never a message from a server (AC4, AC8). */
export type ProbeFailure =
  | 'missing-token'
  | 'no-tool-call'
  | 'wrong-tool'
  | 'bad-arguments'
  | 'wrong-arguments'
  | 'timeout'
  | ProviderErrorKind;

/** The result of one probe (chat or tool use) over its runs. */
export interface ProbeResult {
  status: ProbeStatus;
  runs: number;
  passes: number;
  /** Median time to the first stream event, in whole ms. Null when no run got an event. */
  latencyMs: number | null;
  /** Median output speed, in tokens per second to one decimal. Indicative only (D28). */
  tokensPerSecond: number | null;
  /** One entry per failed run, in run order. */
  failures: ProbeFailure[];
}

/** Both probes for one model, with the context window the listing reported. */
export interface ModelProbeResult {
  model: string;
  contextWindow: number | null;
  chat: ProbeResult;
  toolUse: ProbeResult;
  /** Median over the run speeds of both probes, to one decimal. */
  tokensPerSecond: number | null;
}

/** The outcome of one `/models` listing: the round trip time, and the models or a failure kind. */
export type ServerListing =
  | { ok: true; latencyMs: number; models: ModelInfo[] }
  | { ok: false; latencyMs: number; failure: ProviderErrorKind | 'timeout' };
