// Message contract between the main process and the agent process. Shared by both
// sides, so it must not import Node, Electron or DOM APIs.
//
// Human-only actions (approve spec, approve result, close or mark done, change rules,
// edit an approved spec) have no message type, job or tool name here. The guards reject
// every message type that is not listed, so those actions cannot be sent to main (D3).

/** The four jobs in the PRD. Display names belong to the UI layer, not here. */
export const JOB_IDS = ['planner', 'writer', 'reviewer', 'reader'] as const;

export type JobId = (typeof JOB_IDS)[number];

/** Longest string, in characters, that any message field may hold. */
export const MAX_STRING_LENGTH = 4096;

/** Deepest nesting the guards accept inside a tool call's `args`. */
export const MAX_ARGS_DEPTH = 8;

/** Longest tool output, in characters, that main returns to the agent (the 64 KiB read cap). */
export const MAX_TOOL_OUTPUT_LENGTH = 65_536;

/**
 * Why a tool call did not run. `denied`: the gate refused it. `failed`: the gate allowed it
 * but the tool could not complete. Later phases may add codes.
 */
export interface ToolCallError {
  code: 'denied' | 'failed';
  reason: string;
}

/** Messages the agent sends to main. */
export type AgentToMainMessage =
  | { type: 'ready'; pid: number }
  | { type: 'pong' }
  | {
      type: 'tool-call-request';
      id: string;
      job: JobId;
      tool: string;
      args: Record<string, unknown>;
    };

/** Messages main sends to the agent. */
export type MainToAgentMessage =
  | { type: 'ping' }
  | { type: 'model-key'; key: string | null }
  | { type: 'tool-call-result'; id: string; ok: true; output: string }
  | { type: 'tool-call-result'; id: string; ok: false; error: ToolCallError };

/** Outcome of a guard: the checked message, or the reason it was refused. */
export type ValidationResult<T> = { ok: true; message: T } | { ok: false; reason: string };

type FieldResult<T> = { ok: true; value: T } | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isJobId(value: unknown): value is JobId {
  return typeof value === 'string' && (JOB_IDS as readonly string[]).includes(value);
}

function requireString(obj: Record<string, unknown>, field: string): FieldResult<string> {
  const value = obj[field];
  if (typeof value !== 'string') {
    return { ok: false, reason: `field '${field}' must be a string` };
  }
  if (value.length === 0) {
    return { ok: false, reason: `field '${field}' must not be empty` };
  }
  if (value.length > MAX_STRING_LENGTH) {
    return { ok: false, reason: `field '${field}' is longer than ${MAX_STRING_LENGTH} characters` };
  }
  return { ok: true, value };
}

/** True for JSON-like data: finite numbers, booleans, null, bounded strings, arrays and objects. */
function isBoundedValue(value: unknown, depth: number): boolean {
  if (value === null || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value === 'string') {
    return value.length <= MAX_STRING_LENGTH;
  }
  if (depth <= 0) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.every((item) => isBoundedValue(item, depth - 1));
  }
  if (isRecord(value)) {
    return Object.entries(value).every(
      ([key, item]) => key.length <= MAX_STRING_LENGTH && isBoundedValue(item, depth - 1),
    );
  }
  return false;
}

function requireArgs(obj: Record<string, unknown>): FieldResult<Record<string, unknown>> {
  const value = obj['args'];
  if (!isRecord(value) || !isBoundedValue(value, MAX_ARGS_DEPTH)) {
    return {
      ok: false,
      reason: `field 'args' must be an object of JSON values with strings up to ${MAX_STRING_LENGTH} characters`,
    };
  }
  return { ok: true, value };
}

function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

/**
 * Checks a value received from the agent. Returns the typed message, or the reason it
 * was refused. The reason never echoes the message's contents.
 */
export function validateAgentToMainMessage(value: unknown): ValidationResult<AgentToMainMessage> {
  if (!isRecord(value)) {
    return fail('message is not an object');
  }
  switch (value['type']) {
    case 'ready': {
      const pid = value['pid'];
      if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
        return fail("field 'pid' must be a positive integer");
      }
      return { ok: true, message: { type: 'ready', pid } };
    }
    case 'pong':
      return { ok: true, message: { type: 'pong' } };
    case 'tool-call-request': {
      const id = requireString(value, 'id');
      if (!id.ok) return fail(id.reason);
      const job = value['job'];
      if (!isJobId(job)) {
        return fail(`field 'job' must be one of ${JOB_IDS.join(', ')}`);
      }
      const tool = requireString(value, 'tool');
      if (!tool.ok) return fail(tool.reason);
      const args = requireArgs(value);
      if (!args.ok) return fail(args.reason);
      return {
        ok: true,
        message: {
          type: 'tool-call-request',
          id: id.value,
          job,
          tool: tool.value,
          args: args.value,
        },
      };
    }
    default:
      return fail('unknown message type');
  }
}

/**
 * Checks a value received from main. Used by the agent. Returns the typed message, or the
 * reason it was refused.
 */
export function validateMainToAgentMessage(value: unknown): ValidationResult<MainToAgentMessage> {
  if (!isRecord(value)) {
    return fail('message is not an object');
  }
  switch (value['type']) {
    case 'ping':
      return { ok: true, message: { type: 'ping' } };
    case 'model-key': {
      // The key is the provider key for this run (D25). A missing or non-string key is refused,
      // and so is an oversized one. The reasons never echo the key.
      const key = value['key'];
      if (key === null) {
        return { ok: true, message: { type: 'model-key', key: null } };
      }
      if (typeof key !== 'string') {
        return fail("field 'key' must be a string or null");
      }
      if (key.length > MAX_STRING_LENGTH) {
        return fail(`field 'key' is longer than ${MAX_STRING_LENGTH} characters`);
      }
      return { ok: true, message: { type: 'model-key', key } };
    }
    case 'tool-call-result': {
      const id = requireString(value, 'id');
      if (!id.ok) return fail(id.reason);
      const ok = value['ok'];
      if (ok === true) {
        const output = value['output'];
        if (typeof output !== 'string') {
          return fail("field 'output' must be a string");
        }
        if (output.length > MAX_TOOL_OUTPUT_LENGTH) {
          return fail(`field 'output' is longer than ${MAX_TOOL_OUTPUT_LENGTH} characters`);
        }
        return {
          ok: true,
          message: { type: 'tool-call-result', id: id.value, ok: true, output },
        };
      }
      if (ok !== false) {
        return fail("field 'ok' must be a boolean");
      }
      const error = value['error'];
      const code = isRecord(error) ? error['code'] : undefined;
      if (!isRecord(error) || (code !== 'denied' && code !== 'failed')) {
        return fail("field 'error' must be { code: 'denied' or 'failed', reason }");
      }
      const reason = requireString(error, 'reason');
      if (!reason.ok) return fail(reason.reason);
      return {
        ok: true,
        message: {
          type: 'tool-call-result',
          id: id.value,
          ok: false,
          error: { code, reason: reason.value },
        },
      };
    }
    default:
      return fail('unknown message type');
  }
}

/** True when `value` is a well-formed agent-to-main message. */
export function isAgentToMainMessage(value: unknown): value is AgentToMainMessage {
  return validateAgentToMainMessage(value).ok;
}

/** True when `value` is a well-formed main-to-agent message. */
export function isMainToAgentMessage(value: unknown): value is MainToAgentMessage {
  return validateMainToAgentMessage(value).ok;
}
