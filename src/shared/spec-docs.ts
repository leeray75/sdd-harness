// The sdd document layer, shared part (p3-spec-docs, D35): the plugin's four document templates
// (v0.18.0) with a fill function, the docs/specs layout and path helpers, and the parsers for
// PLAN.md, SPECS.md, tasks.md and build-ledger.md. Shared code, so it imports only from src/shared/
// and no Node, Electron or DOM API. Every parser takes the file text, or null when the file is
// absent, and returns a result with a list of problems. None of them throws.
// docs/workflow-engine.md ("Document layer") is the reference for this module.

import { FEATURE_SLUG_PATTERN, MAX_FEATURE_LENGTH } from './human-actions';

// ---------------------------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------------------------

// The four templates of the sdd plugin (v0.18.0), verbatim. The copies they are checked against
// are in tests/fixtures/sdd-plugin/templates/ (see its README). Do not edit the text here.
export const TEMPLATES = {
  plan: `# Plan: <Feature name>

Ticket: <STORY-ID> (<story title>)
Status: draft
Date: <YYYY-MM-DD>

## Objective

<What the story asks for and why, in two to four sentences, in your own words.>

## Scope

- **In:** <what this work covers>
- **Out:** <what it deliberately does not cover>

## Decisions

<One row per question the user answered. Record the choice AND the options not taken.>

| Question | Decision | Alternatives considered |
| --- | --- | --- |
| <e.g. Base branch> | <choice> | <others> |

## Approach

<How the work will be done: components touched, order of work, notable constraints.
Name files and modules you verified exist.>

## Verified assumptions

<Each load-bearing assumption with the evidence that checked it (path:line, command
output). Anything you could not verify belongs in Decisions (ask) or Open questions.>

| Assumption | Evidence |
| --- | --- |
| <assumption> | <path:line or command output> |

## Risks

- <risk, and what would reveal it early>

## Open questions

<Only non-blocking questions the user explicitly deferred. Empty if none.>
`,
  specs: `---
status: draft
ticket:
---

# <Feature name>

## Problem

<What is wrong or missing today, and for whom. Two to four sentences.>

## Goals

- **G1:** <A concrete outcome the work must deliver.>

## Non-goals

- <Something a reader might expect but this work will not do.>

## Acceptance criteria

- **AC1:** <An observable, testable statement of done.>

## Open questions

- <Anything undecided. Leave empty if none.>
`,
  tasks: `# Tasks: <feature>

Work in order. After each task, run its check, then tick the box.

- [ ] **T1 — <Short title>.** <What to do.> **Check:** <One-line command or observation that proves it.>
- [ ] **T2 — <Short title>.** <What to do.> **Check:** <One-line check.>
`,
  subtask: `# <Child ticket title: the feature, in one line>

**Parent:** <parent ticket id, or "none: no parent chosen">
**Spec:** docs/specs/<feature>/SPECS.md
**Repo and base branch:** <repo, base branch>, feature branch <feature branch>

## Context

<Two to four sentences: the problem and the goal, taken from the approved spec's Problem and
Goals sections. Do not add scope the spec does not contain.>

## Required work

<The tasks from tasks.md, in order, one line each: "T1 <title>", "T2 <title>", and so on.
Copy the wording; do not reword it.>

## Acceptance criteria

<Copy the spec's acceptance criteria as written, one per line, with their AC ids.>

## Out of scope

<Copy the spec's Non-goals.>

## Links

- Plan: docs/specs/<feature>/PLAN.md
- Spec and tasks: docs/specs/<feature>/SPECS.md, docs/specs/<feature>/tasks.md
`,
} as const;

/** The kinds of template: the names of TEMPLATES. */
export type TemplateKind = keyof typeof TEMPLATES;

/** The fields the fill function takes. `feature` is required; the others are optional. */
export interface FillFields {
  /** The feature slug (required). Fills `<feature>`, and `<Feature name>` when no title is given. */
  feature: string;
  /** Fills `<Feature name>`; defaults to `feature`. */
  title?: string;
  /** Fills `<STORY-ID>`. */
  ticket?: string;
  /** Fills `<story title>`. */
  storyTitle?: string;
  /** Fills `<YYYY-MM-DD>`. */
  date?: string;
}

export type FillResult = { ok: true; text: string } | { ok: false; reason: string };

// The five placeholders the harness knows. Every other `<...>` is guidance for the writer.
const PLACEHOLDER = /<Feature name>|<feature>|<STORY-ID>|<story title>|<YYYY-MM-DD>/g;

/**
 * Fills a template. Each of the five known placeholders is replaced everywhere it appears, in one
 * pass, so a value that itself contains a placeholder is not replaced again. An optional field
 * that is missing, or an empty string, leaves its placeholder in the text (`<Feature name>` falls
 * back to the feature). A feature slug that fails validation gives an error result; nothing is
 * thrown.
 */
export function fillTemplate(kind: unknown, fields: FillFields): FillResult {
  if (typeof kind !== 'string' || !Object.hasOwn(TEMPLATES, kind)) {
    return { ok: false, reason: 'unknown template kind' };
  }
  if (typeof fields !== 'object' || fields === null) {
    return { ok: false, reason: 'the fields must be an object' };
  }
  if (!isFeatureSlug(fields.feature)) {
    return { ok: false, reason: 'the feature is not a valid slug' };
  }
  const optional = [fields.title, fields.ticket, fields.storyTitle, fields.date];
  if (optional.some((value) => value !== undefined && typeof value !== 'string')) {
    return { ok: false, reason: 'the optional fields must be strings' };
  }
  const values = new Map<string, string>([
    ['<feature>', fields.feature],
    ['<Feature name>', fields.title || fields.feature],
  ]);
  if (fields.ticket) values.set('<STORY-ID>', fields.ticket);
  if (fields.storyTitle) values.set('<story title>', fields.storyTitle);
  if (fields.date) values.set('<YYYY-MM-DD>', fields.date);
  const text = TEMPLATES[kind as TemplateKind].replace(
    PLACEHOLDER,
    (match) => values.get(match) ?? match,
  );
  return { ok: true, text };
}

// ---------------------------------------------------------------------------------------------
// Layout and paths
// ---------------------------------------------------------------------------------------------

/** The folder of feature folders, relative to the project root. */
export const SPECS_DIR = 'docs/specs';

/** The file names a feature folder can hold, as the plugin and the harness write them. */
export const SPEC_FILES = [
  'PLAN.md',
  'SPECS.md',
  'tasks.md',
  'SUBTASK.md',
  'build-ledger.md',
  'changes.md',
  'SUMMARY.md',
] as const;

export type SpecFileName = (typeof SPEC_FILES)[number];

/** True when `value` is a feature slug: a string of at most MAX_FEATURE_LENGTH matching the pattern. */
export function isFeatureSlug(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_FEATURE_LENGTH &&
    FEATURE_SLUG_PATTERN.test(value)
  );
}

/**
 * The path of one known file of one feature, as `docs/specs/<feature>/<file>` (POSIX form, relative
 * to the project root). Null for a feature that is not a valid slug, a file name that is not in
 * SPEC_FILES (so no traversal, separators or absolute paths), or a value that is not a string.
 */
export function specFilePath(feature: unknown, file: unknown): string | null {
  if (!isFeatureSlug(feature)) return null;
  if (typeof file !== 'string' || !(SPEC_FILES as readonly string[]).includes(file)) return null;
  return `${SPECS_DIR}/${feature}/${file}`;
}

// ---------------------------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------------------------

/** The build's step as the ledger's `phase:` line names it; '' when absent or empty. */
export type Phase = 'implementing' | 'reviewing' | '';

export interface PlanFile {
  present: boolean;
  /** The first `Status:` value, '' when absent. */
  status: string;
  problems: string[];
}

export interface SpecsFile {
  present: boolean;
  /** The frontmatter `status`, '' when absent. */
  status: string;
  /** The frontmatter `ticket`, '' when empty or absent. */
  ticket: string;
  problems: string[];
}

export interface TasksFile {
  present: boolean;
  /** Checked boxes (`- [x]`), counted the way the plugin counts them. */
  checked: number;
  /** Open boxes (`- [ ]`). */
  open: number;
  problems: string[];
}

export interface LedgerFile {
  present: boolean;
  /** The `state:` word, '' when absent. */
  state: string;
  /** The `revision:` number, null when absent or not a number. */
  revision: number | null;
  /** True only for `resume on approve: yes`. */
  resumeOnApprove: boolean;
  /** The `current round:` number, null when absent or not a number. */
  currentRound: number | null;
  phase: Phase;
  problems: string[];
}

// The byte order mark some editors write at the start of a file, as a character code.
const BOM = String.fromCharCode(0xfeff);

// Each parser reads the text with the byte order mark dropped and CRLF turned into LF, so the same
// rules hold for a Windows checkout.
function plain(text: string): string {
  const withoutBom = text.startsWith(BOM) ? text.slice(BOM.length) : text;
  return withoutBom.replace(/\r\n/g, '\n');
}

function firstValue(text: string, pattern: RegExp): string | null {
  const match = pattern.exec(text);
  return match ? (match[1] ?? '') : null;
}

/** The leading number of a value (`1`, or `1 of 3` gives 1), or null when it does not start with one. */
function leadingNumber(value: string): number | null {
  const match = /^\d+/.exec(value.trim());
  return match ? Number(match[0]) : null;
}

// numberLine: the number on a `label:` line of the ledger, or null. A line that does not start
// with a number is a problem.
function numberLine(body: string, label: string, problems: string[]): number | null {
  const value = firstValue(body, new RegExp(`^${label}:[ \\t]*(.*)$`, 'm'));
  if (value === null) return null;
  const number = leadingNumber(value);
  if (number === null) problems.push(`the ${label} is not a number`);
  return number;
}

/** Parses PLAN.md: the first `Status:` line. */
export function parsePlan(text: string | null): PlanFile {
  if (typeof text !== 'string') return { present: false, status: '', problems: [] };
  const status = firstValue(plain(text), /^Status:[ \t]*(.*?)[ \t]*$/m);
  if (status === null) return { present: true, status: '', problems: ['no Status line'] };
  return {
    present: true,
    status,
    problems: status === '' ? ['the Status line is empty'] : [],
  };
}

/** Parses SPECS.md: the `status` and `ticket` lines of the frontmatter, between two `---` lines. */
export function parseSpecs(text: string | null): SpecsFile {
  if (typeof text !== 'string') return { present: false, status: '', ticket: '', problems: [] };
  const body = plain(text);
  if (!/^---[ \t]*(\n|$)/.test(body)) {
    return { present: true, status: '', ticket: '', problems: ['no frontmatter'] };
  }
  const rest = body.replace(/^---[ \t]*(\n|$)/, '');
  const end = rest.search(/^---[ \t]*$/m);
  if (end < 0) {
    return { present: true, status: '', ticket: '', problems: ['unterminated frontmatter'] };
  }
  const front = rest.slice(0, end);
  const status = firstValue(front, /^status:[ \t]*(.*?)[ \t]*$/m);
  const ticket = firstValue(front, /^ticket:[ \t]*(.*?)[ \t]*$/m) ?? '';
  if (status === null) {
    return { present: true, status: '', ticket, problems: ['no status in the frontmatter'] };
  }
  return {
    present: true,
    status,
    ticket,
    problems: status === '' ? ['the frontmatter status is empty'] : [],
  };
}

/** Parses tasks.md: checked and open checkbox lines, counted as the plugin counts them. */
export function parseTasks(text: string | null): TasksFile {
  if (typeof text !== 'string') return { present: false, checked: 0, open: 0, problems: [] };
  const body = plain(text);
  const checked = (body.match(/^[ \t]*- \[[xX]\]/gm) ?? []).length;
  const open = (body.match(/^[ \t]*- \[ \]/gm) ?? []).length;
  return {
    present: true,
    checked,
    open,
    problems: checked + open === 0 ? ['no checkbox lines'] : [],
  };
}

/**
 * Parses build-ledger.md: `state:`, `revision:`, `resume on approve:` (yes or no), `current round:`
 * and `phase:` (implementing, reviewing or empty). A value that is present but malformed is
 * reported in `problems` and read as absent.
 */
export function parseLedger(text: string | null): LedgerFile {
  if (typeof text !== 'string') {
    return {
      present: false,
      state: '',
      revision: null,
      resumeOnApprove: false,
      currentRound: null,
      phase: '',
      problems: [],
    };
  }
  const body = plain(text);
  const problems: string[] = [];

  const stateMatch = /^state:[ \t]*([a-z-]*)/m.exec(body);
  if (!stateMatch) problems.push('no state line');
  else if ((stateMatch[1] ?? '') === '') problems.push('the state line is empty');
  const state = stateMatch?.[1] ?? '';

  const revision = numberLine(body, 'revision', problems);
  const currentRound = numberLine(body, 'current round', problems);

  let resumeOnApprove = false;
  const resume = firstValue(body, /^resume on approve:[ \t]*(.*)$/m);
  if (resume !== null) {
    const word = (resume.trim().split(/\s/)[0] ?? '').toLowerCase();
    if (word === 'yes') resumeOnApprove = true;
    else if (word !== 'no') problems.push('resume on approve is not yes or no');
  }

  let phase: Phase = '';
  const phaseWord = firstValue(body, /^phase:[ \t]*([a-z]*)/m) ?? '';
  if (phaseWord === 'implementing' || phaseWord === 'reviewing') phase = phaseWord;
  else if (phaseWord !== '') problems.push('the phase is not implementing or reviewing');

  return { present: true, state, revision, resumeOnApprove, currentRound, phase, problems };
}
