// A scripted provider for the build-loop tests (p3-build-loop, D37). It replays canned turns, one
// per request, so the whole loop runs with no network. It picks the job from each request's system
// prompt (the writer or the reviewer prompt), records every request, and throws when a job has no
// turns left. It lives under tests/, so it is not in the app build.

import { JOB_PROMPTS } from '../../src/agent/jobs';
import type {
  Message,
  ModelInfo,
  Provider,
  ProviderRequest,
  StreamEvent,
  ToolDefinition,
} from '../../src/agent/provider/types';

/** The two jobs the build loop runs. */
export type ScriptedJob = 'writer' | 'reviewer';

/** One canned model reply: its text, then its tool calls, then done. */
export interface ScriptedTurn {
  text?: string;
  toolCalls?: { name: string; args: Record<string, unknown> }[];
}

/** One request the provider received: its job, messages and advertised tools. */
export interface ScriptedRequest {
  job: ScriptedJob;
  messages: Message[];
  tools: ToolDefinition[];
}

export interface ScriptedProvider extends Provider {
  /** Every request in order, with a copy of its messages and tools. */
  readonly requests: ScriptedRequest[];
}

function jobOf(system: string | undefined): ScriptedJob {
  if (system === JOB_PROMPTS.writer.system) {
    return 'writer';
  }
  if (system === JOB_PROMPTS.reviewer.system) {
    return 'reviewer';
  }
  throw new Error('script has no job for this system prompt');
}

async function* eventsOf(turn: ScriptedTurn): AsyncGenerator<StreamEvent> {
  if (turn.text !== undefined && turn.text !== '') {
    yield { type: 'text', text: turn.text };
  }
  const calls = turn.toolCalls ?? [];
  for (const [index, call] of calls.entries()) {
    yield {
      type: 'tool-call',
      id: `call_${index + 1}`,
      name: call.name,
      arguments: JSON.stringify(call.args),
    };
  }
  yield { type: 'done', stopReason: calls.length > 0 ? 'tool-use' : 'end' };
}

/** A provider that replays each job's script in order. Each job has its own turns. */
export function createScriptedProvider(
  script: Record<ScriptedJob, ScriptedTurn[]>,
): ScriptedProvider {
  const next: Record<ScriptedJob, number> = { writer: 0, reviewer: 0 };
  const requests: ScriptedRequest[] = [];
  return {
    requests,
    listModels(): Promise<ModelInfo[]> {
      return Promise.resolve([]);
    },
    stream(request: ProviderRequest): AsyncIterable<StreamEvent> {
      const job = jobOf(request.system);
      const turn = script[job][next[job]];
      if (turn === undefined) {
        throw new Error(`script exhausted for ${job}`);
      }
      next[job] += 1;
      requests.push({
        job,
        messages: structuredClone(request.messages),
        tools: structuredClone(request.tools),
      });
      return eventsOf(turn);
    },
  };
}
