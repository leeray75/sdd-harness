// Test doubles for the probe tests (p1-model-probes). A fake provider plays scripted streams chosen
// by probe step, and a fake clock moves only when the script says so, so timing is deterministic.
// This file is a helper, not a test: vitest picks up only *.test.ts files.

import {
  ProviderError,
  type ModelInfo,
  type Provider,
  type ProviderRequest,
  type StreamEvent,
} from '../../src/agent/provider/types';

export interface Clock {
  t: number;
  now: () => number;
}

export function makeClock(): Clock {
  const clock: Clock = { t: 0, now: () => clock.t };
  return clock;
}

/** A stream script: events that arrive gapMs apart, an error, or a stream that never ends. */
export type Script =
  | { kind: 'events'; events: StreamEvent[]; gapMs: number }
  | { kind: 'throw'; error: unknown }
  | { kind: 'hang' };

export function events(list: StreamEvent[], gapMs = 100): Script {
  return { kind: 'events', events: list, gapMs };
}

export function throws(error: unknown): Script {
  return { kind: 'throw', error };
}

export const HANG: Script = { kind: 'hang' };

/** The scripts for each probe step. Each list is used in order and the last one repeats. */
export interface Plan {
  chat?: Script[];
  step1?: Script[];
  step2?: Script[];
}

/** The listing script: models after gapMs, an error, or a listing that never answers. */
export type ListScript =
  | { kind: 'models'; models: ModelInfo[]; gapMs: number }
  | { kind: 'throw'; error: unknown }
  | { kind: 'hang' };

export interface FakeProvider extends Provider {
  requests: ProviderRequest[];
}

const TEXT_OK = 'PROBE-OK';

/** The kind of request: chat (no tools), step 2 (a tool result is in the history), or step 1. */
function kindOf(request: ProviderRequest): keyof Plan {
  if (request.tools.length === 0) {
    return 'chat';
  }
  return request.messages.some((message) => message.role === 'tool') ? 'step2' : 'step1';
}

/** Moves the clock and yields each event, or plays the error or the hang. */
async function* play(
  clock: Clock,
  script: Script,
  signal: AbortSignal | undefined,
): AsyncGenerator<StreamEvent> {
  if (script.kind === 'throw') {
    throw script.error;
  }
  if (script.kind === 'hang') {
    await new Promise<never>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new ProviderError('aborted')), {
        once: true,
      });
    });
    return;
  }
  for (const event of script.events) {
    clock.t += script.gapMs;
    yield event;
  }
}

/** A provider whose streams follow the plan for each probe step, and whose listing follows listing. */
export function fakeProvider(
  clock: Clock,
  plan: Plan,
  listing: ListScript = { kind: 'models', models: [], gapMs: 0 },
): FakeProvider {
  const used: Record<keyof Plan, number> = { chat: 0, step1: 0, step2: 0 };
  const fake: FakeProvider = {
    requests: [],
    stream(request, signal) {
      fake.requests.push(structuredClone(request));
      const kind = kindOf(request);
      const scripts = plan[kind];
      if (scripts === undefined || scripts.length === 0) {
        throw new Error(`no script for ${kind}`);
      }
      const index = Math.min(used[kind], scripts.length - 1);
      used[kind] += 1;
      const script = scripts[index];
      if (script === undefined) {
        throw new Error(`no script for ${kind}`);
      }
      return play(clock, script, signal);
    },
    async listModels(signal) {
      if (listing.kind === 'throw') {
        throw listing.error;
      }
      if (listing.kind === 'hang') {
        await new Promise<never>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new ProviderError('aborted')), {
            once: true,
          });
        });
      }
      if (listing.kind === 'models') {
        clock.t += listing.gapMs;
        return listing.models;
      }
      return [];
    },
  };
  return fake;
}

/** A chat reply that passes: the token, then usage, then done. */
export function chatPass(gapMs = 100): Script {
  return events(
    [
      { type: 'text', text: TEXT_OK },
      { type: 'usage', inputTokens: 5, outputTokens: 10 },
      { type: 'done', stopReason: 'end' },
    ],
    gapMs,
  );
}

/** A reply to the chat prompt that lacks the token. */
export function chatMissing(gapMs = 100): Script {
  return events(
    [
      { type: 'text', text: 'Hello.' },
      { type: 'usage', inputTokens: 5, outputTokens: 10 },
      { type: 'done', stopReason: 'end' },
    ],
    gapMs,
  );
}

/** A step-1 reply that calls lookup_code with the expected name. */
export function lookupCall(gapMs = 100, args = '{"name":"harness"}'): Script {
  return events(
    [
      { type: 'tool-call', id: 'call_1', name: 'lookup_code', arguments: args },
      { type: 'usage', inputTokens: 5, outputTokens: 10 },
      { type: 'done', stopReason: 'tool-use' },
    ],
    gapMs,
  );
}

/** A step-2 reply that contains the code from the tool result. */
export function codeAnswer(gapMs = 100): Script {
  return events(
    [
      { type: 'text', text: 'The code is ZEBRA-7341.' },
      { type: 'usage', inputTokens: 5, outputTokens: 10 },
      { type: 'done', stopReason: 'end' },
    ],
    gapMs,
  );
}

/** Runs an async function and returns what it threw. Fails the test if it did not throw. */
export async function caught(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('expected the run to throw');
}
