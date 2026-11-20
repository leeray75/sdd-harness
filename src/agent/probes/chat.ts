// The chat probe (p1-model-probes, AC5). One run is one streamed request with no tools. The reply
// passes when its text contains the fixed token, case-insensitively. The prompt, the token and the
// request shape are exported, because the recorder (scripts/record-probe-fixtures.ts) uses them, so
// the recorded fixtures match what the probe sends.

import type { Provider } from '../provider/types';
import type { ProbeFailure } from './types';
import { runRequest, type RequestOptions, type RequestOutcome } from './stream';

/** The token the reply must contain. */
export const PROBE_TOKEN = 'PROBE-OK';
/** The fixed prompt. It asks for a reply that contains the token. */
export const CHAT_PROMPT = `Reply with the word ${PROBE_TOKEN} and nothing else.`;

/** The outcome of one probe run: whether it passed, why it failed, and its requests. */
export interface RunAttempt {
  passed: boolean;
  failure: ProbeFailure | null;
  requests: RequestOutcome[];
}

export interface ProbeRunOptions extends RequestOptions {
  /** The reply's token limit, sent as maxTokens. */
  maxTokens: number;
}

/** One chat probe run: a single request, no tools. */
export async function runChatOnce(
  provider: Provider,
  model: string,
  options: ProbeRunOptions,
): Promise<RunAttempt> {
  const outcome = await runRequest(
    provider,
    {
      model,
      messages: [{ role: 'user', text: CHAT_PROMPT }],
      tools: [],
      maxTokens: options.maxTokens,
    },
    options,
  );
  if (outcome.failure !== null) {
    return { passed: false, failure: outcome.failure, requests: [outcome] };
  }
  const passed = outcome.text.toLowerCase().includes(PROBE_TOKEN.toLowerCase());
  return { passed, failure: passed ? null : 'missing-token', requests: [outcome] };
}
