// Main-side router for messages from the agent. Pure: the gate and the logger are passed
// in, so tests can replace them. Every input is untrusted and is validated first.
//
// There is no execute path here. A tool call only ever gets a result back from the gate.
// Phase 2 adds execution after the gate allows a call; until then an allow decision is
// refused, so no code path runs a tool.

import { validateAgentToMainMessage, type MainToAgentMessage } from '../../shared/agent-protocol';
import type { Logger } from '../log';
import type { GateDecision, ToolCallRequest } from '../policy/gate';

export interface RouterDeps {
  checkToolCall: (request: ToolCallRequest) => GateDecision;
  logger: Logger;
}

/** What the host does after a message: post `reply` if there is one, ping if `ready`. */
export interface RouterOutcome {
  reply: MainToAgentMessage | null;
  ready: boolean;
}

const NO_REPLY: RouterOutcome = { reply: null, ready: false };

const FALLBACK_DENY_REASON = 'denied by policy';
const NOT_EXECUTABLE_REASON = 'tool execution is not available yet';

export function handleAgentMessage(raw: unknown, deps: RouterDeps): RouterOutcome {
  const parsed = validateAgentToMainMessage(raw);
  if (!parsed.ok) {
    deps.logger.error(`rejected agent message: ${parsed.reason}`);
    return NO_REPLY;
  }

  const message = parsed.message;
  switch (message.type) {
    case 'ready':
      deps.logger.info(`agent ready pid=${message.pid}`);
      return { reply: null, ready: true };
    case 'pong':
      deps.logger.info('agent pong');
      return NO_REPLY;
    case 'tool-call-request': {
      const decision = deps.checkToolCall({
        job: message.job,
        tool: message.tool,
        args: message.args,
      });
      // A refusal carries the gate's reason. An allow is refused too, because execution
      // does not exist yet (see the note at the top of this file).
      const reason = decision.allow
        ? NOT_EXECUTABLE_REASON
        : decision.reason || FALLBACK_DENY_REASON;
      deps.logger.info(
        `tool call denied: job=${message.job} tool=${message.tool} reason=${reason}`,
      );
      return {
        reply: {
          type: 'tool-call-result',
          id: message.id,
          ok: false,
          error: { code: 'denied', reason },
        },
        ready: false,
      };
    }
  }
}
