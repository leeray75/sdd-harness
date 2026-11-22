// The approval lock of the sdd documents (p3-spec-lock, D36): the state file's shape, its parser
// and serializer, the hash input rules, the approval value, and the frontmatter helpers the
// approve-spec handler uses. Pure, shared code: it imports only from ./spec-docs and the types of
// ./spec-detect, and no Node, Electron or DOM API. The file reads and writes are in
// src/main/workflow/spec-lock.ts. docs/workflow-engine.md ("Spec lock") is the reference.
//
// Every function here returns a value and never throws. Reasons are fixed text, so they never
// echo a value from the state file.

import type { Approval } from './spec-detect';
import { isFeatureSlug, SPECS_DIR } from './spec-docs';

/** The state file's name, under docs/specs/. */
export const SPEC_STATE_FILE = '.sdd-state.json';

/** The state file's path, relative to the project root. */
export const SPEC_STATE_PATH = `${SPECS_DIR}/${SPEC_STATE_FILE}`;

/** The one version this build reads and writes. */
export const SPEC_STATE_VERSION = 1;

/** The largest state file read, in bytes. A longer file is unreadable. */
export const MAX_SPEC_STATE_BYTES = 4096;

/** The state file's content: which feature is locked, and by what. */
export interface SpecStateFile {
  version: typeof SPEC_STATE_VERSION;
  /** The locked feature's slug. */
  feature: string;
  /** SHA-256 of the locked feature's normalized SPECS.md, 64 lowercase hex characters. */
  sha256: string;
  /** The approval time, ISO 8601 in UTC. */
  approvedAt: string;
  /** True after edit-approved-spec: the spec may be changed and must be approved again. */
  editing: boolean;
}

/** The keys a state file has, sorted. Nothing else is accepted. */
const SPEC_STATE_KEYS = ['approvedAt', 'editing', 'feature', 'sha256', 'version'] as const;

export type SpecStateParse =
  | { ok: true; state: SpecStateFile }
  | { ok: false; problem: 'malformed' | 'wrong-version' | 'invalid'; reason: string };

const HEX_SHA256 = /^[0-9a-f]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;
const BOM = String.fromCharCode(0xfeff);

function bad(problem: 'malformed' | 'wrong-version' | 'invalid', reason: string): SpecStateParse {
  return { ok: false, problem, reason };
}

/**
 * Parses the state file's text. A file that is not a JSON object is `malformed`; a `version`
 * other than SPEC_STATE_VERSION is `wrong-version`; any other shape problem (a missing or extra
 * key, a bad slug, hash or time, a non-boolean flag) is `invalid`.
 */
export function parseSpecState(text: unknown): SpecStateParse {
  if (typeof text !== 'string') {
    return bad('malformed', 'the state file is not text');
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return bad('malformed', 'the state file is not valid JSON');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return bad('malformed', 'the state file is not a JSON object');
  }
  const record = value as Record<string, unknown>;
  if (Object.hasOwn(record, 'version') && record['version'] !== SPEC_STATE_VERSION) {
    return bad('wrong-version', 'the state file version is not supported');
  }
  const keys = Object.keys(record).sort();
  const sameKeys =
    keys.length === SPEC_STATE_KEYS.length && keys.every((key, i) => key === SPEC_STATE_KEYS[i]);
  if (!sameKeys) {
    return bad(
      'invalid',
      'the state file must have exactly the keys version, feature, sha256, approvedAt and editing',
    );
  }
  const feature = record['feature'];
  if (!isFeatureSlug(feature)) {
    return bad('invalid', 'the feature is not a valid slug');
  }
  const sha256 = record['sha256'];
  if (typeof sha256 !== 'string' || !HEX_SHA256.test(sha256)) {
    return bad('invalid', 'the hash is not 64 lowercase hex characters');
  }
  const approvedAt = record['approvedAt'];
  if (
    typeof approvedAt !== 'string' ||
    !ISO_UTC.test(approvedAt) ||
    Number.isNaN(Date.parse(approvedAt))
  ) {
    return bad('invalid', 'approvedAt is not an ISO 8601 time in UTC');
  }
  const editing = record['editing'];
  if (typeof editing !== 'boolean') {
    return bad('invalid', 'editing is not a boolean');
  }
  return {
    ok: true,
    state: { version: SPEC_STATE_VERSION, feature, sha256, approvedAt, editing },
  };
}

/** Writes the state file's text: 2-space JSON in a fixed key order, with a trailing newline. */
export function serializeSpecState(state: SpecStateFile): string {
  const ordered = {
    version: state.version,
    feature: state.feature,
    sha256: state.sha256,
    approvedAt: state.approvedAt,
    editing: state.editing,
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/** The text the hash is taken over: one leading U+FEFF dropped, every CRLF turned into LF. */
export function normalizeSpecText(text: string): string {
  const withoutBom = text.startsWith(BOM) ? text.slice(BOM.length) : text;
  return withoutBom.replace(/\r\n/g, '\n');
}

/**
 * The approval of one feature, from the lock and the hash of its SPECS.md.
 * `lock` is the parsed state file, `null` when there is no file, or `'unreadable'` when the file
 * is unreadable, oversized, a symbolic link or invalid. `currentHash` is the hash of the feature's
 * SPECS.md, or null when the file is missing or cannot be read.
 *
 * - `unchecked` when the lock is unreadable, or the feature is locked and its hash is null;
 * - `none` when there is no lock, or the lock names another feature (or no feature is given);
 * - `changed` when the lock is in editing, or the hash differs from the lock's;
 * - `approved` otherwise.
 */
export function approvalFor(
  lock: SpecStateFile | null | 'unreadable',
  feature: string | null,
  currentHash: string | null,
): Approval {
  if (lock === 'unreadable') {
    return 'unchecked';
  }
  if (lock === null || feature === null || lock.feature !== feature) {
    return 'none';
  }
  if (currentHash === null) {
    return 'unchecked';
  }
  if (lock.editing || currentHash !== lock.sha256) {
    return 'changed';
  }
  return 'approved';
}

// The line-ending of a text: CRLF when it has any CRLF, else LF.
function lineEnding(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

// A `---` line of a frontmatter block, with an optional trailing CR.
function isDelimiter(line: string): boolean {
  return /^---[ \t]*\r?$/.test(line);
}

/**
 * Sets the frontmatter `status:` of a SPECS.md, as the plugin's set_status does. The `status:`
 * line inside the leading `---` block is replaced; when the block has none, one is added before
 * the closing `---`. A file with no closed frontmatter gets a new block at the top. The file's
 * line endings and a leading byte order mark are kept.
 */
export function setFrontmatterStatus(text: string, value: string): string {
  const bom = text.startsWith(BOM) ? BOM : '';
  const body = text.slice(bom.length);
  const eol = lineEnding(body);
  const cr = eol === '\r\n' ? '\r' : '';
  const lines = body.split('\n');

  if (lines.length > 0 && isDelimiter(lines[0] ?? '')) {
    const close = lines.findIndex((line, index) => index > 0 && isDelimiter(line));
    if (close > 0) {
      const statusIndex = lines.findIndex(
        (line, index) => index > 0 && index < close && /^status:/.test(line),
      );
      if (statusIndex >= 0) {
        const old = lines[statusIndex] ?? '';
        lines[statusIndex] = `status: ${value}${old.endsWith('\r') ? '\r' : ''}`;
      } else {
        lines.splice(close, 0, `status: ${value}${cr}`);
      }
      return bom + lines.join('\n');
    }
  }
  return `${bom}---${eol}status: ${value}${eol}---${eol}${body}`;
}

/** True when the text has both a `## Goals` and an `## Acceptance criteria` heading line. */
export function hasRequiredHeadings(text: string): boolean {
  const body = normalizeSpecText(text);
  return /^## Goals[ \t]*$/m.test(body) && /^## Acceptance criteria[ \t]*$/m.test(body);
}
