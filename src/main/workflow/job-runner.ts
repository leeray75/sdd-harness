// The job runner of the build loop (p3-build-loop, D37). It runs one writer or reviewer request
// through the agent loop, with the job's own history, and checks every tool call in the main
// process before it runs (D4). The gate decides what may run, and the tool runner runs it inside
// the project root. The runner never runs git: the tool registry has no git tool, and run_command
// goes through the D31 allowlist. Its only model access is the injected provider.

import { describeError } from '../../agent/errors';
import { runAgentLoop, type CallTool } from '../../agent/loop';
import type { Message, Provider } from '../../agent/provider/types';
import { TURN_CAPS } from '../../shared/build-docs';
import { makeToolRunner } from '../agent/host';
import type { ToolRunner } from '../agent/router';
import type { PolicyContext } from '../policy/context';
import { checkToolCall } from '../policy/gate';
import type { RuleEvent } from '../policy/rule-event';

/** One request to a job: its task text and the job's history so far. */
export interface JobRunRequest {
  job: 'writer' | 'reviewer';
  task: string;
  history: Message[];
}

export type JobRunResult =
  | { ok: true; text: string; messages: Message[]; stopped: 'answered' }
  | { ok: false; reason: string };

/** Runs one request. It never throws: a failure comes back as `ok: false`. */
export type JobRunner = (request: JobRunRequest) => Promise<JobRunResult>;

export interface JobRunnerOptions {
  /** The project root. Tools work only inside it. */
  root: string;
  provider: Provider;
  model: string;
  /** The policy context for each call, read at the moment of the call. */
  contextNow: () => PolicyContext;
  /** Runs an allowed call. Unset means makeToolRunner for the root, with the context's command check. */
  toolRunner?: ToolRunner;
  /** Overrides the turn caps (TURN_CAPS). For tests only. */
  maxTurns?: number;
  /**
   * Receives every rule event: the gate's decision for each call, allowed or denied, and the revert
   * and network events of run_command (D30, D31). Unset means none are reported. A throw is caught.
   */
  onRuleEvent?: (event: RuleEvent) => void;
}

/** Builds the job runner for one project root and one provider. */
export function createInProcessJobRunner(options: JobRunnerOptions): JobRunner {
  // A throwing callback must not fail the run (p3-ship): the event is dropped instead.
  const emit = (event: RuleEvent): void => {
    try {
      options.onRuleEvent?.(event);
    } catch {
      // The log is best effort; the call's own outcome does not depend on it.
    }
  };
  const toolRunner =
    options.toolRunner ??
    makeToolRunner(options.root, {
      commandCheck: options.contextNow().commandCheck,
      onRuleEvent: emit,
    });
  return async (request) => {
    const callTool: CallTool = async (name, args) => {
      const decision = checkToolCall({ job: request.job, tool: name, args }, options.contextNow());
      emit(decision.event);
      if (!decision.allow) {
        return { ok: false, reason: decision.reason };
      }
      return toolRunner({ job: request.job, tool: name, args });
    };
    try {
      const result = await runAgentLoop({
        provider: options.provider,
        model: options.model,
        job: request.job,
        prompt: request.task,
        callTool,
        onText: () => undefined,
        maxTurns: options.maxTurns ?? TURN_CAPS[request.job],
        history: request.history,
      });
      if (result.stopped === 'turn-limit') {
        return { ok: false, reason: `the ${request.job} did not finish within its turn limit` };
      }
      return { ok: true, text: result.text, messages: result.messages, stopped: 'answered' };
    } catch (error) {
      return { ok: false, reason: describeError(error) };
    }
  };
}
