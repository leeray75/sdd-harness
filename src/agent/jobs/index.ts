// The agent jobs' prompts (AC4, D32): one system prompt per job, and the task texts that Phase 3
// sends as the user message of each round. They are TypeScript string constants, so no file is
// read at run time. The tool list each run advertises comes from jobToolDefinitions (tools.ts).

import type { JobId } from '../../shared/agent-protocol';
import { PLANNER_ROLE, PLANNER_SYSTEM } from './planner';
import { READER_ROLE, READER_SYSTEM } from './reader';
import { REVIEWER_ROLE, REVIEWER_SYSTEM, REVIEWER_TASKS } from './reviewer';
import { WRITER_ROLE, WRITER_SYSTEM, WRITER_TASKS } from './writer';

export { jobToolDefinitions } from './tools';
export { COMMON_RULES, systemPrompt } from './rules';
export { REVIEWER_TASKS, WRITER_TASKS };

/** The system prompt of each job. Each run sends its job's prompt with the request. */
export const JOB_PROMPTS: Record<JobId, { system: string }> = {
  planner: { system: PLANNER_SYSTEM },
  writer: { system: WRITER_SYSTEM },
  reviewer: { system: REVIEWER_SYSTEM },
  reader: { system: READER_SYSTEM },
};

/** The role line that opens each job's prompt (rule (a) of AC4). */
export const JOB_ROLES: Record<JobId, string> = {
  planner: PLANNER_ROLE,
  writer: WRITER_ROLE,
  reviewer: REVIEWER_ROLE,
  reader: READER_ROLE,
};
