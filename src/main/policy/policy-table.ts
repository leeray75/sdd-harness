// The per-job tool table from the design: which registry tools each job may ever call before
// any project tightening. Shared policy data, so it has no Electron or file-system imports.
// A project can only remove names from these sets (see tightening.ts); nothing here is
// changed at run time.

import type { JobId } from '../../shared/agent-protocol';
import type { ToolName } from '../../shared/tools';

export const BASE_TOOLS: Record<JobId, readonly ToolName[]> = {
  planner: ['read_file', 'list_files', 'search_text', 'write_file', 'edit_file', 'read_ticket'],
  writer: ['read_file', 'list_files', 'search_text', 'write_file', 'edit_file', 'run_command'],
  reviewer: ['read_file', 'list_files', 'search_text', 'run_command'],
  reader: ['read_file', 'list_files', 'search_text', 'read_ticket'],
};
