// Rule events: one typed record for every policy decision, allowed or denied, and for the two
// command events of D31: a revert of a protected file, and the network level of a writer's
// command. The record holds the job, the tool, a target and the reason, and never another
// argument value or any file content. Pure: no Electron or file-system imports. The logger is
// only a type here.

import type { JobId } from '../../shared/agent-protocol';
import { isToolName, TOOL_ARG_CHECKS } from '../../shared/tools';
import type { Logger } from '../log';

/** What a restore did to one path: put back, re-created, or deleted. */
export type RevertAction = 'restored' | 're-created' | 'deleted';

/** The network level a writer's command ran with (D31). */
export type NetworkLevel = 'os' | 'proxy-only';

/** The reason every revert event carries. */
export const REVERT_REASON = 'a command changed a protected file';

/** A tool call's allow or deny decision. */
export interface DecisionEvent {
  kind: 'rule';
  decision: 'allow' | 'deny';
  job: JobId;
  tool: string;
  target: string;
  reason: string;
}

/** One protected path a command changed and the restore put back, re-created or deleted. */
export interface RevertEvent {
  kind: 'revert';
  job: JobId;
  tool: 'run_command';
  target: string;
  action: RevertAction;
  reason: string;
}

/** The network level one writer command ran with. */
export interface NetworkEvent {
  kind: 'network';
  job: 'writer';
  tool: 'run_command';
  target: string;
  level: NetworkLevel;
}

export type RuleEvent = DecisionEvent | RevertEvent | NetworkEvent;

/** The logger the rule sink writes to: the app's log, which also has a warning level. */
export interface RuleLogger extends Logger {
  warn(message: string): void;
}

/** The request fields a rule event is built from. Untrusted until validated by the router. */
export interface RuleRequest {
  job: JobId;
  tool: string;
  args: Record<string, unknown>;
}

/** The target shown when the tool is unknown or its arguments fail the guard. */
const NO_TARGET = '-';
/** The target shown for list_files and search_text when no path is given. */
const DEFAULT_FOLDER = '.';
/** Longest target, in characters, before it is cut. */
const TARGET_MAX_CHARS = 200;
const ELLIPSIS = '…';

function isControlCode(code: number): boolean {
  return code <= 0x1f || code === 0x7f;
}

function hex4(code: number): string {
  return code.toString(16).padStart(4, '0');
}

/**
 * Escapes control characters (U+0000–U+001F and U+007F) as `\uXXXX`, then cuts the text to
 * 200 characters plus an ellipsis when it is longer than that.
 */
export function sanitizeTarget(text: string): string {
  let escaped = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    escaped += isControlCode(code) ? `\\u${hex4(code)}` : char;
  }
  const characters = Array.from(escaped);
  if (characters.length > TARGET_MAX_CHARS) {
    return characters.slice(0, TARGET_MAX_CHARS).join('') + ELLIPSIS;
  }
  return escaped;
}

/** The target of a call, from its checked arguments. `-` when the tool or the arguments are not valid. */
function targetOf(tool: string, args: Record<string, unknown>): string {
  if (!isToolName(tool)) {
    return NO_TARGET;
  }
  const checked = TOOL_ARG_CHECKS[tool](args);
  if (!checked.ok) {
    return NO_TARGET;
  }
  const value = checked.args as Record<string, unknown>;
  switch (tool) {
    case 'read_file':
    case 'write_file':
    case 'edit_file':
      return String(value['path']);
    case 'list_files':
    case 'search_text':
      return typeof value['path'] === 'string' ? value['path'] : DEFAULT_FOLDER;
    case 'run_command':
      return String(value['program']);
    case 'read_ticket':
      return String(value['id']);
    default:
      return NO_TARGET;
  }
}

/**
 * Builds the rule event for one decision. The tool is the registry name, or `-` when it is not
 * one. The target is taken from the arguments that the guard accepts, then sanitized.
 */
export function makeRuleEvent(request: RuleRequest, allow: boolean, reason: string): DecisionEvent {
  return {
    kind: 'rule',
    decision: allow ? 'allow' : 'deny',
    job: request.job,
    tool: isToolName(request.tool) ? request.tool : NO_TARGET,
    target: sanitizeTarget(targetOf(request.tool, request.args)),
    reason,
  };
}

/** The revert event for one protected path. The path is sanitized like any other target. */
export function makeRevertEvent(job: JobId, path: string, action: RevertAction): RevertEvent {
  return {
    kind: 'revert',
    job,
    tool: 'run_command',
    target: sanitizeTarget(path),
    action,
    reason: REVERT_REASON,
  };
}

/** The network event for one writer command. The program is sanitized like any other target. */
export function makeNetworkEvent(program: string, level: NetworkLevel): NetworkEvent {
  return {
    kind: 'network',
    job: 'writer',
    tool: 'run_command',
    target: sanitizeTarget(program),
    level,
  };
}

/** The one-line form of a rule event, as it is logged. */
export function formatRuleEvent(event: RuleEvent): string {
  switch (event.kind) {
    case 'rule': {
      const verdict = event.decision === 'allow' ? 'allowed' : 'blocked';
      return `rule ${verdict}: job=${event.job} tool=${event.tool} target=${event.target} reason=${event.reason}`;
    }
    case 'revert':
      return `rule reverted: job=${event.job} tool=${event.tool} target=${event.target} action=${event.action} reason=${event.reason}`;
    case 'network':
      return `rule network: job=${event.job} tool=${event.tool} target=${event.target} level=${event.level}`;
  }
}

/**
 * A sink for the rule events. A decision that allows, and a network event at the OS level, are
 * logged with info. A denial and a revert are logged with error. A network event that is only
 * proxy-only is logged with warn. Every line is the formatRuleEvent form.
 */
export function logRuleEvent(logger: RuleLogger): (event: RuleEvent) => void {
  return (event) => {
    const line = formatRuleEvent(event);
    switch (event.kind) {
      case 'rule':
        if (event.decision === 'allow') {
          logger.info(line);
        } else {
          logger.error(line);
        }
        return;
      case 'revert':
        logger.error(line);
        return;
      case 'network':
        if (event.level === 'os') {
          logger.info(line);
        } else {
          logger.warn(line);
        }
        return;
    }
  };
}
