// The four agent jobs: each job's plain-language name and its base tools. Shared code, so it
// imports only from src/shared/ and no Node, Electron or DOM API. Main's gate and tightening
// read BASE_TOOLS through src/main/policy/policy-table.ts, and the agent reads the same table to
// advertise its tools (D30, D32). Nothing here changes at run time.

import type { JobId } from './agent-protocol';
import type { ToolName } from './tools';

/** One job's definition. `name` is the plain-language name the UI shows (PRD, design table). */
export interface JobDefinition {
  readonly name: string;
}

export const JOBS: Record<JobId, JobDefinition> = {
  planner: { name: 'plans and chats' },
  writer: { name: 'writes code' },
  reviewer: { name: 'reviews code' },
  reader: { name: 'reads big files' },
};

/**
 * The per-job tool table from the design: which registry tools each job may ever call before
 * any project tightening. A project can only remove names from these sets (see tightening.ts).
 */
export const BASE_TOOLS: Record<JobId, readonly ToolName[]> = {
  planner: ['read_file', 'list_files', 'search_text', 'write_file', 'edit_file', 'read_ticket'],
  writer: ['read_file', 'list_files', 'search_text', 'write_file', 'edit_file', 'run_command'],
  reviewer: ['read_file', 'list_files', 'search_text', 'run_command'],
  reader: ['read_file', 'list_files', 'search_text', 'read_ticket'],
};
