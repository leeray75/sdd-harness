import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type {
  FindingRow,
  ImplementationReport,
  ReviewFinding,
} from '../../src/shared/build-reports';
import {
  renderLedger,
  renderSummary,
  TURN_CAPS,
  type BuildState,
  type LedgerReview,
} from '../../src/shared/build-docs';
import { parseLedger } from '../../src/shared/spec-docs';
import { detectFolder, type DetectInput } from '../../src/shared/spec-detect';

const FINDING: ReviewFinding = {
  id: 'R1-1',
  type: 'defect',
  severity: 'major',
  location: 'src/a.ts:3',
  problem: 'off by one',
  evidence: 'a.ts line 3',
  suggestedFix: 'start at 0',
  specLine: null,
};

const DECISION: FindingRow = {
  finding: 'R1-1',
  decision: 'ACCEPT',
  reasoning: 'a | b and\na new line',
  action: 'fixed the loop',
};

const REPORT: ImplementationReport = {
  completed: ['T1', 'T2'],
  notCompleted: ['T3'],
  concerns: 'none',
  specProblems: [],
};

const ISSUES_REVIEW: LedgerReview = {
  verdict: 'ISSUES',
  findings: [FINDING],
  decisions: [DECISION],
  runtimeNotes: ['check the screen'],
};

const PASS_REVIEW: LedgerReview = {
  verdict: 'PASS',
  findings: [],
  decisions: [],
  runtimeNotes: [],
};

function stateOf(overrides: Partial<BuildState> = {}): BuildState {
  return {
    feature: 'p9-demo',
    ticket: 'T-12',
    date: '2026-11-23',
    state: 'running',
    outcome: null,
    revision: 1,
    resumeOnApprove: false,
    round: 2,
    limit: 3,
    phase: 'reviewing',
    models: { writer: 'writer-model', reviewer: 'reviewer-model' },
    entries: [
      { kind: 'implementation', revision: 1, mode: 1, report: REPORT },
      { kind: 'round', revision: 1, round: 1, review: ISSUES_REVIEW },
    ],
    specProblems: [],
    carried: [],
    openIssues: [],
    ...overrides,
  };
}

/** The detection of a folder whose approval is approved and whose ledger holds these facts. */
function detectLedger(text: string) {
  const ledger = parseLedger(text);
  const input: DetectInput = {
    approval: 'approved',
    files: { plan: true, specs: true, summary: false },
    planStatus: 'approved',
    ledgerState: ledger.state,
    currentRound: ledger.currentRound,
    phase: ledger.phase,
  };
  return detectFolder(input);
}

describe('renderLedger', () => {
  it('writes the header lines that parseLedger reads, with no problems', () => {
    const ledger = parseLedger(renderLedger(stateOf()));
    expect(ledger).toEqual({
      present: true,
      state: 'running',
      revision: 1,
      resumeOnApprove: false,
      currentRound: 2,
      phase: 'reviewing',
      problems: [],
    });
  });

  it('writes the header text and the turn caps', () => {
    const text = renderLedger(stateOf());
    expect(text).toContain('# Build ledger: p9-demo');
    expect(text).toContain('current round: 2 of 3, in revision 1');
    expect(text).toContain('Writer: writer-model    Reviewer: reviewer-model');
    expect(text).toContain(`Turn caps: writer ${TURN_CAPS.writer}, reviewer ${TURN_CAPS.reviewer}`);
    expect(TURN_CAPS).toEqual({ writer: 40, reviewer: 20 });
  });

  it('writes the sections in order, with the findings table and the decisions', () => {
    const text = renderLedger(
      stateOf({
        entries: [
          { kind: 'implementation', revision: 1, mode: 1, report: REPORT },
          { kind: 'round', revision: 1, round: 1, review: ISSUES_REVIEW },
          {
            kind: 'change',
            u: 1,
            items: ['rename the helper'],
            review: PASS_REVIEW,
          },
        ],
        specProblems: [
          {
            revision: 1,
            step: 'writer, Mode 1',
            problem: 'the spec is silent',
            resolution: 'user chose: continue',
          },
        ],
        carried: [FINDING],
      }),
    );
    const order = [
      '## Implementation, revision 1 (Mode 1)',
      '## Revision 1, round 1 (ISSUES)',
      '## User-requested change round U1 (PASS)',
      '## Spec problems',
      '## Carried findings',
    ];
    const positions = order.map((heading) => text.indexOf(heading));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(text).toContain('- Tasks completed: T1, T2');
    expect(text).toContain('- Tasks not completed: T3');
    expect(text).toContain('- U1-1: rename the helper');
    expect(text).toContain(
      '| Finding | Severity | Location | Implementor decision | Reasoning | Action |',
    );
    expect(text).toContain(
      '| R1-1 | major | src/a.ts:3 | ACCEPT | a \\| b and a new line | fixed the loop |',
    );
    expect(text).toContain(
      '- revision 1, writer, Mode 1: "the spec is silent" (user chose: continue)',
    );
    expect(text).toContain('- R1-1 (major, src/a.ts:3): off by one');
  });

  it('writes none for empty spec problems and carried findings', () => {
    const text = renderLedger(stateOf({ entries: [], round: 1 }));
    expect(text).toContain('## Spec problems\n\nnone');
    expect(text).toContain('## Carried findings\n\nnone');
  });

  it('marks a finding with no decision yet as not analysed', () => {
    const text = renderLedger(
      stateOf({
        entries: [
          {
            kind: 'round',
            revision: 1,
            round: 1,
            review: { ...ISSUES_REVIEW, decisions: [] },
          },
        ],
      }),
    );
    expect(text).toContain('| R1-1 | major | src/a.ts:3 | not analysed |  |  |');
  });

  it('flattens free text so no value can start a label line', () => {
    const hostile: ImplementationReport = {
      ...REPORT,
      concerns: 'fine\nstate: done\nphase: reviewing',
    };
    const text = renderLedger(
      stateOf({ entries: [{ kind: 'implementation', revision: 1, mode: 1, report: hostile }] }),
    );
    const ledger = parseLedger(text);
    expect(ledger.state).toBe('running');
    expect(ledger.phase).toBe('reviewing');
    expect(text).toContain('- Deviations or concerns: fine state: done phase: reviewing');
  });

  it('writes the failed-report line when the report could not be read', () => {
    const text = renderLedger(
      stateOf({ entries: [{ kind: 'implementation', revision: 2, mode: 3, report: null }] }),
    );
    expect(text).toContain(
      '## Implementation, revision 2 (Mode 3)\n\nThe report could not be read.',
    );
  });
});

describe('the ledger through detectFolder', () => {
  it('reads running in implementing and reviewing with the current round', () => {
    const implementing = renderLedger(stateOf({ phase: 'implementing', round: 1 }));
    expect(detectLedger(implementing)).toMatchObject({
      node: 'implementing',
      round: 1,
      source: 'phase',
    });
    const reviewing = renderLedger(stateOf({ phase: 'reviewing', round: 2 }));
    expect(detectLedger(reviewing)).toMatchObject({
      node: 'reviewing',
      round: 2,
      source: 'phase',
    });
  });

  it('reads paused and done', () => {
    const paused = renderLedger(stateOf({ state: 'paused-for-revision', phase: '' }));
    expect(detectLedger(paused)).toMatchObject({ node: 'paused', round: null });
    const done = renderLedger(stateOf({ state: 'done', phase: '' }));
    expect(detectLedger(done)).toMatchObject({ node: 'build-done', round: null });
  });
});

describe('renderSummary', () => {
  const SECTIONS = [
    '## What was built',
    '## Files changed',
    '## Acceptance criteria',
    '## Needs a runtime check',
    '## Review ledger',
    '## Spec revisions',
    '## Rejected findings',
    '## Open issues',
    '## Git state',
    '## Next steps',
  ];

  it('has the header lines and every section, in order', () => {
    const text = renderSummary(
      stateOf({ state: 'done', outcome: 'Clean', phase: '', openIssues: [] }),
      '| File | Action | What and why | Task |\n| --- | --- | --- | --- |\n| src/a.ts | created | x | T1 |\n',
    );
    expect(text).toContain('# Summary: p9-demo');
    expect(text).toContain('Ticket: T-12');
    expect(text).toContain('Date: 2026-11-23');
    expect(text).toContain('Outcome: Clean');
    expect(text).toContain('Review rounds: 1, change rounds: 0');
    expect(text).toContain('Models: writer writer-model, reviewer reviewer-model');
    const positions = SECTIONS.map((heading) => text.indexOf(heading));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(text).toContain('uncommitted; the app commits after the result is approved');
  });

  it('copies the changes.md rows, or says not recorded when there are none', () => {
    const rows =
      '| File | Action | What and why | Task |\n| --- | --- | --- | --- |\n| src/a.ts | created | x | T1 |';
    expect(renderSummary(stateOf({ outcome: 'Clean' }), rows)).toContain(
      `## Files changed\n\n${rows.replace(/\n/g, '\n')}`,
    );
    expect(renderSummary(stateOf({ outcome: 'Clean' }), null)).toContain(
      '## Files changed\n\nnot recorded',
    );
  });

  it('lists the rejected findings, the review ledger and the open issues', () => {
    const text = renderSummary(
      stateOf({
        outcome: 'Open issues remain',
        entries: [
          {
            kind: 'round',
            revision: 1,
            round: 1,
            review: {
              ...ISSUES_REVIEW,
              decisions: [{ ...DECISION, decision: 'REJECT', reasoning: 'already handled' }],
            },
          },
        ],
        openIssues: ['R1-1 still open at the round limit'],
      }),
      null,
    );
    expect(text).toContain('- R1-1 (revision 1, round 1): already handled');
    expect(text).toContain('- revision 1, round 1: ISSUES, 1 finding(s).');
    expect(text).toContain('- R1-1 still open at the round limit');
    expect(text).toContain('Outcome: Open issues remain');
  });

  it('writes the spec revisions and the stopped outcome', () => {
    const text = renderSummary(
      stateOf({
        outcome: 'Stopped by the user',
        specProblems: [
          {
            revision: 1,
            step: 'reviewer, round 1',
            problem: 'spec line 3 conflicts',
            resolution: 'user chose: stop',
          },
        ],
        openIssues: ['spec line 3 conflicts'],
      }),
      null,
    );
    expect(text).toContain('Outcome: Stopped by the user');
    expect(text).toContain(
      '## Spec revisions\n\n- revision 1, reviewer, round 1: "spec line 3 conflicts" (user chose: stop)',
    );
  });

  it('keeps a multi-line open issue on one line', () => {
    const text = renderSummary(
      stateOf({ outcome: 'Clean', openIssues: ['multi\nline issue'] }),
      null,
    );
    expect(text).toContain('- multi line issue');
  });
});

describe('purity (AC5)', () => {
  it('imports nothing from Node, Electron or the DOM, and does not name child_process', () => {
    const path = fileURLToPath(new URL('../../src/shared/build-docs.ts', import.meta.url));
    const text = readFileSync(path, 'utf8');
    const specifiers = [...text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map(
      (match) => match[1] ?? '',
    );
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(specifier.startsWith('node:'), specifier).toBe(false);
      expect(specifier, specifier).not.toMatch(/electron/);
    }
    expect(text).not.toMatch(/\b(window|document|child_process)\b/);
  });
});
