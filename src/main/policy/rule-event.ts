// Rule events: one typed record for every policy decision, allowed or denied. The record holds
// the job, the tool, a target and the reason, and never another argument value. Pure: no
// Electron or file-system imports. The logger is only a type here.

import type { JobId } from '../../shared/agent-protocol';
import { isToolName, TOOL_ARG_CHECKS } from '../../shared/tools';
import type { Logger } from '../log';

export interface RuleEvent {
  kind: 'rule';
  decision: 'allow' | 'deny';
  job: JobId;
  tool: string;
  target: string;
  reason: string;
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
export function makeRuleEvent(request: RuleRequest, allow: boolean, reason: string): RuleEvent {
  return {
    kind: 'rule',
    decision: allow ? 'allow' : 'deny',
    job: request.job,
    tool: isToolName(request.tool) ? request.tool : NO_TARGET,
    target: sanitizeTarget(targetOf(request.tool, request.args)),
    reason,
  };
}

/** The one-line form of a rule event, as it is logged. */
export function formatRuleEvent(event: RuleEvent): string {
  const verdict = event.decision === 'allow' ? 'allowed' : 'blocked';
  return `rule ${verdict}: job=${event.job} tool=${event.tool} target=${event.target} reason=${event.reason}`;
}

/** A sink that logs allows with info and denies with error, in the formatRuleEvent format. */
export function logRuleEvent(logger: Logger): (event: RuleEvent) => void {
  return (event) => {
    const line = formatRuleEvent(event);
    if (event.decision === 'allow') {
      logger.info(line);
    } else {
      logger.error(line);
    }
  };
}
