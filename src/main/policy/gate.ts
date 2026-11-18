// Main-process policy gate for agent tool calls. Pure: no Electron imports, so it can be
// unit tested. Every tool call request passes through checkToolCall before anything runs.
// Default deny: in this subtask every request is refused. Phase 2 adds the per-job policy
// table here.

import type { JobId } from '../../shared/agent-protocol';

export interface ToolCallRequest {
  job: JobId;
  tool: string;
  args: Record<string, unknown>;
}

export type GateDecision = { allow: true } | { allow: false; reason: string };

const NO_TOOLS_REASON = 'no tools are allowed yet (policy table arrives in Phase 2)';

export function checkToolCall(request: ToolCallRequest): GateDecision {
  // The request is not inspected yet: nothing is allowed. Phase 2 reads it here.
  void request;
  return { allow: false, reason: NO_TOOLS_REASON };
}
