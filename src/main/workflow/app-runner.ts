// The app's job runner factory (p3-headless-e2e, D39). It builds the in-process job runner of the
// build loop with the root's command context, read live for each call (D31, D36), and with every
// rule event logged (D30). Build jobs run in the main process for v1 (D39), so the build start must
// build its runner here: a runner built anywhere else would log no rule events. Nothing in index.ts
// calls this factory yet, because the build start is not in the app in this phase.

import type { Provider } from '../../agent/provider/types';
import { commandPolicyFor, contextFor, type LiveSupplier } from '../agent/host';
import type { Environment } from '../env/types';
import type { RuleLogger } from '../policy/rule-event';
import { logRuleEvent } from '../policy/rule-event';
import { createInProcessJobRunner, type JobRunner } from './job-runner';

export interface AppJobRunnerOptions {
  /** The project's environment (D41), from the registry. Every tool and command goes through it. */
  env: Environment;
  /** The project root. Tools work only inside it, and its markers give the command allowlist. */
  root: string;
  provider: Provider;
  model: string;
  /** The live feature and spec state, read again for each call (D36). */
  live: LiveSupplier;
  /** Receives every rule event, as its one-line form (D30). */
  log: RuleLogger;
  /** Overrides the turn caps. For tests only. */
  maxTurns?: number;
}

/**
 * Builds the job runner for one project root. Each call's policy context is the root's command
 * context with the live feature and spec state, and every decision, revert and network event goes
 * to `log` through logRuleEvent.
 */
export async function createAppJobRunner(options: AppJobRunnerOptions): Promise<JobRunner> {
  const { policyContext } = await commandPolicyFor(options.env, options.root);
  return createInProcessJobRunner({
    env: options.env,
    root: options.root,
    provider: options.provider,
    model: options.model,
    contextNow: () => contextFor(policyContext, options.live),
    onRuleEvent: logRuleEvent(options.log),
    maxTurns: options.maxTurns,
  });
}
