// The build documents of the build loop (p3-build-loop, D37): the text of build-ledger.md and
// SUMMARY.md, in the formats that parseLedger (spec-docs.ts) and detectFolder (spec-detect.ts)
// read, and that the sdd plugin uses. Pure, shared code: it imports only types from ./build-reports
// and no Node, Electron or DOM API. Main writes the text with writeAtomic (spec-lock.ts).
//
// Free text is flattened to one line, and table cells escape their pipes. So no value can start a
// line that the ledger reads as a label.

import type { FindingRow, ImplementationReport, ReviewFinding } from './build-reports';

/** The turn caps the job runner gives each job; the ledger header states them. */
export const TURN_CAPS = { writer: 40, reviewer: 20 } as const;

/** The ledger's `state:` word. */
export type LedgerWord = 'running' | 'paused-for-revision' | 'done';

/** How a finished build ended, as SUMMARY.md's Outcome line names it. */
export type Outcome = 'Clean' | 'Open issues remain' | 'Stopped by the user';

/** One reviewer review, with the writer's decisions on its findings once they are analysed. */
export interface LedgerReview {
  verdict: 'PASS' | 'ISSUES';
  findings: ReviewFinding[];
  /** The writer's decisions on these findings; empty until the writer has analysed them. */
  decisions: FindingRow[];
  runtimeNotes: string[];
}

/** One section of the ledger, in the order the build made them. */
export type LedgerEntry =
  | { kind: 'implementation'; revision: number; mode: 1 | 3; report: ImplementationReport | null }
  | { kind: 'round'; revision: number; round: number; review: LedgerReview }
  | { kind: 'change'; u: number; items: string[]; review: LedgerReview };

/** A spec problem that paused the build, and how the person settled it ('' while open). */
export interface SpecProblem {
  revision: number;
  /** The step that raised it, such as "writer, Mode 1" or "reviewer, round 2". */
  step: string;
  problem: string;
  resolution: string;
}

/** Everything the two documents show about one feature's build. */
export interface BuildState {
  feature: string;
  ticket: string;
  /** The date of the summary, as YYYY-MM-DD. */
  date: string;
  state: LedgerWord;
  /** The outcome of a finished build; null while it runs. Used by SUMMARY.md only. */
  outcome: Outcome | null;
  revision: number;
  resumeOnApprove: boolean;
  round: number;
  limit: number;
  phase: 'implementing' | 'reviewing' | '';
  models: { writer: string; reviewer: string };
  entries: LedgerEntry[];
  specProblems: SpecProblem[];
  /** Findings the next step still has to address, carried from a paused step. */
  carried: ReviewFinding[];
  /** The open issues the summary lists: the last review's findings, or the reason the build ended. */
  openIssues: string[];
}

/** Flattens free text to one trimmed line. */
function line(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, ' ').trim();
}

/** A table cell: one line, with pipes escaped. */
function cell(text: string): string {
  return line(text).replace(/\|/g, '\\|');
}

function taskList(ids: string[]): string {
  return ids.length === 0 ? 'none' : ids.map(line).join(', ');
}

function implementationSection(entry: Extract<LedgerEntry, { kind: 'implementation' }>): string[] {
  const head = `## Implementation, revision ${entry.revision} (Mode ${entry.mode})`;
  const report = entry.report;
  if (report === null) {
    return [head, '', 'The report could not be read.'];
  }
  return [
    head,
    '',
    `- Tasks completed: ${taskList(report.completed)}`,
    `- Tasks not completed: ${taskList(report.notCompleted)}`,
    `- Deviations or concerns: ${line(report.concerns) || 'none'}`,
    ...report.specProblems.map((problem) => `- Spec problem: "${line(problem)}"`),
  ];
}

/** A review section: its heading, then the findings table with the writer's decisions. */
function reviewSection(head: string, review: LedgerReview, itemLines: string[]): string[] {
  const out = [head, '', ...itemLines];
  if (itemLines.length > 0) {
    out.push('');
  }
  if (review.findings.length === 0) {
    out.push('No findings.');
    return out;
  }
  out.push(
    '| Finding | Severity | Location | Implementor decision | Reasoning | Action |',
    '| --- | --- | --- | --- | --- | --- |',
  );
  for (const finding of review.findings) {
    const decision = review.decisions.find((row) => row.finding === finding.id);
    out.push(
      `| ${cell(finding.id)} | ${cell(finding.severity)} | ${cell(finding.location)} | ` +
        `${decision ? cell(decision.decision) : 'not analysed'} | ` +
        `${decision ? cell(decision.reasoning) : ''} | ${decision ? cell(decision.action) : ''} |`,
    );
  }
  return out;
}

function entrySection(entry: LedgerEntry): string[] {
  if (entry.kind === 'implementation') {
    return implementationSection(entry);
  }
  if (entry.kind === 'round') {
    return reviewSection(
      `## Revision ${entry.revision}, round ${entry.round} (${entry.review.verdict})`,
      entry.review,
      [],
    );
  }
  const items = entry.items.map((item, index) => `- U${entry.u}-${index + 1}: ${line(item)}`);
  return reviewSection(
    `## User-requested change round U${entry.u} (${entry.review.verdict})`,
    entry.review,
    items,
  );
}

function specProblemLine(problem: SpecProblem): string {
  const resolution = problem.resolution === '' ? '' : ` (${line(problem.resolution)})`;
  return `- revision ${problem.revision}, ${line(problem.step)}: "${line(problem.problem)}"${resolution}`;
}

function carriedLine(finding: ReviewFinding): string {
  return `- ${line(finding.id)} (${line(finding.severity)}, ${line(finding.location)}): ${line(finding.problem)}`;
}

/** build-ledger.md: the header lines the detector reads, then one section per step. */
export function renderLedger(state: BuildState): string {
  const out = [
    `# Build ledger: ${line(state.feature)}`,
    '',
    `state: ${state.state}`,
    `revision: ${state.revision}`,
    `resume on approve: ${state.resumeOnApprove ? 'yes' : 'no'}`,
    `current round: ${state.round} of ${state.limit}, in revision ${state.revision}`,
    `phase: ${state.phase}`,
    `Writer: ${line(state.models.writer)}    Reviewer: ${line(state.models.reviewer)}`,
    `Turn caps: writer ${TURN_CAPS.writer}, reviewer ${TURN_CAPS.reviewer}`,
  ];
  for (const entry of state.entries) {
    out.push('', ...entrySection(entry));
  }
  out.push('', '## Spec problems', '');
  out.push(
    ...(state.specProblems.length === 0 ? ['none'] : state.specProblems.map(specProblemLine)),
  );
  out.push('', '## Carried findings', '');
  out.push(...(state.carried.length === 0 ? ['none'] : state.carried.map(carriedLine)));
  return `${out.join('\n')}\n`;
}

/** The changes.md table rows, copied as they are; null when there are none to copy. */
function changeRows(changesText: string | null): string[] | null {
  if (changesText === null) {
    return null;
  }
  const rows = changesText
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((text) => text.trim().startsWith('|'))
    .map((text) => text.trim());
  return rows.length === 0 ? null : rows;
}

/** The short text of each entry, for the review ledger and the rejected findings. */
function reviewName(entry: Extract<LedgerEntry, { kind: 'round' | 'change' }>): string {
  return entry.kind === 'round'
    ? `revision ${entry.revision}, round ${entry.round}`
    : `user-requested change round U${entry.u}`;
}

/** SUMMARY.md: the header lines, then the sections the plugin's summary has, in order. */
export function renderSummary(state: BuildState, changesText: string | null): string {
  const reviews = state.entries.filter(
    (entry): entry is Extract<LedgerEntry, { kind: 'round' | 'change' }> =>
      entry.kind !== 'implementation',
  );
  const roundCount = reviews.filter((entry) => entry.kind === 'round').length;
  const changeCount = reviews.length - roundCount;
  const outcome = state.outcome ?? 'Open issues remain';
  const built = state.entries.filter(
    (entry): entry is Extract<LedgerEntry, { kind: 'implementation' }> =>
      entry.kind === 'implementation',
  );
  const runtimeNotes = reviews.flatMap((entry) => entry.review.runtimeNotes);
  const rejected = reviews.flatMap((entry) =>
    entry.review.decisions
      .filter((row) => row.decision === 'REJECT')
      .map((row) => `- ${cell(row.finding)} (${reviewName(entry)}): ${line(row.reasoning)}`),
  );
  const rows = changeRows(changesText);
  const next =
    outcome === 'Clean'
      ? 'Approve the result to commit and push the branch, or request changes.'
      : outcome === 'Stopped by the user'
        ? 'Revise the spec, or start a new build.'
        : 'Review the open issues, then request changes or approve the result.';
  const listOrNone = (items: string[]): string[] => (items.length === 0 ? ['none'] : items);

  const out = [
    `# Summary: ${line(state.feature)}`,
    '',
    `Ticket: ${line(state.ticket) || 'none'}`,
    `Date: ${line(state.date)}`,
    `Outcome: ${outcome}`,
    `Review rounds: ${roundCount}, change rounds: ${changeCount}`,
    `Models: writer ${line(state.models.writer)}, reviewer ${line(state.models.reviewer)}`,
    '',
    '## What was built',
    '',
    ...listOrNone(
      built.map((entry) =>
        entry.report === null
          ? `- Revision ${entry.revision} (Mode ${entry.mode}): the report could not be read.`
          : `- Revision ${entry.revision} (Mode ${entry.mode}): completed ${taskList(entry.report.completed)}.`,
      ),
    ),
    '',
    '## Files changed',
    '',
    ...(rows ?? ['not recorded']),
    '',
    '## Acceptance criteria',
    '',
    'The reviewer checked the acceptance criteria of SPECS.md in each review round. The results are in the review ledger.',
    '',
    '## Needs a runtime check',
    '',
    ...listOrNone(runtimeNotes.map((note) => `- ${line(note)}`)),
    '',
    '## Review ledger',
    '',
    ...listOrNone(
      reviews.map(
        (entry) =>
          `- ${reviewName(entry)}: ${entry.review.verdict}, ${entry.review.findings.length} finding(s).`,
      ),
    ),
    '',
    '## Spec revisions',
    '',
    ...listOrNone(state.specProblems.map(specProblemLine)),
    '',
    '## Rejected findings',
    '',
    ...listOrNone(rejected),
    '',
    '## Open issues',
    '',
    ...listOrNone(state.openIssues.map((issue) => `- ${line(issue)}`)),
    '',
    '## Git state',
    '',
    'uncommitted; the app commits after the result is approved',
    '',
    '## Next steps',
    '',
    `- ${next}`,
  ];
  return `${out.join('\n')}\n`;
}
