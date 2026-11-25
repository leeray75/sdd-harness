// A project's rules (p4-project-store, D40). Pure: no Node, Electron or DOM import, so both sides
// may use it. parseRules checks a value received from disk or from a caller and fills the defaults;
// formatCommitMessage builds the approve-result commit message from a project's commit format.
//
// Spec approval and review before every result are always on and are not rules, so a rules value
// that names them is refused. The refusal reasons are fixed text and never echo the input.

/** The model policies a project can hold. Routing beyond storing the value is phase 8. */
export const MODEL_POLICIES = ['defaults', 'self-hosted-only', 'custom'] as const;

export type ModelPolicy = (typeof MODEL_POLICIES)[number];

/** The round limit of a build (G2): one, two or three review rounds. */
export type RoundLimit = 1 | 2 | 3;

/** The rules of one project. */
export interface ProjectRules {
  roundLimit: RoundLimit;
  modelPolicy: ModelPolicy;
  commitFormat: string;
}

/** The rules a project gets when it gives none. */
export const DEFAULT_RULES: ProjectRules = {
  roundLimit: 3,
  modelPolicy: 'defaults',
  commitFormat: '{ticket}: {summary}',
};

/** The longest commit format, in characters. */
export const MAX_COMMIT_FORMAT_LENGTH = 120;

/** The names a rules value may use. Any other key is refused. */
const RULE_KEYS = ['roundLimit', 'modelPolicy', 'commitFormat'] as const;

/**
 * Character codes that end a line: LF, CR, and the Unicode line and paragraph separators. The codes
 * are listed by number, so the source keeps to plain text.
 */
const LINE_BREAK_CODES = [0x0a, 0x0d, 0x2028, 0x2029];

/** True when the text holds a line break of any kind. */
export function hasLineBreak(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    if (LINE_BREAK_CODES.includes(text.charCodeAt(index))) return true;
  }
  return false;
}

/** The fixed reasons. None echoes a value from the input. */
export const RULE_REASONS = {
  notObject: 'the rules must be an object',
  notPlain: 'the rules must be a plain object',
  unknownKey: 'the rules have a field that is not a project rule',
  roundLimit: 'the round limit must be 1, 2 or 3',
  modelPolicy: 'the model policy must be defaults, self-hosted-only or custom',
  formatType: 'the commit format must be text',
  formatLength: `the commit format must be 1 to ${MAX_COMMIT_FORMAT_LENGTH} characters`,
  formatLineBreak: 'the commit format must not contain a line break',
  formatNoSummary: 'the commit format must contain {summary} once',
  formatSummaryTwice: 'the commit format must not contain {summary} more than once',
  formatTicketTwice: 'the commit format must not contain {ticket} more than once',
  formatOtherBrace: 'the commit format may only use the placeholders {summary} and {ticket}',
} as const;

export type RoundLimitCheck = { ok: true; limit: RoundLimit } | { ok: false; reason: string };

/** Checks a round limit: 1, 2 and 3 are accepted; anything else (including "3" and 2.5) is refused. */
export function checkRoundLimit(value: unknown): RoundLimitCheck {
  if (value === 1 || value === 2 || value === 3) {
    return { ok: true, limit: value };
  }
  return { ok: false, reason: RULE_REASONS.roundLimit };
}

/** Checks a commit format and returns the fixed reason it is refused for, or null when it passes. */
function formatProblem(value: unknown): string | null {
  if (typeof value !== 'string') return RULE_REASONS.formatType;
  const length = Array.from(value).length;
  if (length < 1 || length > MAX_COMMIT_FORMAT_LENGTH) return RULE_REASONS.formatLength;
  if (hasLineBreak(value)) return RULE_REASONS.formatLineBreak;
  const summaries = value.split('{summary}').length - 1;
  if (summaries === 0) return RULE_REASONS.formatNoSummary;
  if (summaries > 1) return RULE_REASONS.formatSummaryTwice;
  const tickets = value.split('{ticket}').length - 1;
  if (tickets > 1) return RULE_REASONS.formatTicketTwice;
  const rest = value.split('{summary}').join('').split('{ticket}').join('');
  if (rest.includes('{') || rest.includes('}')) return RULE_REASONS.formatOtherBrace;
  return null;
}

export type RulesParse = { ok: true; rules: ProjectRules } | { ok: false; reason: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Checks a rules value. It must be a plain object whose keys are a subset of the three rule
 * fields. A missing field (or one that is undefined) takes its default. Returns the full rules.
 */
export function parseRules(value: unknown): RulesParse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: RULE_REASONS.notObject };
  }
  if (!isPlainObject(value)) return { ok: false, reason: RULE_REASONS.notPlain };
  const record = value;
  for (const key of Object.keys(record)) {
    if (!(RULE_KEYS as readonly string[]).includes(key)) {
      return { ok: false, reason: RULE_REASONS.unknownKey };
    }
  }

  const rawLimit = record['roundLimit'];
  const limit: RoundLimitCheck =
    rawLimit === undefined
      ? { ok: true, limit: DEFAULT_RULES.roundLimit }
      : checkRoundLimit(rawLimit);
  if (!limit.ok) return { ok: false, reason: limit.reason };

  const rawPolicy = record['modelPolicy'];
  let policy: ModelPolicy = DEFAULT_RULES.modelPolicy;
  if (rawPolicy !== undefined) {
    if (!(MODEL_POLICIES as readonly unknown[]).includes(rawPolicy)) {
      return { ok: false, reason: RULE_REASONS.modelPolicy };
    }
    policy = rawPolicy as ModelPolicy;
  }

  const rawFormat = record['commitFormat'];
  let format = DEFAULT_RULES.commitFormat;
  if (rawFormat !== undefined) {
    const problem = formatProblem(rawFormat);
    if (problem !== null) return { ok: false, reason: problem };
    format = rawFormat as string;
  }

  return {
    ok: true,
    rules: { roundLimit: limit.limit, modelPolicy: policy, commitFormat: format },
  };
}

/**
 * The commit message for a format. With a ticket, {ticket} and {summary} are filled in one pass, so
 * a value that contains a placeholder is kept as text. With no ticket, the message is the summary.
 */
export function formatCommitMessage(format: string, ticket: string, summary: string): string {
  if (ticket === '') return summary;
  return format
    .split('{ticket}')
    .map((part) => part.split('{summary}').join(summary))
    .join(ticket);
}
