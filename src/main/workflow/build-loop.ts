// The build controller (p3-build-loop, D37). It runs one feature's build: the writer's Mode 1, then
// review rounds with the reviewer, a Mode 2 fix with every finding, and the decision of each round.
// A spec problem from either job pauses the build, and the person's choice resumes or ends it. A
// user-requested change round uses the same writer and reviewer after a clean build.
//
// Every node change goes through transition() (D34). The controller writes only build-ledger.md
// and SUMMARY.md in the feature's folder, and it runs no git and makes no commit. The jobs run
// through the injected JobRunner, so tests drive the whole loop with a scripted provider.

import { featureFilePath, readRegularText, approvalOf, writeAtomic } from './spec-lock';
import { MAX_SPEC_FILE_BYTES } from './spec-folders';
import type { JobRunner } from './job-runner';
import type { Environment } from '../env/types';
import { WRITER_TASKS } from '../../agent/jobs/writer';
import { REVIEWER_TASKS } from '../../agent/jobs/reviewer';
import type { Message } from '../../agent/provider/types';
import {
  parseFindingsAnalysis,
  parseImplementationReport,
  parseReview,
  type FindingRow,
  type FindingsAnalysis,
  type ImplementationReport,
  type ParseResult,
  type ReviewFinding,
  type ReviewReport,
} from '../../shared/build-reports';
import {
  renderLedger,
  renderSummary,
  type BuildState,
  type LedgerEntry,
  type LedgerReview,
  type Outcome,
  type SpecProblem,
} from '../../shared/build-docs';
import { isFeatureSlug, parseSpecs, type SpecFileName } from '../../shared/spec-docs';
import { checkRoundLimit } from '../../shared/project-rules';
import { transition, type EventId, type NodeId } from '../../shared/workflow';

/** The round limit when the build gives none (G2). */
const DEFAULT_ROUND_LIMIT = 3;

/** The one fixed text sent when a report does not follow its format (AC3, restate once). */
const RESTATE =
  'Your last answer did not follow the required report format. Restate it exactly in that format.';

/** The round limit for a build option: undefined gives 3; 1, 2 and 3 are accepted; all else is refused. */
export function roundLimit(
  value: unknown,
): { ok: true; limit: number } | { ok: false; reason: string } {
  if (value === undefined) {
    return { ok: true, limit: DEFAULT_ROUND_LIMIT };
  }
  return checkRoundLimit(value);
}

/** The result of a build call: a finished build, a pause, a failure, a wait for approval, or a refusal. */
export type BuildOutcome =
  | { kind: 'done'; outcome: Outcome }
  | { kind: 'paused'; problem: SpecProblem }
  | { kind: 'failed'; reason: string }
  | { kind: 'awaiting-approval' }
  | { kind: 'refused'; reason: string };

/** The person's choice at a pause. */
export type ResumeChoice = 'continue' | 'revise' | 'stop';

export interface BuildControllerOptions {
  /** The project's environment (D41). The spec and the build documents are read and written through it. */
  env: Environment;
  root: string;
  feature: string;
  runner: JobRunner;
  /** The round limit option. Undefined means 3; anything but 1, 2 or 3 is refused. */
  roundLimit?: unknown;
  models: { writer: string; reviewer: string };
  now: () => Date;
}

export interface BuildController {
  /** The current workflow node. */
  node(): NodeId;
  /** Starts the build: START_BUILD, then the writer's Mode 1, then the review rounds. */
  start(): Promise<BuildOutcome>;
  /** Answers a pause. Legal only while paused. */
  resume(choice: unknown): Promise<BuildOutcome>;
  /** Called by main after an approve-spec for this feature. Legal only after a revise. */
  approved(): Promise<BuildOutcome>;
  /** Asks for a change round after a clean build. The items are the user's own words. */
  requestChanges(items: unknown): Promise<BuildOutcome>;
  /** EDIT_SPEC: moves spec-approved to spec-changed before the build starts. */
  requestEdit(): { ok: true } | { ok: false; reason: string };
}

export type CreateBuildResult =
  { ok: true; controller: BuildController } | { ok: false; reason: string };

// The writer's decisions go into a target. A build round's review holds its own; a change round
// holds a placeholder until its review is recorded.
interface DecisionTarget {
  decisions: FindingRow[];
}

interface ChangeRound {
  u: number;
  items: string[];
  holder: DecisionTarget;
}

interface WriterStage {
  kind: 'writer';
  mode: 1 | 2 | 3;
  findings: ReviewFinding[];
  target: DecisionTarget | null;
  change: ChangeRound | null;
}

interface ReviewStage {
  kind: 'review';
  change: ChangeRound | null;
}

interface DecideStage {
  kind: 'decide';
  verdict: 'PASS' | 'ISSUES';
  findings: ReviewFinding[];
  isChange: boolean;
  target: LedgerReview | null;
}

type Stage = WriterStage | ReviewStage | DecideStage;
type Step = { kind: 'next'; stage: Stage } | BuildOutcome;

/** What one writer reply holds: the Mode 1 or 3 report, the Mode 2 analysis, or both (Mode 3). */
interface WriterReply {
  report: ImplementationReport | null;
  analysis: FindingsAnalysis | null;
}

type Asked<T> = { ok: true; value: T } | { ok: false; reason: string };

function findingText(finding: ReviewFinding): string {
  return [
    `- id: ${finding.id}`,
    `  severity: ${finding.severity}`,
    `  location: ${finding.location}`,
    `  problem: ${finding.problem}`,
    `  evidence: ${finding.evidence}`,
    `  suggested fix: ${finding.suggestedFix}`,
  ].join('\n');
}

/** The reader for a writer reply in a given mode. Mode 3 with findings needs both parts. */
function writerCheck(
  mode: 1 | 2 | 3,
  withFindings: boolean,
): (text: string) => ParseResult<WriterReply> {
  return (text) => {
    if (mode === 2) {
      const analysis = parseFindingsAnalysis(text);
      return analysis.ok
        ? { ok: true, report: { report: null, analysis: analysis.report } }
        : analysis;
    }
    const report = parseImplementationReport(text);
    if (!report.ok) {
      return report;
    }
    if (mode === 3 && withFindings) {
      const analysis = parseFindingsAnalysis(text);
      if (!analysis.ok) {
        return analysis;
      }
      return { ok: true, report: { report: report.report, analysis: analysis.report } };
    }
    return { ok: true, report: { report: report.report, analysis: null } };
  };
}

class BuildLoop implements BuildController {
  private current: NodeId = 'spec-approved';
  private busy = false;
  private writerHistory: Message[] = [];
  private reviewerHistory: Message[] = [];
  private pausedStage: Stage | null = null;
  private carriedTarget: DecisionTarget | null = null;
  /** The findings the writer last received, with the target their decisions go to, for the reviewer. */
  private lastFix: { findings: ReviewFinding[]; target: DecisionTarget | null } | null = null;
  private readonly doc: BuildState;

  constructor(
    private readonly env: Environment,
    private readonly root: string,
    private readonly runner: JobRunner,
    private readonly now: () => Date,
    feature: string,
    limit: number,
    models: { writer: string; reviewer: string },
  ) {
    this.doc = {
      feature,
      ticket: '',
      date: '',
      state: 'running',
      outcome: null,
      revision: 1,
      resumeOnApprove: false,
      round: 0,
      limit,
      phase: '',
      models,
      entries: [],
      specProblems: [],
      carried: [],
      openIssues: [],
    };
  }

  node(): NodeId {
    return this.current;
  }

  start(): Promise<BuildOutcome> {
    return this.exclusive(async () => {
      const moved = this.advance('START_BUILD');
      if (!moved.ok) {
        return refused(moved.reason);
      }
      return this.drive({ kind: 'writer', mode: 1, findings: [], target: null, change: null });
    });
  }

  resume(choice: unknown): Promise<BuildOutcome> {
    return this.exclusive(async () => {
      if (this.current !== 'paused') {
        return refused('the build is not paused');
      }
      if (choice !== 'continue' && choice !== 'revise' && choice !== 'stop') {
        return refused('the choice must be continue, revise or stop');
      }
      const last = this.doc.specProblems[this.doc.specProblems.length - 1];
      if (last === undefined) {
        return refused('the build has no spec problem to answer');
      }
      if (choice === 'continue') {
        const stage = this.pausedStage;
        if (stage === null) {
          return refused('the build has no step to continue');
        }
        // Nothing left to run (revision 1): a review pause with no findings to fix, a change round
        // (which has no writer step after its review), or a pause at the last allowed round. The
        // build ends with END_BUILD from paused, and no IMPLEMENTED is raised.
        if (
          stage.kind === 'decide' &&
          (stage.findings.length === 0 || stage.isChange || this.doc.round >= this.doc.limit)
        ) {
          const ended = this.advance('END_BUILD');
          if (!ended.ok) {
            return refused(ended.reason);
          }
          last.resolution = 'user chose: continue';
          this.pausedStage = null;
          this.doc.carried = [];
          this.doc.openIssues = [
            `${last.problem} (user chose: continue)`,
            ...stage.findings.map((finding) => `${finding.id}: ${finding.problem}`),
          ];
          return this.finish('Open issues remain');
        }
        const moved = this.advance('CONTINUE');
        if (!moved.ok) {
          return refused(moved.reason);
        }
        last.resolution = 'user chose: continue';
        this.doc.state = 'running';
        this.doc.carried = [];
        this.pausedStage = null;
        return this.drive(stage);
      }
      if (choice === 'revise') {
        const moved = this.advance('REVISE');
        if (!moved.ok) {
          return refused(moved.reason);
        }
        last.resolution = 'user chose: revise';
        this.doc.resumeOnApprove = true;
        this.doc.revision += 1;
        await this.writeLedger();
        return { kind: 'awaiting-approval' };
      }
      const moved = this.advance('STOP_BUILD');
      if (!moved.ok) {
        return refused(moved.reason);
      }
      last.resolution = 'stopped by the user';
      this.doc.openIssues = [last.problem];
      this.pausedStage = null;
      return this.finish('Stopped by the user');
    });
  }

  approved(): Promise<BuildOutcome> {
    return this.exclusive(async () => {
      if (this.current !== 'spec-changed' || !this.doc.resumeOnApprove) {
        return refused('the spec is not waiting for a revision approval');
      }
      if ((await approvalOf(this.env, this.root, this.doc.feature)) !== 'approved') {
        return refused('the spec is not approved');
      }
      const moved = this.advance('REAPPROVE');
      if (!moved.ok) {
        return refused(moved.reason);
      }
      this.doc.resumeOnApprove = false;
      this.doc.state = 'running';
      this.doc.round = 0;
      const findings = this.doc.carried;
      this.doc.carried = [];
      return this.drive({
        kind: 'writer',
        mode: 3,
        findings,
        target: this.carriedTarget,
        change: null,
      });
    });
  }

  requestChanges(items: unknown): Promise<BuildOutcome> {
    return this.exclusive(async () => {
      if (this.current !== 'build-done') {
        return refused('the build is not done');
      }
      if (
        !Array.isArray(items) ||
        items.length === 0 ||
        !items.every((item) => typeof item === 'string' && item.trim() !== '')
      ) {
        return refused('the change request must be a non-empty list of text');
      }
      const moved = this.advance('REQUEST_CHANGES');
      if (!moved.ok) {
        return refused(moved.reason);
      }
      const u = this.doc.entries.filter((entry) => entry.kind === 'change').length + 1;
      const texts = items as string[];
      const change: ChangeRound = { u, items: texts, holder: { decisions: [] } };
      const findings: ReviewFinding[] = texts.map((text, index) => ({
        id: `U${u}-${index + 1}`,
        type: 'defect',
        severity: 'minor',
        location: '(user request)',
        problem: text,
        evidence: 'the user asked for this change',
        suggestedFix: 'make the change',
        specLine: null,
      }));
      this.doc.state = 'running';
      return this.drive({ kind: 'writer', mode: 2, findings, target: change.holder, change });
    });
  }

  requestEdit(): { ok: true } | { ok: false; reason: string } {
    if (this.busy) {
      return { ok: false, reason: 'a build step is already running' };
    }
    const moved = this.advance('EDIT_SPEC');
    return moved.ok
      ? { ok: true }
      : { ok: false, reason: 'the spec can be edited only before the build starts' };
  }

  // -- control ----------------------------------------------------------------------------------

  private advance(event: EventId): { ok: true } | { ok: false; reason: string } {
    const result = transition(this.current, event);
    if (!result.ok) {
      return { ok: false, reason: result.reason };
    }
    this.current = result.node;
    return { ok: true };
  }

  /** Runs one call at a time. A call made during a step is refused, and a failed write ends the build. */
  private async exclusive(run: () => Promise<BuildOutcome>): Promise<BuildOutcome> {
    if (this.busy) {
      return refused('a build step is already running');
    }
    this.busy = true;
    try {
      return await run();
    } catch {
      return { kind: 'failed', reason: 'the build step could not finish' };
    } finally {
      this.busy = false;
    }
  }

  private async drive(first: Stage): Promise<BuildOutcome> {
    let stage: Stage = first;
    for (;;) {
      let step: Step;
      if (stage.kind === 'writer') {
        step = await this.writerStep(stage);
      } else if (stage.kind === 'review') {
        step = await this.reviewStep(stage);
      } else {
        step = await this.decideStep(stage);
      }
      if (step.kind !== 'next') {
        return step;
      }
      stage = step.stage;
    }
  }

  // -- steps ------------------------------------------------------------------------------------

  private async writerStep(stage: WriterStage): Promise<Step> {
    this.doc.phase = 'implementing';
    this.doc.state = 'running';
    // A change round's label is U<k> in the prompts (revision 1). The counter is not touched.
    const roundLabel = stage.change ? `U${stage.change.u}` : String(this.doc.round);
    const step =
      stage.mode === 1
        ? 'writer, Mode 1'
        : stage.mode === 3
          ? 'writer, Mode 3'
          : stage.change
            ? `writer, change round U${stage.change.u}`
            : `writer, Mode 2, round ${this.doc.round}`;
    this.lastFix =
      stage.mode === 1 || stage.findings.length === 0
        ? null
        : { findings: stage.findings, target: stage.target };
    await this.writeLedger();

    const asked = await this.ask(
      'writer',
      writerTask(stage, this.doc.feature, roundLabel),
      writerCheck(stage.mode, stage.findings.length > 0),
    );
    if (!asked.ok) {
      return this.fail(asked.reason);
    }
    const reply = asked.value;
    const problems: string[] = [];
    const needed = new Set<string>();
    if (reply.analysis !== null) {
      if (stage.target !== null) {
        stage.target.decisions = reply.analysis.rows;
      }
      for (const row of reply.analysis.specProblems) {
        needed.add(row.finding);
        problems.push(`${row.finding}: ${row.reasoning}`);
      }
    }
    if (reply.report !== null) {
      this.doc.entries.push({
        kind: 'implementation',
        revision: this.doc.revision,
        mode: stage.mode === 3 ? 3 : 1,
        report: reply.report,
      });
      problems.push(...reply.report.specProblems);
    }
    if (problems.length > 0) {
      const carried = stage.findings.filter((finding) => !needed.has(finding.id));
      const resume: Stage =
        stage.mode === 2 && carried.length === 0
          ? {
              kind: 'decide',
              verdict: 'ISSUES',
              findings: [],
              isChange: stage.change !== null,
              target: null,
            }
          : { ...stage, findings: carried };
      return this.pause(problems, step, carried, resume, stage.target);
    }
    const moved = this.advance('IMPLEMENTED');
    if (!moved.ok) {
      return this.fail(moved.reason);
    }
    return { kind: 'next', stage: { kind: 'review', change: stage.change } };
  }

  private async reviewStep(stage: ReviewStage): Promise<Step> {
    const change = stage.change;
    if (change === null) {
      this.doc.round += 1;
    }
    const label = change ? `U${change.u}` : String(this.doc.round);
    this.doc.phase = 'reviewing';
    this.doc.state = 'running';
    await this.writeLedger();

    const asked = await this.ask(
      'reviewer',
      reviewerTask(label, this.doc.feature, this.lastFix),
      parseReview,
    );
    if (!asked.ok) {
      return this.fail(asked.reason);
    }
    const review: ReviewReport = asked.value;
    const ledgerReview: LedgerReview = {
      verdict: review.verdict,
      findings: review.findings,
      decisions: change ? change.holder.decisions : [],
      runtimeNotes: review.runtimeNotes,
    };
    const entry: LedgerEntry = change
      ? { kind: 'change', u: change.u, items: change.items, review: ledgerReview }
      : { kind: 'round', revision: this.doc.revision, round: this.doc.round, review: ledgerReview };
    this.doc.entries.push(entry);

    const specChanges = review.findings.filter((finding) => finding.type === 'spec-change');
    const isChange = change !== null;
    if (specChanges.length > 0) {
      const carried = review.findings.filter((finding) => finding.type === 'defect');
      const problems = specChanges.map(
        (finding) => `${finding.id}: ${finding.problem} (spec line: ${finding.specLine ?? ''})`,
      );
      const step = change
        ? `reviewer, change round U${change.u}`
        : `reviewer, round ${this.doc.round}`;
      return this.pause(
        problems,
        step,
        carried,
        { kind: 'decide', verdict: 'ISSUES', findings: carried, isChange, target: ledgerReview },
        ledgerReview,
      );
    }
    return {
      kind: 'next',
      stage: {
        kind: 'decide',
        verdict: review.verdict,
        findings: review.findings,
        isChange,
        target: ledgerReview,
      },
    };
  }

  private async decideStep(stage: DecideStage): Promise<Step> {
    if (stage.verdict === 'PASS') {
      return this.endReview('Clean', []);
    }
    if (stage.findings.length === 0) {
      return this.endReview(
        'Open issues remain',
        this.doc.specProblems.slice(-1).map((problem) => problem.problem),
      );
    }
    if (stage.isChange || this.doc.round >= this.doc.limit) {
      return this.endReview(
        'Open issues remain',
        stage.findings.map((finding) => `${finding.id}: ${finding.problem}`),
      );
    }
    if (this.current === 'reviewing') {
      const moved = this.advance('REVIEW_ISSUES');
      if (!moved.ok) {
        return this.fail(moved.reason);
      }
    }
    return {
      kind: 'next',
      stage: {
        kind: 'writer',
        mode: 2,
        findings: stage.findings,
        target: stage.target,
        change: null,
      },
    };
  }

  // -- outcomes ---------------------------------------------------------------------------------

  /**
   * Ends a review round's decision with REVIEW_PASSED. A round is decided in reviewing; no review is
   * decided in implementing, so no IMPLEMENTED is raised here.
   */
  private async endReview(outcome: Outcome, openIssues: string[]): Promise<BuildOutcome> {
    const moved = this.advance(this.current === 'reviewing' ? 'REVIEW_PASSED' : 'END_BUILD');
    if (!moved.ok) {
      return this.fail(moved.reason);
    }
    this.doc.openIssues = openIssues;
    return this.finish(outcome);
  }

  /** A build that cannot go on: END_BUILD to build-done, then the ledger and summary (revision 1). */
  private async fail(reason: string): Promise<BuildOutcome> {
    if (this.current === 'implementing' || this.current === 'reviewing') {
      this.advance('END_BUILD');
    }
    this.doc.openIssues = [reason];
    await this.finish('Open issues remain');
    return { kind: 'failed', reason };
  }

  private async pause(
    problems: string[],
    step: string,
    carried: ReviewFinding[],
    resume: Stage,
    target: DecisionTarget | null,
  ): Promise<BuildOutcome> {
    const moved = this.advance('SPEC_PROBLEM');
    if (!moved.ok) {
      return this.fail(moved.reason);
    }
    const problem: SpecProblem = {
      revision: this.doc.revision,
      step,
      problem: problems.join('; '),
      resolution: '',
    };
    this.doc.specProblems.push(problem);
    this.doc.state = 'paused-for-revision';
    this.doc.resumeOnApprove = false;
    this.doc.carried = carried;
    this.pausedStage = resume;
    this.carriedTarget = target;
    await this.writeLedger();
    return { kind: 'paused', problem };
  }

  /** Writes SUMMARY.md and the final ledger, and returns the finished build. */
  private async finish(outcome: Outcome): Promise<BuildOutcome> {
    this.doc.state = 'done';
    this.doc.outcome = outcome;
    await this.writeLedger();
    await this.writeSummary();
    return { kind: 'done', outcome };
  }

  // -- the jobs ---------------------------------------------------------------------------------

  /** Sends one task. A reply that does not parse gets one restatement in the same history. */
  private async ask<T>(
    job: 'writer' | 'reviewer',
    task: string,
    check: (text: string) => ParseResult<T>,
  ): Promise<Asked<T>> {
    let run = await this.runner({ job, task, history: this.historyOf(job) });
    if (!run.ok) {
      return { ok: false, reason: run.reason };
    }
    this.setHistory(job, run.messages);
    let parsed = check(run.text);
    if (parsed.ok) {
      return { ok: true, value: parsed.report };
    }
    run = await this.runner({ job, task: RESTATE, history: this.historyOf(job) });
    if (!run.ok) {
      return { ok: false, reason: run.reason };
    }
    this.setHistory(job, run.messages);
    parsed = check(run.text);
    return parsed.ok ? { ok: true, value: parsed.report } : { ok: false, reason: parsed.reason };
  }

  private historyOf(job: 'writer' | 'reviewer'): Message[] {
    return job === 'writer' ? this.writerHistory : this.reviewerHistory;
  }

  private setHistory(job: 'writer' | 'reviewer', messages: Message[]): void {
    if (job === 'writer') {
      this.writerHistory = messages;
    } else {
      this.reviewerHistory = messages;
    }
  }

  // -- documents --------------------------------------------------------------------------------

  private async writeLedger(): Promise<void> {
    await this.writeDoc('build-ledger.md', renderLedger(this.doc));
  }

  private async writeSummary(): Promise<void> {
    const specs = await featureFilePath(this.env, this.root, this.doc.feature, 'SPECS.md');
    const specsText =
      specs === null ? null : await readRegularText(this.env, specs, MAX_SPEC_FILE_BYTES);
    const ticket = parseSpecs(specsText?.ok ? specsText.text : null).ticket;
    const changes = await this.readChanges();
    const state: BuildState = {
      ...this.doc,
      ticket,
      date: this.now().toISOString().slice(0, 10),
    };
    await this.writeDoc('SUMMARY.md', renderSummary(state, changes));
  }

  private async readChanges(): Promise<string | null> {
    const path = await featureFilePath(this.env, this.root, this.doc.feature, 'changes.md');
    if (path === null) {
      return null;
    }
    const read = await readRegularText(this.env, path, MAX_SPEC_FILE_BYTES);
    return read.ok ? read.text : null;
  }

  private async writeDoc(file: SpecFileName, text: string): Promise<void> {
    const path = await featureFilePath(this.env, this.root, this.doc.feature, file);
    if (path === null) {
      throw new Error('the feature folder is not a real folder');
    }
    const written = await writeAtomic(this.env, path, text);
    if (!written.ok) {
      throw new Error(written.reason);
    }
  }
}

function refused(reason: string): BuildOutcome {
  return { kind: 'refused', reason };
}

/** The text of one writer task: the mode's task, with the findings unedited after it. */
function writerTask(stage: WriterStage, feature: string, roundLabel: string): string {
  const findings =
    stage.findings.length === 0
      ? ''
      : `\n\nFindings:\n${stage.findings.map(findingText).join('\n')}`;
  if (stage.mode === 1) {
    return WRITER_TASKS.implement.replaceAll('<feature>', feature);
  }
  if (stage.mode === 3) {
    return `${WRITER_TASKS.resume.replaceAll('<feature>', feature)}${findings}`;
  }
  return `${WRITER_TASKS.fixFindings
    .replaceAll('<feature>', feature)
    .replaceAll('<n>', roundLabel)}${findings}`;
}

/** The text of one review task, with the earlier findings and the writer's decisions after it. */
function reviewerTask(
  label: string,
  feature: string,
  earlier: { findings: ReviewFinding[]; target: DecisionTarget | null } | null,
): string {
  const base = REVIEWER_TASKS.review.replaceAll('<feature>', feature).replaceAll('<n>', label);
  if (earlier === null || earlier.findings.length === 0) {
    return base;
  }
  const lines = earlier.findings.map((finding) => {
    const decision = earlier.target?.decisions.find((row) => row.finding === finding.id);
    const decided = decision
      ? `  writer decision: ${decision.decision}; reasoning: ${decision.reasoning}; action: ${decision.action}`
      : '  writer decision: none recorded';
    return `${findingText(finding)}\n${decided}`;
  });
  return `${base}\n\nEarlier findings and the writer's decisions:\n${lines.join('\n')}`;
}

/**
 * Builds the controller for one feature. The feature must be a valid slug, its spec must be
 * approved under the lock, and the round limit must be valid. A failure runs nothing and writes
 * nothing. The controller starts at spec-approved.
 */
export async function createBuildController(
  options: BuildControllerOptions,
): Promise<CreateBuildResult> {
  if (!isFeatureSlug(options.feature)) {
    return { ok: false, reason: 'the feature is not a valid slug' };
  }
  if ((await approvalOf(options.env, options.root, options.feature)) !== 'approved') {
    return { ok: false, reason: 'the spec is not approved' };
  }
  const limit = roundLimit(options.roundLimit);
  if (!limit.ok) {
    return { ok: false, reason: limit.reason };
  }
  const controller = new BuildLoop(
    options.env,
    options.root,
    options.runner,
    options.now,
    options.feature,
    limit.limit,
    options.models,
  );
  return { ok: true, controller };
}
