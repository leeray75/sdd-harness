// A project's tightening of the job tool table. A project can only remove tools from a job's
// base set; no input can add one. The parser refuses everything else with one fixed reason
// that never echoes a value. Pure: no Electron or file-system imports.

import { isJobId, type JobId } from '../../shared/agent-protocol';
import { isToolName, type ToolName } from '../../shared/tools';
import { BASE_TOOLS } from './policy-table';

/** Names a project removes from a job's base set. It can never add a tool. */
export interface Tightening {
  remove: Partial<Record<JobId, readonly ToolName[]>>;
}

export type ParseTighteningResult =
  { ok: true; tightening: Tightening } | { ok: false; reason: string };

const REFUSED_REASON =
  'the tightening must be {} or { remove: { <job>: [<tool>, ...] } } with known job and tool names; nothing was loaded';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function refused(): { ok: false; reason: string } {
  return { ok: false, reason: REFUSED_REASON };
}

/**
 * Checks a raw tightening value. Accepts `{}` and `{ remove: { job: [tool, ...] } }`, where every
 * key is a job id and every value an array of registry tool names. Everything else is refused
 * with the same fixed reason, which never echoes the input.
 */
export function parseTightening(raw: unknown): ParseTighteningResult {
  if (!isRecord(raw)) {
    return refused();
  }
  const keys = Object.keys(raw);
  if (keys.length === 0) {
    return { ok: true, tightening: { remove: {} } };
  }
  if (keys.length !== 1 || keys[0] !== 'remove') {
    return refused();
  }
  const remove = raw['remove'];
  if (!isRecord(remove)) {
    return refused();
  }

  const parsed: Partial<Record<JobId, ToolName[]>> = {};
  for (const job of Object.keys(remove)) {
    if (!isJobId(job)) {
      return refused();
    }
    const tools = remove[job];
    if (!Array.isArray(tools)) {
      return refused();
    }
    const names: ToolName[] = [];
    for (const tool of tools) {
      if (!isToolName(tool)) {
        return refused();
      }
      names.push(tool);
    }
    parsed[job] = names;
  }
  return { ok: true, tightening: { remove: parsed } };
}

/**
 * The tools a job may call after tightening: its base set minus the names removed for it. Only
 * `remove[job]` is read, so no other key of the input can add a tool.
 */
export function effectiveTools(job: JobId, tightening: Tightening): readonly ToolName[] {
  const removed = new Set<ToolName>(tightening.remove[job] ?? []);
  return BASE_TOOLS[job].filter((tool) => !removed.has(tool));
}
