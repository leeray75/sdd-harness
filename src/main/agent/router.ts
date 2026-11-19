// Main-side router for messages from the agent. Pure: the gate, the tool runner and the
// logger are passed in, so tests can replace them. Every input is untrusted and is
// validated first.
//
// A tool call runs only when the gate allows it. The router then calls the injected runner
// and returns its output (or its failure) to the agent under the request's id. A denied
// call never reaches the runner. The log carries job, tool and outcome; never arguments or
// tool output.

import {
  MAX_TOOL_OUTPUT_LENGTH,
  validateAgentToMainMessage,
  type MainToAgentMessage,
} from '../../shared/agent-protocol';
import type { Logger } from '../log';
import type { GateDecision, ToolCallRequest } from '../policy/gate';

/** What a tool runner returns: its text, or the reason it could not complete. */
export type ToolRunResult = { ok: true; output: string } | { ok: false; reason: string };

/** Runs an allowed tool call in main. Must not throw; the router catches it if it does. */
export type ToolRunner = (call: {
  tool: string;
  args: Record<string, unknown>;
}) => Promise<ToolRunResult>;

export interface RouterDeps {
  checkToolCall: (request: ToolCallRequest) => GateDecision;
  runTool: ToolRunner;
  logger: Logger;
}

/** What the host does after a message: post `reply` if there is one, ping if `ready`. */
export interface RouterOutcome {
  reply: MainToAgentMessage | null;
  ready: boolean;
}

const NO_REPLY: RouterOutcome = { reply: null, ready: false };

const FALLBACK_DENY_REASON = 'denied by policy';
const TOOL_THREW_REASON = 'the tool could not run';
const OUTPUT_TOO_LONG_REASON = `the tool output is longer than ${MAX_TOOL_OUTPUT_LENGTH} characters`;

async function runAllowed(
  message: { job: string; tool: string; args: Record<string, unknown> },
  deps: RouterDeps,
): Promise<ToolRunResult> {
  let result: ToolRunResult;
  try {
    result = await deps.runTool({ tool: message.tool, args: message.args });
  } catch {
    // The error text is not logged or returned: it may echo the arguments.
    result = { ok: false, reason: TOOL_THREW_REASON };
  }
  if (result.ok && result.output.length > MAX_TOOL_OUTPUT_LENGTH) {
    return { ok: false, reason: OUTPUT_TOO_LONG_REASON };
  }
  return result;
}

export async function handleAgentMessage(raw: unknown, deps: RouterDeps): Promise<RouterOutcome> {
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
      if (!decision.allow) {
        const reason = decision.reason || FALLBACK_DENY_REASON;
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

      const result = await runAllowed(message, deps);
      if (!result.ok) {
        deps.logger.info(
          `tool call failed: job=${message.job} tool=${message.tool} outcome=failed`,
        );
        return {
          reply: {
            type: 'tool-call-result',
            id: message.id,
            ok: false,
            error: { code: 'failed', reason: result.reason },
          },
          ready: false,
        };
      }
      deps.logger.info(`tool call ran: job=${message.job} tool=${message.tool} outcome=ok`);
      return {
        reply: {
          type: 'tool-call-result',
          id: message.id,
          ok: true,
          output: result.output,
        },
        ready: false,
      };
    }
  }
}
