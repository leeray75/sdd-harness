// Main-process policy gate for agent tool calls. Pure: no Electron or file-system imports, so
// it can be unit tested. Every tool call request passes through checkToolCall before anything
// runs. The checks run in a fixed order and the first that fails decides. Every decision,
// allowed or denied, carries a rule event for the log. Reasons are fixed text: they never echo
// a target or an argument value (only validated job ids and registry names appear in them).

import type { JobId } from '../../shared/agent-protocol';
import { isToolName, TOOL_ARG_CHECKS } from '../../shared/tools';
import { effectiveFeature, type PolicyContext } from './context';
import { BASE_TOOLS } from './policy-table';
import { classifyPath, type PathArea } from './path-areas';
import { makeRuleEvent, type DecisionEvent } from './rule-event';
import { effectiveTools } from './tightening';

export interface ToolCallRequest {
  job: JobId;
  tool: string;
  args: Record<string, unknown>;
}

/** The gate's answer: whether the call may run, the reason, and the rule event for the log. */
export interface PolicyDecision {
  allow: boolean;
  reason: string;
  event: DecisionEvent;
}

const NO_SUCH_TOOL = 'not allowed: no such tool';
const BAD_ARGS = 'not allowed: the arguments are not valid for this tool';
const OUTSIDE_PATH = "not allowed: this path can't be written";
const GIT_PATH = 'not allowed: paths inside .git are not allowed';
const PLANNER_NO_FEATURE = "not allowed: no feature is open, so the planner can't write";
const SPEC_APPROVED = 'not allowed: the spec is approved; spec files are read-only';
const PLANNER_SCOPE =
  "not allowed: the planner can write only PLAN.md, SPECS.md, tasks.md and SUBTASK.md in the current feature's spec folder";
const WRITER_SPEC = "not allowed: spec files can't be written by the code writer";
const WRITER_SOURCE_LOCKED =
  'not allowed: source files can be edited only after the spec is approved';
const ALLOWED = 'allowed';

function deny(request: ToolCallRequest, reason: string): PolicyDecision {
  return { allow: false, reason, event: makeRuleEvent(request, false, reason) };
}

function allow(request: ToolCallRequest): PolicyDecision {
  return { allow: true, reason: ALLOWED, event: makeRuleEvent(request, true, ALLOWED) };
}

/** The path a write or edit names, from arguments the guard has already accepted. */
function writePath(args: unknown): string {
  return (args as { path: string }).path;
}

/**
 * Path rules for write_file and edit_file. Returns the denial reason, or null when the path
 * may be written by this job in this state.
 */
function writeReason(
  job: JobId,
  area: PathArea,
  context: PolicyContext,
  feature: string | null,
): string | null {
  if (area.kind === 'outside') {
    return OUTSIDE_PATH;
  }
  if (area.kind === 'git') {
    return GIT_PATH;
  }
  if (job === 'planner') {
    if (feature === null) {
      return PLANNER_NO_FEATURE;
    }
    if (context.spec === 'approved') {
      return SPEC_APPROVED;
    }
    const ownPlanningDoc = area.kind === 'spec-doc' && area.feature === feature;
    return ownPlanningDoc ? null : PLANNER_SCOPE;
  }
  if (job === 'writer') {
    if (area.kind === 'spec-doc' || area.kind === 'spec-other') {
      return context.spec === 'approved' ? SPEC_APPROVED : WRITER_SPEC;
    }
    if (area.kind === 'source' && context.spec !== 'approved') {
      return WRITER_SOURCE_LOCKED;
    }
  }
  return null;
}

/**
 * Decides one tool call. The checks run in this order, and the first that fails decides:
 * the tool is a registry name; the job's base set has it; the project did not remove it; the
 * arguments pass the registry guard; the write path rules; the command check.
 */
export function checkToolCall(request: ToolCallRequest, context: PolicyContext): PolicyDecision {
  const { job } = request;
  const tool = request.tool;

  // 1. A registry name.
  if (!isToolName(tool)) {
    return deny(request, NO_SUCH_TOOL);
  }

  // 2. In the job's base set.
  if (!BASE_TOOLS[job].includes(tool)) {
    return deny(request, `not allowed: the ${job} job has no ${tool} tool`);
  }

  // 3. Not removed by this project.
  if (!effectiveTools(job, context.tightening).includes(tool)) {
    return deny(request, `not allowed: this project removed ${tool} from the ${job} job`);
  }

  // 4. The arguments pass the registry guard.
  const checked = TOOL_ARG_CHECKS[tool](request.args);
  if (!checked.ok) {
    return deny(request, BAD_ARGS);
  }

  // 5. Path rules for writes.
  if (tool === 'write_file' || tool === 'edit_file') {
    const area = classifyPath(writePath(checked.args));
    const reason = writeReason(job, area, context, effectiveFeature(context.feature));
    if (reason !== null) {
      return deny(request, reason);
    }
  }

  // 6. The command check decides run_command.
  if (tool === 'run_command') {
    const args = checked.args as { program: string; args: string[]; cwd?: string };
    const call = {
      job,
      program: args.program,
      args: [...args.args],
      ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
    };
    const verdict = context.commandCheck(call);
    if (!verdict.allow) {
      return deny(request, verdict.reason);
    }
  }

  // 7. Otherwise allowed.
  return allow(request);
}
