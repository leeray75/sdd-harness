// The human-only channel in main (D33). Pure: no Electron import. The sender check, the gesture
// tracker, the logger and the handlers are passed in. Every request on `harness:human-action`
// passes through handle(), which runs three checks in order and stops at the first refusal:
//   1. the sender is the app's own window and page;
//   2. the request passes the guard (parseHumanActionRequest);
//   3. a real user gesture came just before the call (the tracker).
// Then the registry: an action with no handler is refused as not-available. Phase 3 registers
// the real handlers. Each call logs exactly one decision line.

import {
  parseHumanActionRequest,
  type HumanActionId,
  type HumanActionRequest,
  type HumanActionResult,
} from '../../shared/human-actions';
import type { Logger } from '../log';
import type { GestureTracker } from './gesture';

/** The part of an IPC call the sender check reads: the web contents id and the frame's URL. */
export interface HumanActionSender {
  senderId: number;
  frameUrl: string | undefined;
}

/** Runs one human-only action. The result is returned to the caller. */
export type HumanActionHandler = (
  request: HumanActionRequest,
) => HumanActionResult | Promise<HumanActionResult>;

export interface HumanActionChannelDeps {
  /** True only for the app's own window and top-level page. */
  isTrustedSender: (sender: HumanActionSender) => boolean;
  tracker: GestureTracker;
  logger: Logger;
}

export interface HumanActionChannel {
  /** Registers the handler for one action. Throws if that action already has one. */
  register(action: HumanActionId, handler: HumanActionHandler): void;
  /** Runs the checks and the handler for one raw request from the renderer. */
  handle(sender: HumanActionSender, raw: unknown): Promise<HumanActionResult>;
}

const UNTRUSTED_REASON = 'the call did not come from the app window';
const NO_GESTURE_REASON = 'no user gesture in the app window just before the call';
const NOT_AVAILABLE_REASON = 'no handler is registered for this action';
const FAILED_REASON = 'the action failed';

/** The log's action field for a request that did not pass the guard. */
const INVALID_LABEL = 'invalid';

export function createHumanActionChannel(deps: HumanActionChannelDeps): HumanActionChannel {
  const handlers = new Map<HumanActionId, HumanActionHandler>();

  /** Writes the one decision line for a call. A valid request adds its feature and project. */
  function logDecision(
    action: string,
    outcome: 'accepted' | 'refused',
    code: string,
    scope?: { feature: string; project: string },
  ): void {
    const line =
      `human action ${action}: ${outcome} (${code})` +
      (scope === undefined ? '' : ` feature=${scope.feature} project=${scope.project}`);
    if (outcome === 'accepted') {
      deps.logger.info(line);
    } else {
      deps.logger.error(line);
    }
  }

  function refuse(
    code: 'untrusted-sender' | 'invalid' | 'no-gesture' | 'not-available',
    reason: string,
    action: string,
    scope?: { feature: string; project: string },
  ): HumanActionResult {
    logDecision(action, 'refused', code, scope);
    return { ok: false, code, reason };
  }

  return {
    register(action, handler) {
      if (handlers.has(action)) {
        throw new Error(`a handler is already registered for ${action}`);
      }
      handlers.set(action, handler);
    },

    async handle(sender, raw) {
      // 1. The sender. Nothing from an untrusted call is read or logged, so its action is `invalid`.
      if (!deps.isTrustedSender(sender)) {
        return refuse('untrusted-sender', UNTRUSTED_REASON, INVALID_LABEL);
      }

      // 2. The guard. The gesture is not touched when the request is refused here.
      const parsed = parseHumanActionRequest(raw);
      if (!parsed.ok) {
        return refuse('invalid', parsed.reason, INVALID_LABEL);
      }
      const request = parsed.request;
      const { action, project, feature } = request;
      const scope = { feature, project };

      // 3. The gesture. Each gesture is used by one request, whatever happens next.
      if (!deps.tracker.consume()) {
        return refuse('no-gesture', NO_GESTURE_REASON, action, scope);
      }

      // 4. The registry.
      const handler = handlers.get(action);
      if (handler === undefined) {
        return refuse('not-available', NOT_AVAILABLE_REASON, action, scope);
      }

      // 5. The handler. A throw is logged by its error name only, never by its message.
      let result: HumanActionResult;
      try {
        result = await handler(request);
      } catch (error) {
        const name = error instanceof Error ? error.name : 'non-error';
        deps.logger.error(`human action ${action}: handler threw (${name})`);
        return refuse('not-available', FAILED_REASON, action, scope);
      }
      logDecision(
        action,
        result.ok ? 'accepted' : 'refused',
        result.ok ? 'ok' : result.code,
        scope,
      );
      return result;
    },
  };
}
