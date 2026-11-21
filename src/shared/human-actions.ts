// The human-only actions (D3) and their request and result shapes. Shared by both sides, so it
// must not import Node, Electron or DOM APIs. Main's channel (src/main/human/channel.ts) checks
// every request with parseHumanActionRequest before it looks at a gesture (D33).
//
// The reasons returned by the guard are fixed text: they never echo a value from the request.

/** The five actions that exist only as UI actions: a user gesture in the app's window (D3, D33). */
export const HUMAN_ACTION_IDS = [
  'approve-spec',
  'approve-result',
  'mark-done',
  'change-rules',
  'edit-approved-spec',
] as const;

export type HumanActionId = (typeof HUMAN_ACTION_IDS)[number];

/** Longest feature slug, in characters. */
export const MAX_FEATURE_LENGTH = 64;

/** A feature slug: lowercase letters and digits, joined by single dashes. */
export const FEATURE_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The only payload a human action carries: which action, and for which feature. */
export interface HumanActionRequest {
  action: HumanActionId;
  feature: string;
}

/** Why a request was refused. `untrusted-sender`: not the app's window. `invalid`: the guard failed. */
export type HumanActionRefusal = 'untrusted-sender' | 'invalid' | 'no-gesture' | 'not-available';

export type HumanActionResult =
  { ok: true } | { ok: false; code: HumanActionRefusal; reason: string };

/** Outcome of the guard: the checked request, or the fixed reason it was refused. */
export type HumanActionParse =
  { ok: true; request: HumanActionRequest } | { ok: false; reason: string };

/** True when `value` is one of the five human action ids. */
export function isHumanActionId(value: unknown): value is HumanActionId {
  return typeof value === 'string' && (HUMAN_ACTION_IDS as readonly string[]).includes(value);
}

function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

/**
 * Checks a value received over IPC. It must be a plain object with exactly the keys `action`
 * and `feature`, an id from HUMAN_ACTION_IDS, and a feature slug of at most 64 characters.
 * Nothing else is accepted.
 */
export function parseHumanActionRequest(value: unknown): HumanActionParse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('the request must be an object');
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return fail('the request must be a plain object');
  }
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== 'action' || keys[1] !== 'feature') {
    return fail('the request must have exactly the fields action and feature');
  }
  const record = value as Record<string, unknown>;
  const action = record['action'];
  if (!isHumanActionId(action)) {
    return fail(`action must be one of ${HUMAN_ACTION_IDS.join(', ')}`);
  }
  const feature = record['feature'];
  if (
    typeof feature !== 'string' ||
    feature.length > MAX_FEATURE_LENGTH ||
    !FEATURE_SLUG_PATTERN.test(feature)
  ) {
    return fail(
      `feature must be a lowercase slug of letters, digits and single dashes, at most ${MAX_FEATURE_LENGTH} characters`,
    );
  }
  return { ok: true, request: { action, feature } };
}
