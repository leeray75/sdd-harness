import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInProcessJobRunner, type JobRunner } from '../../src/main/workflow/job-runner';
import {
  createBuildController,
  roundLimit,
  type BuildController,
} from '../../src/main/workflow/build-loop';
import { hashSpec, writeSpecState } from '../../src/main/workflow/spec-lock';
import { DEFAULT_POLICY_CONTEXT, type PolicyContext } from '../../src/main/policy/context';
import type { ToolRunner } from '../../src/main/agent/router';
import { detectFolder, type DetectInput } from '../../src/shared/spec-detect';
import { parseLedger } from '../../src/shared/spec-docs';
import {
  createScriptedProvider,
  type ScriptedRequest,
  type ScriptedTurn,
} from '../support/scripted-provider';
import type { Provider, ProviderRequest, StreamEvent } from '../../src/agent/provider/types';

const FEATURE = 'p9-demo';
const SPEC_V1 =
  '---\nstatus: draft\nticket: T-12\n---\n\n# Spec\n\n## Goals\n\n- **G1:** x\n\n## Acceptance criteria\n\n- **AC1:** y\n';
const SPEC_V2 = `${SPEC_V1}\n- **AC2:** z\n`;

// -- report texts the scripted jobs return -------------------------------------------------------

const IMPL_OK = `## Implementation report
- Tasks completed: T1   - Tasks not completed: none
- Changes file: docs/specs/${FEATURE}/changes.md; rows: 1 (created 1, edited 0, deleted 0, moved 0)
- Checks run: pnpm test -> pass
- Deviations or concerns: none
`;

const IMPL_NEEDS = `## Implementation report
- Tasks completed: none   - Tasks not completed: T2 (spec gap)
- Changes file: docs/specs/${FEATURE}/changes.md; rows: 0 (created 0, edited 0, deleted 0, moved 0)
- Checks run: none
- Deviations or concerns: NEEDS-SPEC-CHANGE in T2: "the gate allows two files" is unclear.
`;

/** A Mode 2 analysis for one finding of review round n. */
function fixAnalysis(n: number, id = `R${n}-1`, decision = 'ACCEPT'): string {
  return `## Findings analysis (round ${n})
| Finding | Decision | Reasoning (evidence) | Action taken |
| --- | --- | --- | --- |
| ${id} | ${decision} | confirmed by reading the code | fixed |
Changes file: docs/specs/${FEATURE}/changes.md; rows added or updated this round: 1
Checks run: pnpm test -> pass
`;
}

const REVIEW_PASS = (n: number | string): string => `## Review round ${n}
Verdict: PASS
Summary: The work matches the spec.
### Findings
None.
`;

const REVIEW_ISSUES = (n: number): string => `## Review round ${n}
Verdict: ISSUES
Summary: One defect.
### Findings
- id: R${n}-1
  severity: major
  location: src/a.ts:1
  problem: wrong value
  evidence: a.ts line 1
  suggested fix: use the right value
`;

/** A review with one defect and one spec-change finding. The defect is R<n>-1. */
const REVIEW_SPEC = (n: number): string => `## Review round ${n}
Verdict: ISSUES
Summary: One spec problem and one defect.
### Findings
- id: R${n}-1
  severity: minor
  location: src/a.ts:2
  problem: small issue
  evidence: a.ts line 2
  suggested fix: tidy the name
- id: R${n}-2
  type: spec-change
  severity: major
  location: docs/specs/${FEATURE}/SPECS.md:5
  spec line: "the limit is 3 or 4"
  problem: contradictory
  evidence: SPECS.md line 5
  suggested fix: name one value
`;

/** A review with one spec-change finding and nothing for the writer to fix. */
const REVIEW_SPEC_ONLY = (n: number): string => `## Review round ${n}
Verdict: ISSUES
Summary: Only a spec problem.
### Findings
- id: R${n}-1
  type: spec-change
  severity: major
  location: docs/specs/${FEATURE}/SPECS.md:5
  spec line: "the limit is 3 or 4"
  problem: contradictory
  evidence: SPECS.md line 5
  suggested fix: name one value
`;

const CHANGE_ANALYSIS = `## Findings analysis (round U1)
| Finding | Decision | Reasoning (evidence) | Action taken |
| --- | --- | --- | --- |
| U1-1 | ACCEPT | a clear request | renamed the helper |
Changes file: docs/specs/${FEATURE}/changes.md; rows added or updated this round: 1
Checks run: pnpm test -> pass
`;

const BAD = 'Done, with no report at all.';

// The one fixed restatement text (build-loop.ts sends this exact string).
const RESTATE_TEXT =
  'Your last answer did not follow the required report format. Restate it exactly in that format.';

/** The text of a source file in this repo, read by its path from the test file. */
function sourceText(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');
}

// -- temp repo and helpers -------------------------------------------------------------------------

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sdd-build-loop-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function lockFeature(text: string): Promise<void> {
  const path = join(root, 'docs', 'specs', FEATURE, 'SPECS.md');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
  const hash = await hashSpec(root, FEATURE);
  if (hash === null) throw new Error('the test spec could not be hashed');
  const written = await writeSpecState(root, {
    version: 1,
    feature: FEATURE,
    sha256: hash,
    approvedAt: '2026-11-23T10:00:00.000Z',
    editing: false,
  });
  expect(written.ok).toBe(true);
}

const folderPath = (file: string) => join(root, 'docs', 'specs', FEATURE, file);

function readDoc(file: string): string {
  return readFileSync(folderPath(file), 'utf8');
}

/** The workflow node and round that the detector reads from the files on disk right now. */
function detectFromDisk(): { node: string; round: number | null } {
  const ledgerText = existsSync(folderPath('build-ledger.md')) ? readDoc('build-ledger.md') : null;
  const ledger = parseLedger(ledgerText);
  const input: DetectInput = {
    approval: 'approved',
    files: {
      plan: true,
      specs: true,
      summary: existsSync(folderPath('SUMMARY.md')),
    },
    planStatus: 'approved',
    ledgerState: ledger.state,
    currentRound: ledger.currentRound,
    phase: ledger.phase,
  };
  const found = detectFolder(input);
  return { node: found.node, round: found.round };
}

const noTool: ToolRunner = async () => ({ ok: true, output: '' });

const CONTEXT: PolicyContext = { ...DEFAULT_POLICY_CONTEXT, feature: FEATURE, spec: 'approved' };

async function makeController(
  script: { writer: ScriptedTurn[]; reviewer: ScriptedTurn[] },
  options: { roundLimit?: unknown; runner?: JobRunner; wrap?: (p: Provider) => Provider } = {},
): Promise<{
  controller: BuildController;
  requests: ScriptedRequest[];
  provider: Provider;
}> {
  const scripted = createScriptedProvider(script);
  const provider = options.wrap ? options.wrap(scripted) : scripted;
  const runner =
    options.runner ??
    createInProcessJobRunner({
      root,
      provider,
      model: 'test-model',
      contextNow: () => CONTEXT,
      toolRunner: noTool,
    });
  const created = await createBuildController({
    root,
    feature: FEATURE,
    runner,
    roundLimit: options.roundLimit,
    models: { writer: 'writer-model', reviewer: 'reviewer-model' },
    now: () => new Date('2026-11-23T10:00:00.000Z'),
  });
  if (!created.ok) throw new Error(created.reason);
  return { controller: created.controller, requests: scripted.requests, provider };
}

/** The last user text a job was sent: its task, or the restatement. */
function lastUserText(request: ScriptedRequest | undefined): string {
  const users = (request?.messages ?? []).filter((message) => message.role === 'user');
  return users.at(-1)?.text ?? '';
}

const writerRequests = (requests: ScriptedRequest[]) => requests.filter((r) => r.job === 'writer');
const reviewerRequests = (requests: ScriptedRequest[]) =>
  requests.filter((r) => r.job === 'reviewer');

// -- tests -----------------------------------------------------------------------------------------

describe('roundLimit (AC2)', () => {
  it('gives 3 for undefined and the value for 1, 2 or 3', () => {
    expect(roundLimit(undefined)).toEqual({ ok: true, limit: 3 });
    for (const value of [1, 2, 3]) {
      expect(roundLimit(value)).toEqual({ ok: true, limit: value });
    }
  });

  it('refuses 0, 4, 2.5, a string and null with the fixed reason', () => {
    for (const value of [0, 4, 2.5, '3', null]) {
      expect(roundLimit(value)).toEqual({
        ok: false,
        reason: 'the round limit must be 1, 2 or 3',
      });
    }
  });

  it('refuses a build with a bad limit, runs nothing and writes no file', async () => {
    await lockFeature(SPEC_V1);
    const created = await createBuildController({
      root,
      feature: FEATURE,
      runner: vi.fn<JobRunner>(),
      roundLimit: 4,
      models: { writer: 'w', reviewer: 'r' },
      now: () => new Date(),
    });
    expect(created).toEqual({ ok: false, reason: 'the round limit must be 1, 2 or 3' });
    expect(existsSync(folderPath('build-ledger.md'))).toBe(false);
    expect(existsSync(folderPath('SUMMARY.md'))).toBe(false);
  });

  it('refuses a feature that is not approved, and a bad slug', async () => {
    const runner = vi.fn<JobRunner>();
    const deps = { root, runner, models: { writer: 'w', reviewer: 'r' }, now: () => new Date() };
    expect(await createBuildController({ ...deps, feature: 'Bad Slug' })).toEqual({
      ok: false,
      reason: 'the feature is not a valid slug',
    });
    expect(await createBuildController({ ...deps, feature: 'missing-one' })).toEqual({
      ok: false,
      reason: 'the spec is not approved',
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it('builds with limit 1 and stops after one ISSUES review', async () => {
    await lockFeature(SPEC_V1);
    const { controller, requests } = await makeController(
      { writer: [{ text: IMPL_OK }], reviewer: [{ text: REVIEW_ISSUES(1) }] },
      { roundLimit: 1 },
    );
    const outcome = await controller.start();
    expect(outcome).toEqual({ kind: 'done', outcome: 'Open issues remain' });
    expect(reviewerRequests(requests)).toHaveLength(1);
    expect(writerRequests(requests)).toHaveLength(1);
  });
});

describe('rounds (AC1)', () => {
  it('ends Clean after one round when the first review passes', async () => {
    await lockFeature(SPEC_V1);
    const { controller, requests } = await makeController({
      writer: [{ text: IMPL_OK }],
      reviewer: [{ text: REVIEW_PASS(1) }],
    });
    expect(controller.node()).toBe('spec-approved');
    expect(await controller.start()).toEqual({ kind: 'done', outcome: 'Clean' });
    expect(controller.node()).toBe('build-done');
    expect(writerRequests(requests)).toHaveLength(1);
    expect(reviewerRequests(requests)).toHaveLength(1);
    const summary = readDoc('SUMMARY.md');
    expect(summary).toContain('Outcome: Clean');
    expect(summary).toContain('Review rounds: 1, change rounds: 0');
  });

  it('runs a Mode 2 fix with every finding unedited, then a clean second round', async () => {
    await lockFeature(SPEC_V1);
    const { controller, requests } = await makeController({
      writer: [{ text: IMPL_OK }, { text: fixAnalysis(1) }],
      reviewer: [{ text: REVIEW_ISSUES(1) }, { text: REVIEW_PASS(2) }],
    });
    expect(await controller.start()).toEqual({ kind: 'done', outcome: 'Clean' });
    const fix = lastUserText(writerRequests(requests)[1]);
    expect(fix).toContain('- id: R1-1');
    expect(fix).toContain('  problem: wrong value');
    expect(fix).toContain('  suggested fix: use the right value');
    // Each job keeps its own conversation: the second review sees the first review's reply.
    const secondReview = reviewerRequests(requests)[1];
    expect(
      secondReview?.messages.some(
        (m) => m.role === 'assistant' && m.text.includes('Review round 1'),
      ),
    ).toBe(true);
    // The writer's second request sees its own first reply.
    expect(writerRequests(requests)[1]?.messages.some((m) => m.role === 'assistant')).toBe(true);
    expect(readDoc('SUMMARY.md')).toContain('Review rounds: 2, change rounds: 0');
  });

  it('ends Open issues remain at round 3, with no fourth review', async () => {
    await lockFeature(SPEC_V1);
    const { controller, requests } = await makeController({
      writer: [{ text: IMPL_OK }, { text: fixAnalysis(1) }, { text: fixAnalysis(2) }],
      reviewer: [
        { text: REVIEW_ISSUES(1) },
        { text: REVIEW_ISSUES(2) },
        { text: REVIEW_ISSUES(3) },
      ],
    });
    expect(await controller.start()).toEqual({ kind: 'done', outcome: 'Open issues remain' });
    expect(reviewerRequests(requests)).toHaveLength(3);
    const summary = readDoc('SUMMARY.md');
    expect(summary).toContain('Outcome: Open issues remain');
    expect(summary).toContain('R3-1: wrong value');
  });
});

describe('the documents at each step (AC5)', () => {
  it('detects implementing and reviewing with the current round, and done at the end', async () => {
    await lockFeature(SPEC_V1);
    const seen: { node: string; round: number | null }[] = [];
    const { controller } = await makeController(
      {
        writer: [{ text: IMPL_OK }, { text: fixAnalysis(1) }],
        reviewer: [{ text: REVIEW_ISSUES(1) }, { text: REVIEW_PASS(2) }],
      },
      {
        wrap: (inner) => ({
          listModels: () => inner.listModels(),
          stream(request: ProviderRequest): AsyncIterable<StreamEvent> {
            seen.push(detectFromDisk());
            return inner.stream(request);
          },
        }),
      },
    );
    await controller.start();
    expect(seen).toEqual([
      { node: 'implementing', round: 0 },
      { node: 'reviewing', round: 1 },
      { node: 'implementing', round: 1 },
      { node: 'reviewing', round: 2 },
    ]);
    expect(detectFromDisk()).toEqual({ node: 'build-done', round: null });
  });

  it('round-trips the ledger through parseLedger after a finished build', async () => {
    await lockFeature(SPEC_V1);
    const { controller } = await makeController({
      writer: [{ text: IMPL_OK }],
      reviewer: [{ text: REVIEW_PASS(1) }],
    });
    await controller.start();
    const ledger = parseLedger(readDoc('build-ledger.md'));
    expect(ledger).toMatchObject({
      present: true,
      state: 'done',
      revision: 1,
      resumeOnApprove: false,
      currentRound: 1,
      problems: [],
    });
    const summary = readDoc('SUMMARY.md');
    for (const heading of [
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
    ]) {
      expect(summary).toContain(heading);
    }
  });
});

describe("pauses and the person's choice (AC3)", () => {
  it('pauses on a writer NEEDS-SPEC-CHANGE, and resumes by continuing the same step', async () => {
    await lockFeature(SPEC_V1);
    const { controller, requests } = await makeController({
      writer: [{ text: IMPL_NEEDS }, { text: IMPL_OK }],
      reviewer: [{ text: REVIEW_PASS(1) }],
    });
    const paused = await controller.start();
    expect(paused).toMatchObject({ kind: 'paused', problem: { step: 'writer, Mode 1' } });
    expect(controller.node()).toBe('paused');
    expect(parseLedger(readDoc('build-ledger.md'))).toMatchObject({
      state: 'paused-for-revision',
      resumeOnApprove: false,
    });
    expect(detectFromDisk().node).toBe('paused');
    expect(readDoc('build-ledger.md')).toContain('## Spec problems');
    expect(readDoc('build-ledger.md')).toContain('"the gate allows two files" is unclear');

    expect(await controller.resume('continue')).toEqual({ kind: 'done', outcome: 'Clean' });
    expect(readDoc('build-ledger.md')).toContain('user chose: continue');
    // The writer's step was sent again, as Mode 1.
    expect(lastUserText(writerRequests(requests)[1])).toContain('Implement the open tasks');
  });

  it('pauses on a reviewer spec-change, carries the other findings, and continues to a fix', async () => {
    await lockFeature(SPEC_V1);
    const { controller, requests } = await makeController({
      writer: [{ text: IMPL_OK }, { text: fixAnalysis(1, 'R1-1') }],
      reviewer: [{ text: REVIEW_SPEC(1) }, { text: REVIEW_PASS(2) }],
    });
    const paused = await controller.start();
    expect(paused).toMatchObject({ kind: 'paused', problem: { step: 'reviewer, round 1' } });
    const ledger = readDoc('build-ledger.md');
    expect(ledger).toContain('## Carried findings');
    expect(ledger).toContain('- R1-1 (minor, src/a.ts:2): small issue');
    expect(ledger).not.toContain('- R1-2 (');
    expect(controller.node()).toBe('paused');

    expect(await controller.resume('continue')).toEqual({ kind: 'done', outcome: 'Clean' });
    // The carried finding went to the writer in Mode 2, and the counter was not reset.
    expect(lastUserText(writerRequests(requests)[1])).toContain('- id: R1-1');
    expect(readDoc('SUMMARY.md')).toContain('Review rounds: 2, change rounds: 0');
  });

  it('does not reset the counter on continue: three reviews still end the build', async () => {
    await lockFeature(SPEC_V1);
    const { controller, requests } = await makeController({
      writer: [{ text: IMPL_OK }, { text: fixAnalysis(1) }, { text: fixAnalysis(2, 'R2-1') }],
      reviewer: [{ text: REVIEW_ISSUES(1) }, { text: REVIEW_SPEC(2) }, { text: REVIEW_ISSUES(3) }],
    });
    expect(await controller.start()).toMatchObject({ kind: 'paused' });
    expect(await controller.resume('continue')).toEqual({
      kind: 'done',
      outcome: 'Open issues remain',
    });
    expect(reviewerRequests(requests)).toHaveLength(3);
  });

  it("stops on the user's choice: done, Stopped by the user, and the problem under Open issues", async () => {
    await lockFeature(SPEC_V1);
    const { controller } = await makeController({ writer: [{ text: IMPL_NEEDS }], reviewer: [] });
    await controller.start();
    expect(await controller.resume('stop')).toEqual({
      kind: 'done',
      outcome: 'Stopped by the user',
    });
    expect(controller.node()).toBe('build-done');
    const summary = readDoc('SUMMARY.md');
    expect(summary).toContain('Outcome: Stopped by the user');
    expect(summary).toContain(
      '## Open issues\n\n- Deviations or concerns: NEEDS-SPEC-CHANGE in T2',
    );
    expect(readDoc('build-ledger.md')).toContain('stopped by the user');
  });

  it('revises: spec-changed, resume on approve, then approved() runs Mode 3 with the carried findings', async () => {
    await lockFeature(SPEC_V1);
    const { controller, requests } = await makeController({
      writer: [{ text: IMPL_OK }, { text: `${fixAnalysis(1, 'R1-1')}\n${IMPL_OK}` }],
      reviewer: [{ text: REVIEW_SPEC(1) }, { text: REVIEW_PASS(1) }],
    });
    await controller.start();
    expect(await controller.resume('revise')).toEqual({ kind: 'awaiting-approval' });
    expect(controller.node()).toBe('spec-changed');
    const ledger = parseLedger(readDoc('build-ledger.md'));
    expect(ledger).toMatchObject({ resumeOnApprove: true, revision: 2 });
    // The spec was edited but not approved again yet, so approved() is refused.
    await writeFile(folderPath('SPECS.md'), SPEC_V2);
    expect(await controller.approved()).toEqual({
      kind: 'refused',
      reason: 'the spec is not approved',
    });

    await lockFeature(SPEC_V2);
    expect(await controller.approved()).toEqual({ kind: 'done', outcome: 'Clean' });
    const mode3 = lastUserText(writerRequests(requests)[1]);
    expect(mode3).toContain('approved again');
    expect(mode3).toContain('- id: R1-1');
    expect(readDoc('build-ledger.md')).toContain('## Implementation, revision 2 (Mode 3)');
  });

  it('allows a second revision (no cap), and a spec problem in Mode 3 can pause again', async () => {
    await lockFeature(SPEC_V1);
    const { controller } = await makeController({
      writer: [{ text: IMPL_NEEDS }, { text: IMPL_NEEDS }, { text: IMPL_OK }],
      reviewer: [{ text: REVIEW_PASS(1) }],
    });
    expect(await controller.start()).toMatchObject({ kind: 'paused' });
    expect(await controller.resume('revise')).toEqual({ kind: 'awaiting-approval' });
    await lockFeature(SPEC_V2);
    expect(await controller.approved()).toMatchObject({ kind: 'paused' });
    expect(parseLedger(readDoc('build-ledger.md')).revision).toBe(2);
    expect(await controller.resume('revise')).toEqual({ kind: 'awaiting-approval' });
    await lockFeature(`${SPEC_V2}\n- **AC3:** w\n`);
    expect(await controller.approved()).toEqual({ kind: 'done', outcome: 'Clean' });
    expect(parseLedger(readDoc('build-ledger.md')).revision).toBe(3);
  });

  it('a continue with nothing left to run ends with END_BUILD from paused, and no IMPLEMENTED', async () => {
    await lockFeature(SPEC_V1);
    const { controller, requests } = await makeController({
      writer: [{ text: IMPL_OK }],
      reviewer: [{ text: REVIEW_SPEC_ONLY(1) }],
    });
    expect(await controller.start()).toMatchObject({ kind: 'paused' });
    expect(await controller.resume('continue')).toEqual({
      kind: 'done',
      outcome: 'Open issues remain',
    });
    expect(controller.node()).toBe('build-done');
    expect(writerRequests(requests)).toHaveLength(1);
    expect(reviewerRequests(requests)).toHaveLength(1);
    const summary = readDoc('SUMMARY.md');
    expect(summary).toContain('Outcome: Open issues remain');
    expect(summary).toContain('user chose: continue');
    expect(summary).toContain('R1-1: contradictory');
    expect(parseLedger(readDoc('build-ledger.md')).state).toBe('done');
  });

  it('a continued review pause at the limit ends with the open issues and no fourth review', async () => {
    await lockFeature(SPEC_V1);
    const { controller, requests } = await makeController(
      { writer: [{ text: IMPL_OK }], reviewer: [{ text: REVIEW_SPEC(1) }] },
      { roundLimit: 1 },
    );
    expect(await controller.start()).toMatchObject({ kind: 'paused' });
    expect(await controller.resume('continue')).toEqual({
      kind: 'done',
      outcome: 'Open issues remain',
    });
    expect(controller.node()).toBe('build-done');
    expect(reviewerRequests(requests)).toHaveLength(1);
    expect(writerRequests(requests)).toHaveLength(1);
    expect(readDoc('SUMMARY.md')).toContain('R1-1: small issue');
  });

  it('refuses resume while not paused, approved() without a revise, and an unknown choice', async () => {
    await lockFeature(SPEC_V1);
    const { controller } = await makeController({
      writer: [{ text: IMPL_NEEDS }],
      reviewer: [],
    });
    expect(await controller.resume('continue')).toEqual({
      kind: 'refused',
      reason: 'the build is not paused',
    });
    expect(await controller.approved()).toEqual({
      kind: 'refused',
      reason: 'the spec is not waiting for a revision approval',
    });
    await controller.start();
    expect(await controller.resume('later')).toEqual({
      kind: 'refused',
      reason: 'the choice must be continue, revise or stop',
    });
    expect(controller.node()).toBe('paused');
    expect(await controller.approved()).toEqual({
      kind: 'refused',
      reason: 'the spec is not waiting for a revision approval',
    });
  });
});

describe('change rounds (AC4)', () => {
  it('sends the items to the same writer and reviewer, without touching the round counter', async () => {
    await lockFeature(SPEC_V1);
    const { controller, requests } = await makeController({
      writer: [
        { text: IMPL_OK },
        { text: fixAnalysis(1) },
        { text: fixAnalysis(2) },
        { text: CHANGE_ANALYSIS },
      ],
      reviewer: [
        { text: REVIEW_ISSUES(1) },
        { text: REVIEW_ISSUES(2) },
        { text: REVIEW_PASS(3) },
        { text: REVIEW_PASS('U1') },
      ],
    });
    expect(await controller.start()).toEqual({ kind: 'done', outcome: 'Clean' });
    expect(await controller.requestChanges(['rename the helper'])).toEqual({
      kind: 'done',
      outcome: 'Clean',
    });
    expect(controller.node()).toBe('build-done');
    const change = lastUserText(writerRequests(requests)[3]);
    expect(change).toContain('- id: U1-1');
    expect(change).toContain('  problem: rename the helper');
    // The change round's label U1 is the round in both prompts (revision 1).
    expect(change).toContain('round U1');
    expect(lastUserText(reviewerRequests(requests)[3])).toContain('Review round U1');
    expect(writerRequests(requests)[3]?.messages.length).toBeGreaterThan(2);
    expect(reviewerRequests(requests)).toHaveLength(4);
    const ledger = readDoc('build-ledger.md');
    expect(ledger).toContain('## User-requested change round U1 (PASS)');
    expect(readDoc('SUMMARY.md')).toContain('Review rounds: 3, change rounds: 1');
  });

  it('ends with the issues listed under Open issues when the change review finds issues', async () => {
    await lockFeature(SPEC_V1);
    const { controller } = await makeController({
      writer: [{ text: IMPL_OK }, { text: CHANGE_ANALYSIS }],
      reviewer: [{ text: REVIEW_PASS(1) }, { text: REVIEW_ISSUES(4) }],
    });
    await controller.start();
    expect(await controller.requestChanges(['rename the helper'])).toEqual({
      kind: 'done',
      outcome: 'Open issues remain',
    });
    expect(readDoc('SUMMARY.md')).toContain('R4-1: wrong value');
  });

  it('refuses an empty or non-string list, and a request before the build is done', async () => {
    await lockFeature(SPEC_V1);
    const { controller } = await makeController({
      writer: [{ text: IMPL_OK }],
      reviewer: [{ text: REVIEW_PASS(1) }],
    });
    expect(await controller.requestChanges([])).toEqual({
      kind: 'refused',
      reason: 'the build is not done',
    });
    await controller.start();
    expect(await controller.requestChanges([])).toEqual({
      kind: 'refused',
      reason: 'the change request must be a non-empty list of text',
    });
    expect(await controller.requestChanges(['ok', 3])).toEqual({
      kind: 'refused',
      reason: 'the change request must be a non-empty list of text',
    });
    expect(controller.node()).toBe('build-done');
  });
});

describe('unreadable reports and provider failures (restate once)', () => {
  it('restates a bad writer report once, and continues when the restatement is good', async () => {
    await lockFeature(SPEC_V1);
    const { controller, requests } = await makeController({
      writer: [{ text: BAD }, { text: IMPL_OK }],
      reviewer: [{ text: REVIEW_PASS(1) }],
    });
    expect(await controller.start()).toEqual({ kind: 'done', outcome: 'Clean' });
    expect(lastUserText(writerRequests(requests)[1])).toBe(RESTATE_TEXT);
  });

  it('ends failed when the restatement is bad too, with the reason under Open issues', async () => {
    await lockFeature(SPEC_V1);
    const { controller } = await makeController({
      writer: [{ text: BAD }, { text: BAD }],
      reviewer: [],
    });
    const outcome = await controller.start();
    expect(outcome.kind).toBe('failed');
    // END_BUILD ends the build from implementing, so the node agrees with the files (revision 1).
    expect(controller.node()).toBe('build-done');
    const summary = readDoc('SUMMARY.md');
    expect(summary).toContain('Outcome: Open issues remain');
    expect(summary).toContain('the report has no Implementation report heading');
    expect(parseLedger(readDoc('build-ledger.md')).state).toBe('done');
  });

  it('ends failed on a bad review, and REVIEW_PASSED is the event that closes it', async () => {
    await lockFeature(SPEC_V1);
    const { controller } = await makeController({
      writer: [{ text: IMPL_OK }],
      reviewer: [{ text: 'no review here' }, { text: 'still none' }],
    });
    expect(await controller.start()).toMatchObject({ kind: 'failed' });
    expect(controller.node()).toBe('build-done');
    expect(readDoc('SUMMARY.md')).toContain('Outcome: Open issues remain');
  });

  it('ends failed when a job run returns ok false, with its reason', async () => {
    await lockFeature(SPEC_V1);
    const runner: JobRunner = async () => ({
      ok: false,
      reason: 'the writer did not finish within its turn limit',
    });
    const { controller } = await makeController({ writer: [], reviewer: [] }, { runner });
    expect(await controller.start()).toEqual({
      kind: 'failed',
      reason: 'the writer did not finish within its turn limit',
    });
  });

  it('turns a provider error into a failed build, not a throw', async () => {
    await lockFeature(SPEC_V1);
    const { controller } = await makeController({ writer: [], reviewer: [] });
    expect(await controller.start()).toMatchObject({ kind: 'failed' });
  });
});

describe('illegal calls and concurrency (AC6)', () => {
  it('refuses an illegal event and changes nothing', async () => {
    await lockFeature(SPEC_V1);
    const { controller } = await makeController({ writer: [], reviewer: [] });
    const before = readdirSync(join(root, 'docs', 'specs', FEATURE)).sort();
    expect(await controller.resume('continue')).toMatchObject({ kind: 'refused' });
    expect(await controller.requestChanges(['x'])).toMatchObject({ kind: 'refused' });
    expect(controller.node()).toBe('spec-approved');
    expect(readdirSync(join(root, 'docs', 'specs', FEATURE)).sort()).toEqual(before);
  });

  it('refuses a call made while a step runs', async () => {
    await lockFeature(SPEC_V1);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runner: JobRunner = async () => {
      await gate;
      return { ok: true, text: IMPL_OK, messages: [], stopped: 'answered' };
    };
    const { controller } = await makeController({ writer: [], reviewer: [] }, { runner });
    const first = controller.start();
    expect(controller.requestEdit()).toEqual({
      ok: false,
      reason: 'a build step is already running',
    });
    expect(await controller.start()).toEqual({
      kind: 'refused',
      reason: 'a build step is already running',
    });
    release();
    await first;
  });

  it('requestEdit moves spec-approved to spec-changed, and is refused once the build runs', async () => {
    await lockFeature(SPEC_V1);
    const { controller } = await makeController({
      writer: [{ text: IMPL_OK }],
      reviewer: [{ text: REVIEW_PASS(1) }],
    });
    expect(controller.requestEdit()).toEqual({ ok: true });
    expect(controller.node()).toBe('spec-changed');
    expect(await controller.start()).toEqual({
      kind: 'refused',
      reason: 'START_BUILD is not a legal event from spec-changed',
    });

    const second = await makeController({
      writer: [{ text: IMPL_OK }],
      reviewer: [{ text: REVIEW_PASS(1) }],
    });
    await second.controller.start();
    expect(second.controller.requestEdit()).toEqual({
      ok: false,
      reason: 'the spec can be edited only before the build starts',
    });
  });
});

describe('no git and no commit (AC7)', () => {
  it('the new modules neither import child_process nor run git', () => {
    for (const file of [
      'src/shared/build-reports.ts',
      'src/shared/build-docs.ts',
      'src/main/workflow/job-runner.ts',
      'src/main/workflow/build-loop.ts',
    ]) {
      const text = sourceText(file);
      expect(text, file).not.toMatch(/child_process/);
      expect(text, file).not.toMatch(/['"`]git['"`]/);
    }
  });

  it('a scripted git commit is denied and the loop leaves the repository alone', async () => {
    await lockFeature(SPEC_V1);
    const { controller, requests } = await makeController({
      writer: [
        {
          toolCalls: [
            { name: 'run_command', args: { program: 'git', args: ['commit', '-m', 'x'] } },
          ],
        },
        { text: IMPL_OK },
      ],
      reviewer: [{ text: REVIEW_PASS(1) }],
    });
    expect(await controller.start()).toEqual({ kind: 'done', outcome: 'Clean' });
    const denied = writerRequests(requests)[1]?.messages.at(-1);
    expect(denied && 'content' in denied ? denied.content : '').toMatch(/^tool error: /);
  });
});

describe('the build loop on a temp git repo (AC3)', () => {
  /** Runs git in the test repo. Test setup and checks only; the app's git runs in src/main/git. */
  function git(args: string[]): string {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  }

  it('makes no commit, and leaves the committed files and the index alone', async () => {
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.name', 'Test User']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'core.autocrlf', 'false']);
    git(['config', 'commit.gpgsign', 'false']);
    const hooks = join(root, 'no-hooks');
    await mkdir(hooks);
    git(['config', 'core.hooksPath', hooks]);
    await writeFile(join(root, 'README.md'), 'readme\n');
    git(['add', 'README.md']);
    git(['commit', '-q', '-m', 'init']);
    const log = git(['log', '--format=%H']);
    const readmeStatus = git(['status', '--porcelain', '--', 'README.md']);

    await lockFeature(SPEC_V1);
    const { controller } = await makeController({
      writer: [
        {
          toolCalls: [
            { name: 'run_command', args: { program: 'git', args: ['commit', '-m', 'x'] } },
          ],
        },
        { text: IMPL_OK },
      ],
      reviewer: [{ text: REVIEW_PASS(1) }],
    });
    expect(await controller.start()).toEqual({ kind: 'done', outcome: 'Clean' });

    expect(git(['log', '--format=%H'])).toBe(log);
    expect(git(['diff', '--cached', '--name-only'])).toBe('');
    expect(git(['status', '--porcelain', '--', 'README.md'])).toBe(readmeStatus);
  }, 20_000);
});

describe('purity of the controller module', () => {
  it('imports no Electron module and no Node module in the shared documents', () => {
    const text = sourceText('src/shared/build-docs.ts');
    expect(text).not.toMatch(/from 'electron'/);
    expect(text).not.toMatch(/from 'node:/);
  });
});
