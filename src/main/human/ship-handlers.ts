// The two ship handlers of the human-only channel (p3-ship, D38): approve-result and mark-done. They
// run only through the channel's checks (D33, src/main/human/channel.ts), and they never throw: a
// refusal comes back with the ship module's fixed reason, and an unexpected error becomes a refusal
// too. The ship module (src/main/workflow/ship.ts) does the work and runs git only through
// src/main/git/git.ts. After each call the lock is refreshed, so the watcher re-reads the state.

import type { HumanActionRequest, HumanActionResult } from '../../shared/human-actions';
import type { NodeId } from '../../shared/workflow';
import { DEFAULT_RULES } from '../../shared/project-rules';
import { approveResult, markDone, type ShipOptions, type ShipResult } from '../workflow/ship';
import type { HumanActionHandler } from './channel';

export interface ShipHandlersDeps {
  /** The project root. The feature folder and git are used under it. */
  root: string;
  /** Called after each call, so the watcher re-reads the lock. Errors are ignored. */
  onLockChanged: () => unknown;
  /**
   * The node of the feature's build controller, or null when it has none (D37). A controller that
   * is not at build-done refuses the ship step.
   */
  controllerNode: (feature: string) => NodeId | null;
  /** The project's commit format for approve-result (D40). Undefined takes the default format. */
  commitFormat?: string;
}

export interface ShipHandlers {
  'approve-result': HumanActionHandler;
  'mark-done': HumanActionHandler;
}

/** The reason when an unexpected error reaches the handler. Fixed text, no echo of the error. */
const ACTION_FAILED = 'the action failed';

/**
 * Builds the two handlers. The channel registers them by action. Each reads its feature from the
 * checked request only.
 */
export function createShipHandlers(deps: ShipHandlersDeps): ShipHandlers {
  async function notify(): Promise<void> {
    try {
      await deps.onLockChanged();
    } catch {
      // The watcher catches up on its next event.
    }
  }

  async function run(
    request: HumanActionRequest,
    step: (root: string, feature: string, options: ShipOptions) => Promise<ShipResult>,
  ): Promise<HumanActionResult> {
    let outcome: ShipResult;
    try {
      outcome = await step(deps.root, request.feature, {
        controllerNode: () => deps.controllerNode(request.feature),
        commitFormat: deps.commitFormat ?? DEFAULT_RULES.commitFormat,
      });
    } catch {
      outcome = { ok: false, reason: ACTION_FAILED };
    }
    await notify();
    return outcome.ok ? { ok: true } : { ok: false, code: 'refused', reason: outcome.reason };
  }

  return {
    'approve-result': (request) => run(request, approveResult),
    'mark-done': (request) => run(request, markDone),
  };
}
