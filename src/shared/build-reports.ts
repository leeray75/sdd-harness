// The report parsers of the build loop (p3-build-loop, D37). They read the three reports that the
// writer and the reviewer return in the formats of src/agent/jobs/writer.ts and reviewer.ts, and
// return either the parsed report or a fixed reason. Pure, shared code: it imports nothing, and no
// Node, Electron or DOM API. Every parser returns a value and never throws.
//
// Text is read as LF, and text before a report's heading is ignored. Each kept text is capped at
// TEXT_CAP characters, and each finding or row list at LIST_CAP entries. Reasons are fixed text,
// so they never echo the report.

export type ParseResult<T> = { ok: true; report: T } | { ok: false; reason: string };

/** Longest text the parsers keep, in characters. */
export const TEXT_CAP = 2000;
/** Most entries the parsers keep in one list. */
export const LIST_CAP = 50;

export interface ImplementationReport {
  /** Task ids the writer completed. */
  completed: string[];
  /** Task ids the writer did not complete. */
  notCompleted: string[];
  concerns: string;
  /** Every line or bullet of the report that holds NEEDS-SPEC-CHANGE, with its text. */
  specProblems: string[];
}

export type Decision = 'ACCEPT' | 'REJECT' | 'NEEDS-SPEC-CHANGE';

export interface FindingRow {
  finding: string;
  decision: Decision;
  reasoning: string;
  action: string;
}

export interface FindingsAnalysis {
  /** The round in the heading, or null when the heading names no round. */
  round: number | null;
  rows: FindingRow[];
  /** The rows whose decision is NEEDS-SPEC-CHANGE. */
  specProblems: FindingRow[];
}

export type Severity = 'blocker' | 'major' | 'minor';

export interface ReviewFinding {
  id: string;
  type: 'defect' | 'spec-change';
  severity: Severity;
  location: string;
  problem: string;
  evidence: string;
  suggestedFix: string;
  /** The quoted spec line of a spec-change finding; null for a defect. */
  specLine: string | null;
}

export interface ReviewReport {
  /** The round number, or the string U<k> of a change round. */
  round: number | string;
  verdict: 'PASS' | 'ISSUES';
  summary: string;
  findings: ReviewFinding[];
  runtimeNotes: string[];
}

const DECISIONS: readonly Decision[] = ['ACCEPT', 'REJECT', 'NEEDS-SPEC-CHANGE'];
const SEVERITIES: readonly Severity[] = ['blocker', 'major', 'minor'];
// A change round's label is U<k> (revision 1): the analysis may name it, and the review heading uses it.
const FINDINGS_HEADING = /^## Findings analysis(?: \(round (\d+|U\d+)\))?$/;
const REVIEW_HEADING = /^## Review round (\d+|U\d+)$/;

function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

function cap(text: string): string {
  return text.trim().slice(0, TEXT_CAP);
}

function capList(items: string[]): string[] {
  return items.slice(0, LIST_CAP).map(cap);
}

/** The text as lines, with CRLF and CR read as LF. */
function linesOf(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

/** The index of the first line whose trimmed text matches, or -1. */
function indexOfHeading(all: string[], pattern: RegExp): number {
  return all.findIndex((line) => pattern.test(line.trim()));
}

/** The lines after the heading at `start`, up to the first line matching `stop`. */
function sectionFrom(all: string[], start: number, stop: RegExp): string[] {
  const rest = all.slice(start + 1);
  const end = rest.findIndex((line) => stop.test(line));
  return end === -1 ? rest : rest.slice(0, end);
}

/** The cells of a table row, or null when the line is not a row. Escaped pipes stay in the cell. */
function cellsOf(line: string): string[] | null {
  let inner = line.trim();
  if (!inner.startsWith('|')) {
    return null;
  }
  inner = inner.slice(1);
  if (inner.endsWith('|') && !inner.endsWith('\\|')) {
    inner = inner.slice(0, -1);
  }
  return inner.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.every((cell) => /^:?-+:?$/.test(cell));
}

/** The text after the first occurrence of a label on a line. */
function afterLabel(line: string, label: string): string {
  return line.slice(line.indexOf(label) + label.length);
}

/** The task ids of a line: every T<number> token. */
function taskIds(text: string): string[] {
  return text.match(/\bT\d+\b/g) ?? [];
}

/** The task ids that open each comma-separated item, so a reason can name other tasks. */
function leadingTaskIds(text: string): string[] {
  const ids: string[] = [];
  for (const item of text.split(',')) {
    const match = /^\s*(T\d+)\b/.exec(item);
    if (match) {
      ids.push(match[1] ?? '');
    }
  }
  return ids;
}

/**
 * Parses the writer's Implementation report. The heading is required, and so are the two task
 * lists. Everything else is optional; concerns is the text from its label to the end.
 */
export function parseImplementationReport(text: string): ParseResult<ImplementationReport> {
  try {
    const all = linesOf(text);
    const at = indexOfHeading(all, /^## Implementation report$/);
    if (at === -1) {
      return fail('the report has no Implementation report heading');
    }
    const body = sectionFrom(all, at, /^## /);
    const completedLine = body.find((line) => line.includes('Tasks completed:'));
    const notLine = body.find((line) => line.includes('Tasks not completed:'));
    if (completedLine === undefined || notLine === undefined) {
      return fail('the report has no task lists');
    }
    const completedPart = afterLabel(completedLine, 'Tasks completed:').split(
      /-?\s*Tasks not completed:/,
    )[0];
    const notPart = afterLabel(notLine, 'Tasks not completed:');
    const concernsAt = body.findIndex((line) => line.includes('Deviations or concerns:'));
    const concerns =
      concernsAt === -1
        ? ''
        : cap(
            [
              afterLabel(body[concernsAt] ?? '', 'Deviations or concerns:'),
              ...body.slice(concernsAt + 1),
            ].join('\n'),
          );
    const specProblems = body
      .filter((line) => line.includes('NEEDS-SPEC-CHANGE'))
      .map((line) => line.trim().replace(/^-\s*/, ''));
    return {
      ok: true,
      report: {
        completed: [...new Set(taskIds(completedPart ?? ''))],
        notCompleted: [...new Set(leadingTaskIds(notPart))],
        concerns,
        specProblems: capList(specProblems),
      },
    };
  } catch {
    return fail('the report could not be read');
  }
}

/** Reads one table row into its four cells, or returns a fixed reason when it is not four. */
function analysisRow(line: string): ParseResult<FindingRow> {
  const cells = cellsOf(line);
  if (cells === null || cells.length !== 4) {
    return fail('a row does not have four cells');
  }
  const decision = (cells[1] ?? '').replace(/[*`]/g, '').trim();
  if (!DECISIONS.includes(decision as Decision)) {
    return fail('a row has an unknown decision');
  }
  return {
    ok: true,
    report: {
      finding: cap(cells[0] ?? ''),
      decision: decision as Decision,
      reasoning: cap(cells[2] ?? ''),
      action: cap(cells[3] ?? ''),
    },
  };
}

/**
 * Parses the writer's Findings analysis. The heading may name a round, and the table must have
 * the Finding and Decision columns, four cells per row, and a decision of ACCEPT, REJECT or
 * NEEDS-SPEC-CHANGE on every row.
 */
export function parseFindingsAnalysis(text: string): ParseResult<FindingsAnalysis> {
  try {
    const all = linesOf(text);
    const at = indexOfHeading(all, FINDINGS_HEADING);
    if (at === -1) {
      return fail('the analysis has no Findings analysis heading');
    }
    const roundText = FINDINGS_HEADING.exec(all[at]?.trim() ?? '')?.[1];
    // A U<k> label is a change round, which has no number, so the round is null.
    const round = roundText === undefined || !/^\d+$/.test(roundText) ? null : Number(roundText);
    const body = sectionFrom(all, at, /^## /);
    const headerAt = body.findIndex((line) => {
      const cells = cellsOf(line);
      return cells !== null && cells[0] === 'Finding' && cells[1] === 'Decision';
    });
    if (headerAt === -1) {
      return fail('the analysis has no table');
    }
    const rows: FindingRow[] = [];
    for (const line of body.slice(headerAt + 1)) {
      if (!line.trim().startsWith('|')) {
        break;
      }
      const cells = cellsOf(line);
      if (cells !== null && isSeparatorRow(cells)) {
        continue;
      }
      const row = analysisRow(line);
      if (!row.ok) {
        return row;
      }
      rows.push(row.report);
    }
    if (rows.length === 0) {
      return fail('the analysis table has no rows');
    }
    const kept = rows.slice(0, LIST_CAP);
    return {
      ok: true,
      report: {
        round,
        rows: kept,
        specProblems: kept.filter((row) => row.decision === 'NEEDS-SPEC-CHANGE'),
      },
    };
  } catch {
    return fail('the analysis could not be read');
  }
}

/** Reads one `- id:` block of the Findings list into a finding, or returns a fixed reason. */
function findingOf(fields: Map<string, string>): ParseResult<ReviewFinding> {
  const get = (key: string): string => fields.get(key) ?? '';
  const type = fields.get('type') ?? 'defect';
  if (type !== 'defect' && type !== 'spec-change') {
    return fail('a finding has an unknown type');
  }
  const severity = get('severity');
  if (!SEVERITIES.includes(severity as Severity)) {
    return fail('a finding has an unknown severity');
  }
  const required = [get('id'), get('location'), get('problem'), get('evidence')];
  const specLine = get('spec line');
  if (
    required.some((value) => value === '') ||
    get('suggested fix') === '' ||
    (type === 'spec-change' && specLine === '')
  ) {
    return fail('a finding is missing a field');
  }
  return {
    ok: true,
    report: {
      id: cap(get('id')),
      type,
      severity: severity as Severity,
      location: cap(get('location')),
      problem: cap(get('problem')),
      evidence: cap(get('evidence')),
      suggestedFix: cap(get('suggested fix')),
      specLine: type === 'spec-change' ? cap(specLine) : null,
    },
  };
}

/**
 * Parses the reviewer's review. It needs the Review round heading and a Verdict line. ISSUES
 * needs at least one finding, and PASS may have none. Runtime notes are optional bullets.
 */
export function parseReview(text: string): ParseResult<ReviewReport> {
  try {
    const all = linesOf(text);
    const at = indexOfHeading(all, REVIEW_HEADING);
    if (at === -1) {
      return fail('the review has no Review round heading');
    }
    // The round is a number, or the string U<k> for a change round.
    const label = REVIEW_HEADING.exec(all[at]?.trim() ?? '')?.[1] ?? '0';
    const round: number | string = /^\d+$/.test(label) ? Number(label) : label;
    const body = sectionFrom(all, at, /^## /);
    const verdictMatch = body
      .map((line) => line.trim())
      .map((line) => /^Verdict:\s*(PASS|ISSUES)$/.exec(line))
      .find((match) => match !== null);
    if (verdictMatch === undefined || verdictMatch === null) {
      return fail('the review has no verdict line');
    }
    const verdict = verdictMatch[1] as ReviewReport['verdict'];
    const summaryLine = body.find((line) => line.trim().startsWith('Summary:'));
    const summary = summaryLine === undefined ? '' : cap(afterLabel(summaryLine, 'Summary:'));

    const findingsAt = body.findIndex((line) => line.trim() === '### Findings');
    const findingLines = findingsAt === -1 ? [] : sectionFrom(body, findingsAt, /^#{2,3} /);
    const blocks: Map<string, string>[] = [];
    for (const line of findingLines) {
      const id = /^- id:\s*(.*)$/.exec(line);
      if (id) {
        blocks.push(new Map([['id', (id[1] ?? '').trim()]]));
        continue;
      }
      const field = /^\s+([a-z][a-z ]*?):\s?(.*)$/i.exec(line);
      const current = blocks[blocks.length - 1];
      if (field && current) {
        current.set((field[1] ?? '').trim().toLowerCase(), (field[2] ?? '').trim());
      }
    }
    const findings: ReviewFinding[] = [];
    for (const block of blocks) {
      const parsed = findingOf(block);
      if (!parsed.ok) {
        return parsed;
      }
      findings.push(parsed.report);
    }
    if (verdict === 'ISSUES' && findings.length === 0) {
      return fail('ISSUES has no findings');
    }
    if (verdict === 'PASS' && findings.length > 0) {
      return fail('PASS has findings');
    }

    const notesAt = body.findIndex((line) => line.trim().startsWith('### Needs a runtime check'));
    const notesLines = notesAt === -1 ? [] : sectionFrom(body, notesAt, /^#{2,3} /);
    const runtimeNotes = notesLines
      .map((line) => /^\s*-\s+(.*)$/.exec(line)?.[1])
      .filter((note): note is string => note !== undefined && note.trim() !== '');

    return {
      ok: true,
      report: {
        round,
        verdict,
        summary,
        findings: findings.slice(0, LIST_CAP),
        runtimeNotes: capList(runtimeNotes),
      },
    };
  } catch {
    return fail('the review could not be read');
  }
}
