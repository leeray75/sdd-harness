import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  LIST_CAP,
  parseFindingsAnalysis,
  parseImplementationReport,
  parseReview,
  TEXT_CAP,
} from '../../src/shared/build-reports';

const IMPLEMENTATION = `Some preamble the writer wrote before the report.

## Implementation report
- Tasks completed: T1, T2   - Tasks not completed: T3 (blocked by the spec)
- Changes file: docs/specs/p3-x/changes.md; rows: 4 (created 1, edited 3, deleted 0, moved 0)
- Checks run: pnpm test -> pass
- Deviations or concerns: NEEDS-SPEC-CHANGE in T3: "the gate allows two files" needs a decision.
`;

const ANALYSIS = `## Findings analysis (round 2)
| Finding | Decision | Reasoning (evidence) | Action taken |
| --- | --- | --- | --- |
| R2-1 | ACCEPT | The loop drops the last reply (loop.ts:160). | Kept the reply. |
| R2-2 | REJECT | Already handled by the gate (gate.ts:44). | None. |
| R2-3 | NEEDS-SPEC-CHANGE | The spec does not say which turn counts. | Left as is. |
Changes file: docs/specs/p3-x/changes.md; rows added or updated this round: 2
Checks run: pnpm test -> pass
`;

const REVIEW_ISSUES = `Some preamble.

## Review round 1
Verdict: ISSUES
Summary: One real defect. One spec problem.
### Findings
- id: R1-1
  severity: major
  location: src/shared/x.ts:12
  problem: the count is off by one
  evidence: the loop at x.ts:12 starts at 1
  suggested fix: start the loop at 0
- id: R1-2
  type: spec-change
  severity: minor
  location: docs/specs/p3-x/SPECS.md:30
  spec line: "the limit is 3 or 4"
  problem: no code can satisfy both values
  evidence: SPECS.md line 30 names two values
  suggested fix: name one value
### Needs a runtime check
- the progress bar moves on a real screen
`;

describe('parseImplementationReport', () => {
  it('reads the two task lists, the concerns and the NEEDS-SPEC-CHANGE lines', () => {
    const result = parseImplementationReport(IMPLEMENTATION);
    expect(result).toEqual({
      ok: true,
      report: {
        completed: ['T1', 'T2'],
        notCompleted: ['T3'],
        concerns: 'NEEDS-SPEC-CHANGE in T3: "the gate allows two files" needs a decision.',
        specProblems: [
          'Deviations or concerns: NEEDS-SPEC-CHANGE in T3: "the gate allows two files" needs a decision.',
        ],
      },
    });
  });

  it('reads CRLF text as LF and ignores the text before the heading', () => {
    const crlf = IMPLEMENTATION.replace(/\n/g, '\r\n').replace(
      'Some preamble the writer wrote before the report.',
      'NEEDS-SPEC-CHANGE in the preamble, which must be ignored.',
    );
    const result = parseImplementationReport(crlf);
    expect(result.ok && result.report.specProblems).toHaveLength(1);
    expect(result.ok && result.report.completed).toEqual(['T1', 'T2']);
  });

  it('reads "none" task lists as empty, and a report with no concerns', () => {
    const result = parseImplementationReport(
      '## Implementation report\n- Tasks completed: none   - Tasks not completed: none\n',
    );
    expect(result).toEqual({
      ok: true,
      report: { completed: [], notCompleted: [], concerns: '', specProblems: [] },
    });
  });

  it('reads task lists written on separate lines', () => {
    const result = parseImplementationReport(
      '## Implementation report\n- Tasks completed: T4, T5\n- Tasks not completed: T6 needs T2\n',
    );
    expect(result).toMatchObject({
      ok: true,
      report: { completed: ['T4', 'T5'], notCompleted: ['T6'] },
    });
  });

  it('stops at the next level-2 heading', () => {
    const result = parseImplementationReport(
      `${IMPLEMENTATION}\n## Notes\nNEEDS-SPEC-CHANGE after the report, not part of it.\n`,
    );
    expect(result.ok && result.report.specProblems).toHaveLength(1);
  });

  it('fails with a fixed reason when the heading or a task list is missing', () => {
    expect(parseImplementationReport('Just prose, no report.')).toEqual({
      ok: false,
      reason: 'the report has no Implementation report heading',
    });
    expect(parseImplementationReport('## Implementation report\n- Checks run: none\n')).toEqual({
      ok: false,
      reason: 'the report has no task lists',
    });
  });

  it('caps the concerns at the text cap', () => {
    const long = 'x'.repeat(TEXT_CAP + 500);
    const result = parseImplementationReport(
      `## Implementation report\n- Tasks completed: none   - Tasks not completed: none\n- Deviations or concerns: ${long}\n`,
    );
    expect(result.ok && result.report.concerns.length).toBe(TEXT_CAP);
  });
});

describe('parseFindingsAnalysis', () => {
  it('reads the round, the rows and the NEEDS-SPEC-CHANGE rows', () => {
    const result = parseFindingsAnalysis(ANALYSIS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.round).toBe(2);
    expect(result.report.rows.map((row) => [row.finding, row.decision])).toEqual([
      ['R2-1', 'ACCEPT'],
      ['R2-2', 'REJECT'],
      ['R2-3', 'NEEDS-SPEC-CHANGE'],
    ]);
    expect(result.report.rows[0]).toEqual({
      finding: 'R2-1',
      decision: 'ACCEPT',
      reasoning: 'The loop drops the last reply (loop.ts:160).',
      action: 'Kept the reply.',
    });
    expect(result.report.specProblems.map((row) => row.finding)).toEqual(['R2-3']);
  });

  it('returns a null round when the heading names none, and reads CRLF', () => {
    const result = parseFindingsAnalysis(
      ANALYSIS.replace('## Findings analysis (round 2)', '## Findings analysis').replace(
        /\n/g,
        '\r\n',
      ),
    );
    expect(result).toMatchObject({ ok: true, report: { round: null } });
  });

  it('keeps an escaped pipe inside a cell and reads bold decisions', () => {
    const result = parseFindingsAnalysis(
      '## Findings analysis (round 1)\n| Finding | Decision | Reasoning (evidence) | Action taken |\n| --- | --- | --- | --- |\n| R1-1 | **ACCEPT** | a \\| b is the rule | fixed |\n',
    );
    expect(result).toMatchObject({
      ok: true,
      report: { rows: [{ decision: 'ACCEPT', reasoning: 'a | b is the rule' }] },
    });
  });

  it('fails on a decision it does not know, a row of the wrong width, or no table', () => {
    const badDecision = ANALYSIS.replace('| ACCEPT |', '| MAYBE |');
    expect(parseFindingsAnalysis(badDecision)).toEqual({
      ok: false,
      reason: 'a row has an unknown decision',
    });
    const narrow = ANALYSIS.replace(
      '| R2-2 | REJECT | Already handled by the gate (gate.ts:44). | None. |',
      '| R2-2 | REJECT | None. |',
    );
    expect(parseFindingsAnalysis(narrow)).toEqual({
      ok: false,
      reason: 'a row does not have four cells',
    });
    expect(parseFindingsAnalysis('## Findings analysis (round 1)\nNo table here.\n')).toEqual({
      ok: false,
      reason: 'the analysis has no table',
    });
    expect(parseFindingsAnalysis('Nothing here.')).toEqual({
      ok: false,
      reason: 'the analysis has no Findings analysis heading',
    });
  });

  it('fails when the table has a header but no rows', () => {
    expect(
      parseFindingsAnalysis(
        '## Findings analysis (round 1)\n| Finding | Decision | Reasoning (evidence) | Action taken |\n| --- | --- | --- | --- |\n',
      ),
    ).toEqual({ ok: false, reason: 'the analysis table has no rows' });
  });

  it('keeps at most LIST_CAP rows', () => {
    const rows = Array.from(
      { length: LIST_CAP + 10 },
      (_, index) => `| R1-${index} | ACCEPT | r | a |`,
    ).join('\n');
    const result = parseFindingsAnalysis(
      `## Findings analysis (round 1)\n| Finding | Decision | Reasoning (evidence) | Action taken |\n| --- | --- | --- | --- |\n${rows}\n`,
    );
    expect(result.ok && result.report.rows).toHaveLength(LIST_CAP);
  });
});

describe('parseReview', () => {
  it('reads ISSUES with a defect and a spec-change finding, and the runtime notes', () => {
    const result = parseReview(REVIEW_ISSUES);
    expect(result).toEqual({
      ok: true,
      report: {
        round: 1,
        verdict: 'ISSUES',
        summary: 'One real defect. One spec problem.',
        findings: [
          {
            id: 'R1-1',
            type: 'defect',
            severity: 'major',
            location: 'src/shared/x.ts:12',
            problem: 'the count is off by one',
            evidence: 'the loop at x.ts:12 starts at 1',
            suggestedFix: 'start the loop at 0',
            specLine: null,
          },
          {
            id: 'R1-2',
            type: 'spec-change',
            severity: 'minor',
            location: 'docs/specs/p3-x/SPECS.md:30',
            problem: 'no code can satisfy both values',
            evidence: 'SPECS.md line 30 names two values',
            suggestedFix: 'name one value',
            specLine: '"the limit is 3 or 4"',
          },
        ],
        runtimeNotes: ['the progress bar moves on a real screen'],
      },
    });
  });

  it('reads a change round heading, and keeps its round as the string U<k> (revision 1)', () => {
    const result = parseReview(REVIEW_ISSUES.replace('## Review round 1', '## Review round U2'));
    expect(result).toMatchObject({ ok: true, report: { round: 'U2', verdict: 'ISSUES' } });
    expect(parseReview('## Review round U\n Verdict: PASS\n').ok).toBe(false);
  });

  it('reads a findings analysis that names a change round, with a null round (revision 1)', () => {
    const result = parseFindingsAnalysis(ANALYSIS.replace('(round 2)', '(round U1)'));
    expect(result).toMatchObject({ ok: true, report: { round: null } });
  });

  it('reads a PASS with no findings, and reads CRLF', () => {
    const result = parseReview(
      '## Review round 3\r\nVerdict: PASS\r\nSummary: All good.\r\n### Findings\r\nNone.\r\n',
    );
    expect(result).toEqual({
      ok: true,
      report: { round: 3, verdict: 'PASS', summary: 'All good.', findings: [], runtimeNotes: [] },
    });
  });

  it('fails when ISSUES has no findings, and when PASS has one', () => {
    expect(parseReview('## Review round 1\nVerdict: ISSUES\nSummary: x\n')).toEqual({
      ok: false,
      reason: 'ISSUES has no findings',
    });
    expect(parseReview(REVIEW_ISSUES.replace('Verdict: ISSUES', 'Verdict: PASS'))).toEqual({
      ok: false,
      reason: 'PASS has findings',
    });
  });

  it('fails on a missing heading, verdict, field, severity or type', () => {
    expect(parseReview('Verdict: PASS\n')).toEqual({
      ok: false,
      reason: 'the review has no Review round heading',
    });
    expect(parseReview('## Review round 1\nSummary: x\n')).toEqual({
      ok: false,
      reason: 'the review has no verdict line',
    });
    expect(
      parseReview(REVIEW_ISSUES.replace('  problem: the count is off by one', '  problem:')),
    ).toEqual({
      ok: false,
      reason: 'a finding is missing a field',
    });
    expect(parseReview(REVIEW_ISSUES.replace('severity: major', 'severity: severe'))).toEqual({
      ok: false,
      reason: 'a finding has an unknown severity',
    });
    expect(parseReview(REVIEW_ISSUES.replace('type: spec-change', 'type: opinion'))).toEqual({
      ok: false,
      reason: 'a finding has an unknown type',
    });
  });

  it('fails a spec-change finding that quotes no spec line', () => {
    const noLine = REVIEW_ISSUES.replace(/ {2}spec line: .*\n/, '');
    expect(parseReview(noLine)).toEqual({
      ok: false,
      reason: 'a finding is missing a field',
    });
  });

  it('keeps at most LIST_CAP findings and caps the long texts', () => {
    const block = (n: number) =>
      `- id: R1-${n}\n  severity: minor\n  location: a.ts:1\n  problem: ${'p'.repeat(TEXT_CAP + 50)}\n  evidence: e\n  suggested fix: f\n`;
    const many = Array.from({ length: LIST_CAP + 5 }, (_, index) => block(index + 1)).join('');
    const result = parseReview(
      `## Review round 1\nVerdict: ISSUES\nSummary: s\n### Findings\n${many}`,
    );
    expect(result.ok && result.report.findings).toHaveLength(LIST_CAP);
    expect(result.ok && result.report.findings[0]?.problem.length).toBe(TEXT_CAP);
  });
});

describe('parsers never throw', () => {
  it('returns a result for odd input', () => {
    for (const input of ['', '\r\n', '##', '| |', '- id:', 'Verdict:', '\u0000']) {
      expect(() => parseImplementationReport(input)).not.toThrow();
      expect(() => parseFindingsAnalysis(input)).not.toThrow();
      expect(() => parseReview(input)).not.toThrow();
      expect(parseReview(input).ok).toBe(false);
    }
  });
});

describe('purity (AC8, AC10)', () => {
  it('imports nothing from Node, Electron or the DOM', () => {
    const path = fileURLToPath(new URL('../../src/shared/build-reports.ts', import.meta.url));
    const text = readFileSync(path, 'utf8');
    const specifiers = [...text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map(
      (match) => match[1] ?? '',
    );
    for (const specifier of specifiers) {
      expect(specifier.startsWith('node:'), specifier).toBe(false);
      expect(specifier, specifier).not.toMatch(/electron/);
    }
    expect(text).not.toMatch(/\b(window|document|child_process)\b/);
  });
});
