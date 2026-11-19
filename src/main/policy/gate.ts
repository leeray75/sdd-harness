// Main-process policy gate for agent tool calls. Pure: no Electron imports, so it can be
// unit tested. Every tool call request passes through checkToolCall before anything runs.
// Default deny: the only allowed call is job `reader` with tool `read_file` and args exactly
// `{ path: string }`. Everything else is refused. Phase 2 replaces this with the per-job
// policy table.

import type { JobId } from '../../shared/agent-protocol';

export interface ToolCallRequest {
  job: JobId;
  tool: string;
  args: Record<string, unknown>;
}

export type GateDecision = { allow: true } | { allow: false; reason: string };

const JOB_REASON =
  'not allowed: only the reader job may call tools (policy table arrives in Phase 2)';
const TOOL_REASON = 'not allowed: the only tool available is read_file';
const ARGS_REASON = 'not allowed: read_file takes exactly one argument, path, as a string';

/** True when `args` has exactly one own key, `path`, holding a string. */
function isReadFileArgs(args: Record<string, unknown>): boolean {
  const keys = Object.keys(args);
  return keys.length === 1 && keys[0] === 'path' && typeof args['path'] === 'string';
}

export function checkToolCall(request: ToolCallRequest): GateDecision {
  if (request.job !== 'reader') {
    return { allow: false, reason: JOB_REASON };
  }
  if (request.tool !== 'read_file') {
    return { allow: false, reason: TOOL_REASON };
  }
  if (!isReadFileArgs(request.args)) {
    return { allow: false, reason: ARGS_REASON };
  }
  return { allow: true };
}
