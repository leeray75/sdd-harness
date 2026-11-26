import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { expect } from 'vitest';
import {
  createHumanActionChannel,
  type HumanActionChannel,
  type HumanActionSender,
} from '../../src/main/human/channel';
import type { GestureTracker } from '../../src/main/human/gesture';
import { createShipHandlers } from '../../src/main/human/ship-handlers';
import { createSpecHandlers } from '../../src/main/human/spec-handlers';
import { specStateOf, type LiveSpec } from '../../src/main/policy/context';
import type { RuleLogger } from '../../src/main/policy/rule-event';
import { createAppJobRunner } from '../../src/main/workflow/app-runner';
import { createBuildController, type BuildController } from '../../src/main/workflow/build-loop';
import { scanSpecFoldersWithLock } from '../../src/main/workflow/spec-lock';
import { createSpecLockWatcher, type SpecLockWatcher } from '../../src/main/workflow/spec-watch';
import { environmentFor } from '../../src/main/env';
import type { Environment } from '../../src/main/env/types';
import { createProjectRegistry } from '../../src/main/projects/registry';
import { createProjectStore, type ProjectEnvironment } from '../../src/main/projects/store';
import {
  DEV_PROJECT_ID,
  type HumanActionId,
  type HumanActionResult,
} from '../../src/shared/human-actions';
import { DEFAULT_RULES } from '../../src/shared/project-rules';
import type { NodeId } from '../../src/shared/workflow';
import {
  createScriptedProvider,
  type ScriptedProvider,
  type ScriptedTurn,
} from './scripted-provider';

// The headless walk (p3-headless-e2e, G1 to G3, AC1 to AC4; p4-env-wsl, AC11). One feature goes through
// the engine on a git repo with a bare remote and no network: the planning files, approve-spec through the
// D33 channel, the build, the approval and the close. The real spec and ship handlers run on a real
// channel with a test gesture tracker. The real build controller runs with the app's job runner (D39) and
// the scripted provider, and the real gate and tools work in the project's folder. Git is read by the
// test's own git reader (the local git CLI, or wsl.exe for a WSL project); no module under test is mocked.
//
// The walk body is the one shared assertion set: the local unit test and the live WSL walk both call
// runHeadlessWalk. The setup gives the folder as node:fs sees it (`root`), the folder as the environment
// sees it (`projectRoot`: the same folder, or the Linux path of a WSL project), the remote and a git
// reader, and how the project is registered (the dev project, or added through the store and registry).

/** The walk's own time limit: temp-repo git calls are slow on Windows under load. */
export const WALK_TIMEOUT_MS = 120_000;

/** Runs git in a folder given as a node:fs path, and returns its stdout. Used by the test only. */
export type GitReader = (cwd: string, args: string[]) => string;

/** The local git CLI, as the walk reads it on the local backend. */
export const localGit: GitReader = (cwd, args) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });

/** How a walk is set up: the folders, the git reader and how the project is registered. */
export interface WalkSetup {
  /** The repo as node:fs sees it: the local folder, or the share path of a WSL folder. */
  root: string;
  /** The bare remote as the git reader sees it, as a node:fs path. */
  remote: string;
  /** The project's folder as the environment sees it: the same as root, or a Linux path for WSL. */
  projectRoot: string;
  /** The git reader for the test's own reads. */
  git: GitReader;
  /** The dev project (local, in an unpackaged run), or a project added through the store and registry. */
  project: { kind: 'dev' } | { kind: 'added'; environment: ProjectEnvironment };
  /** The store file, in a folder the test owns. */
  storeFile: string;
}

const FEATURE = 'p3-walk';
const BRANCH = `feature/${FEATURE}`;
const TICKET = 'DEMO-1';
const SUBTASK_TITLE = 'Walk the whole feature';
const TRUSTED: HumanActionSender = { senderId: 1, frameUrl: 'app://page' };

const FOLDER_REL = `docs/specs/${FEATURE}`;
const SPECS_REL = `${FOLDER_REL}/SPECS.md`;
const PLAN_REL = `${FOLDER_REL}/PLAN.md`;
const TASKS_REL = `${FOLDER_REL}/tasks.md`;
const SUBTASK_REL = `${FOLDER_REL}/SUBTASK.md`;
const CHANGES_REL = `${FOLDER_REL}/changes.md`;
const LOCK_REL = 'docs/specs/.sdd-state.json';
const PRODUCT_REL = 'src/app.ts';

/** The message the controller gives when the edit is asked at spec-changed (EDIT_SPEC is spec-approved only). */
const EDIT_REFUSED = 'the spec can be edited only before the build starts';

// -- the scripted replies -----------------------------------------------------------------------

const CHANGES_V1 = [
  `# Changes: ${FEATURE}`,
  '',
  '| File | Action | What and why | Task |',
  '| --- | --- | --- | --- |',
  `| \`${PRODUCT_REL}\` | created | the value | T1 |`,
  '',
].join('\n');

const IMPL_OK = `## Implementation report
- Tasks completed: T1   - Tasks not completed: none
- Changes file: docs/specs/${FEATURE}/changes.md; rows: 1 (created 1, edited 0, deleted 0, moved 0)
- Checks run: none
- Deviations or concerns: none
`;

/** A Mode 2 analysis for one finding of round n, or the change round label. */
function fixAnalysis(label: string, id: string): string {
  return `## Findings analysis (round ${label})
| Finding | Decision | Reasoning (evidence) | Action taken |
| --- | --- | --- | --- |
| ${id} | ACCEPT | confirmed by reading the code | fixed |
Changes file: docs/specs/${FEATURE}/changes.md; rows added or updated this round: 1
Checks run: none
`;
}

const REVIEW_ISSUES_1 = `## Review round 1
Verdict: ISSUES
Summary: One defect.
### Findings
- id: R1-1
  severity: major
  location: ${PRODUCT_REL}:1
  problem: wrong value
  evidence: app.ts line 1
  suggested fix: use 2
`;

/** A review with a defect (R2-1) and a spec-change finding (R2-2): the build pauses. */
const REVIEW_SPEC_2 = `## Review round 2
Verdict: ISSUES
Summary: One spec problem and one defect.
### Findings
- id: R2-1
  severity: minor
  location: ${PRODUCT_REL}:1
  problem: small issue
  evidence: app.ts line 1
  suggested fix: tidy the name
- id: R2-2
  type: spec-change
  severity: major
  location: docs/specs/${FEATURE}/SPECS.md:5
  spec line: "the limit is 3 or 4"
  problem: contradictory
  evidence: SPECS.md line 5
  suggested fix: name one value
`;

const REVIEW_PASS_1 = `## Review round 1
Verdict: PASS
Summary: The work matches the spec.
### Findings
None.
`;

const REVIEW_PASS_U1 = `## Review round U1
Verdict: PASS
Summary: The requested change is in place.
### Findings
None.
`;

const CHANGE_ANALYSIS_U1 = fixAnalysis('U1', 'U1-1');

/** The writer: Mode 1 (a write, a denied SPECS.md write, changes.md, the report), Mode 2 (the fix),
 * Mode 3 (after the revision: the report and the analysis of R2-1), then the change round. */
const WRITER_SCRIPT: ScriptedTurn[] = [
  {
    toolCalls: [
      { name: 'write_file', args: { path: PRODUCT_REL, content: 'export const value = 1;\n' } },
    ],
  },
  { toolCalls: [{ name: 'write_file', args: { path: SPECS_REL, content: 'tampered\n' } }] },
  { toolCalls: [{ name: 'write_file', args: { path: CHANGES_REL, content: CHANGES_V1 } }] },
  { text: IMPL_OK },
  {
    toolCalls: [
      {
        name: 'edit_file',
        args: { path: PRODUCT_REL, old_text: 'value = 1', new_text: 'value = 2' },
      },
    ],
  },
  { text: fixAnalysis('1', 'R1-1') },
  { text: `${IMPL_OK}\n${fixAnalysis('0', 'R2-1')}` },
  {
    toolCalls: [
      {
        name: 'edit_file',
        args: { path: PRODUCT_REL, old_text: 'value = 2', new_text: 'value = 3' },
      },
    ],
  },
  { text: CHANGE_ANALYSIS_U1 },
];

/** The reviewer: the ISSUES round, the spec-problem round, the passing round, the change round. */
const REVIEWER_SCRIPT: ScriptedTurn[] = [
  { text: REVIEW_ISSUES_1 },
  { text: REVIEW_SPEC_2 },
  { text: REVIEW_PASS_1 },
  { text: REVIEW_PASS_U1 },
];

// -- the walk's helpers -----------------------------------------------------------------------

/** The git reader of the walk in progress; `sh` reads through it. */
let gitReader: GitReader = localGit;
/** Closes the registry of the walk that ran, so its folder watcher does not hold a folder. */
let closeWalkRegistry: (() => void) | null = null;

/** Closes the registry of the last walk started. Called after each walk. */
export function closeWalk(): void {
  closeWalkRegistry?.();
  closeWalkRegistry = null;
}

/** Runs git through the walk's git reader. Used by the test only, to set up and read state. */
function sh(cwd: string, args: string[]): string {
  return gitReader(cwd, args);
}

/** The paths one commit changed, as git lists them. */
function committedPaths(root: string, commit: string): string[] {
  return sh(root, ['show', '--name-only', '--format=', commit])
    .split('\n')
    .filter((line) => line !== '');
}

/** The status letter and path of each file one commit changed, as `M<tab>path` lines. */
function committedNameStatus(root: string, commit: string): string[] {
  return sh(root, ['show', '--name-status', '--format=', commit])
    .split('\n')
    .filter((line) => line !== '');
}

/** The paths a feature commit may hold: its product file, its folder, and the approval lock. */
function isAllowedPath(path: string): boolean {
  return path === PRODUCT_REL || path.startsWith(`${FOLDER_REL}/`) || path === LOCK_REL;
}

/** The git state the walk compares: HEAD, the commit count, and every branch ref of the remote. */
interface GitSnapshot {
  head: string;
  commits: string;
  remoteRefs: string;
}

/** The temp repo, the channel, the controller slot the handlers read, and the logs. */
export interface Walk {
  root: string;
  remote: string;
  channel: HumanActionChannel;
  provider: ScriptedProvider;
  log: { info: string[]; error: string[] };
  /** Recomputes the live spec state from the lock and SPECS.md on disk (D36). */
  refreshLive(): Promise<void>;
  snapshot(): GitSnapshot;
  /** The node the scanner detects for the feature, read from the files and the lock now. */
  nodeNow(): Promise<NodeId | 'no folder'>;
  /** Sends one human action through the channel. A fresh gesture is pressed unless told not to. */
  human(action: HumanActionId, options?: { gesture?: boolean }): Promise<HumanActionResult>;
  /** Creates the feature's build controller, as index.ts would (the spec must be approved). */
  createController(): Promise<BuildController>;
  /** The controller the handlers read, or null before one is created. */
  controller: BuildController | null;
}

/** A gesture tracker: press() records a gesture, and each consume uses and clears it. */
function gestureTracker(): { tracker: GestureTracker; press: () => void } {
  let gesture = false;
  const tracker: GestureTracker = {
    record: () => undefined,
    consume: () => {
      const was = gesture;
      gesture = false;
      return was;
    },
  };
  return { tracker, press: () => (gesture = true) };
}

function writeText(root: string, relative: string, text: string): void {
  const path = join(root, relative);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

/** Starts the walk: the project, the channel with both handler sets, and the app's job runner. */
export async function startWalk(setup: WalkSetup): Promise<Walk> {
  gitReader = setup.git;
  const { root, remote, projectRoot } = setup;
  const { tracker, press } = gestureTracker();
  const info: string[] = [];
  const errors: string[] = [];
  const logger: RuleLogger = {
    info: (message) => info.push(message),
    warn: (message) => info.push(message),
    error: (message) => errors.push(message),
  };
  const channel = createHumanActionChannel({ isTrustedSender: () => true, tracker, logger });

  // The live supplier is synchronous: it reads the lock as the registry's watcher last read it. The
  // handlers refresh that watcher after each change, and refreshLive refreshes it on demand (D36, D41).
  let lockWatcher: SpecLockWatcher | null = null;
  const liveNow = (): LiveSpec => {
    const value = lockWatcher?.current() ?? { feature: null, approval: 'unchecked' as const };
    return { feature: value.feature, spec: specStateOf(value.approval) };
  };
  const refreshLive = async (): Promise<void> => {
    if (lockWatcher === null) throw new Error('the lock watcher is not started');
    await lockWatcher.refresh();
  };

  // The project is registered through the registry (D40, D41): the dev project for the local walk, or
  // added as a WSL project through the store, which checks its root through the environment (D42).
  const registry = createProjectRegistry({
    store: createProjectStore({
      filePath: setup.storeFile,
      newId: () => randomUUID(),
      now: () => new Date('2026-11-25T10:00:00.000Z'),
      platform: process.platform,
      logger,
    }),
    ...(setup.project.kind === 'dev'
      ? {
          devProject: {
            id: DEV_PROJECT_ID,
            name: 'dev',
            environment: { kind: 'local' as const },
            root: projectRoot,
            rules: DEFAULT_RULES,
          },
        }
      : {}),
    environmentFor,
    startLock: (env, lockRoot) => {
      lockWatcher = createSpecLockWatcher({ env, root: lockRoot, onChange: () => undefined });
      return lockWatcher;
    },
    makeSpecHandlers: ({ env, project, refresh }) =>
      createSpecHandlers({
        env,
        root: project.root,
        now: () => new Date('2026-11-25T10:00:00.000Z'),
        onLockChanged: refresh,
        onEditRequested: () => (walk.controller ? walk.controller.requestEdit() : { ok: true }),
      }),
    makeShipHandlers: ({ env, project, refresh, controllerNode }) =>
      createShipHandlers({
        env,
        root: project.root,
        onLockChanged: refresh,
        controllerNode,
        commitFormat: project.rules.commitFormat,
      }),
    controllerNode: () => walk.controller?.node() ?? null,
  });
  closeWalkRegistry = () => registry.close();
  let projectId: string = DEV_PROJECT_ID;
  if (setup.project.kind === 'added') {
    const added = await registry.addProject({
      name: 'Walk',
      environment: setup.project.environment,
      root: projectRoot,
      rules: DEFAULT_RULES,
    });
    if (!added.ok) throw new Error(added.reason);
    projectId = added.project.id;
  }
  const env: Environment | null = registry.environmentOf(projectId);
  if (env === null) throw new Error('the project has no environment');

  const provider = createScriptedProvider({ writer: WRITER_SCRIPT, reviewer: REVIEWER_SCRIPT });
  const runner = await createAppJobRunner({
    env,
    root: projectRoot,
    provider,
    model: 'test-model',
    live: liveNow,
    log: logger,
  });

  const walk: Walk = {
    root,
    remote,
    channel,
    provider,
    log: { info, error: errors },
    controller: null,
    refreshLive,
    snapshot: () => ({
      head: sh(root, ['rev-parse', 'HEAD']).trim(),
      commits: sh(root, ['rev-list', '--count', 'HEAD']).trim(),
      remoteRefs: sh(remote, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads']),
    }),
    async nodeNow() {
      const { folders } = await scanSpecFoldersWithLock(env, projectRoot);
      return folders[0]?.detection.node ?? 'no folder';
    },
    async human(action, options = {}) {
      if (options.gesture !== false) press();
      return channel.handle(TRUSTED, { action, project: projectId, feature: FEATURE });
    },
    async createController() {
      const created = await createBuildController({
        env,
        root: projectRoot,
        feature: FEATURE,
        runner,
        models: { writer: 'writer-model', reviewer: 'reviewer-model' },
        now: () => new Date('2026-11-25T10:00:00.000Z'),
      });
      if (!created.ok) throw new Error(created.reason);
      walk.controller = created.controller;
      return created.controller;
    },
  };

  // The handlers are the registry's: each one answers for the request's project (D40). The handlers
  // read the one controller, as index.ts does through buildControllers (D37).
  channel.register('approve-spec', registry.handlerFor('approve-spec'));
  channel.register('edit-approved-spec', registry.handlerFor('edit-approved-spec'));
  channel.register('approve-result', registry.handlerFor('approve-result'));
  channel.register('mark-done', registry.handlerFor('mark-done'));

  await refreshLive();
  return walk;
}

/** The planning files, which the test writes itself (the planner is not in the engine). */
function planText(status: 'draft' | 'approved'): string {
  return [
    `# Plan: ${FEATURE}`,
    '',
    `Ticket: ${TICKET}`,
    `Status: ${status}`,
    'Date: 2026-11-25',
    '',
    '## Objective',
    '',
    'Walk one feature through the engine.',
    '',
  ].join('\n');
}

function specsText(): string {
  return [
    '---',
    'status: draft',
    `ticket: ${TICKET}`,
    '---',
    '',
    `# ${FEATURE}`,
    '',
    '## Goals',
    '',
    '- **G1:** the walk runs.',
    '',
    '## Acceptance criteria',
    '',
    '- **AC1:** the walk passes.',
    '',
  ].join('\n');
}

function tasksText(): string {
  return [`# Tasks: ${FEATURE}`, '', '- [ ] **T1: Do the walk.**', ''].join('\n');
}

function subtaskText(): string {
  return [`# ${SUBTASK_TITLE}`, '', 'One feature, plan to closed.', ''].join('\n');
}

/** The walk itself: every step, with the node checked after each one. The expectations are the walk's. */
export async function runHeadlessWalk(walk: Walk): Promise<void> {
  const { root } = walk;
  const base = walk.snapshot();

  // Step 1: the planning files, with the node checked after each one.
  writeText(root, PLAN_REL, planText('draft'));
  expect(await walk.nodeNow()).toBe('planning');
  writeText(root, PLAN_REL, planText('approved'));
  expect(await walk.nodeNow()).toBe('plan-approved');
  writeText(root, SPECS_REL, specsText());
  writeText(root, TASKS_REL, tasksText());
  writeText(root, SUBTASK_REL, subtaskText());
  expect(await walk.nodeNow()).toBe('spec-drafted');
  expect(walk.snapshot()).toEqual(base);

  // approve-spec without a gesture is refused, and changes nothing.
  const specDraft = readFileSync(join(root, SPECS_REL), 'utf8');
  expect(await walk.human('approve-spec', { gesture: false })).toMatchObject({
    ok: false,
    code: 'no-gesture',
  });
  expect(readFileSync(join(root, SPECS_REL), 'utf8')).toBe(specDraft);
  expect(existsSync(join(root, LOCK_REL))).toBe(false);
  expect(await walk.nodeNow()).toBe('spec-drafted');

  // Step 2: approve-spec, then the edit and the re-approval (no controller exists yet, so the
  // edit handler allows it, revision 1). The controller is created last.
  expect(await walk.human('approve-spec')).toEqual({ ok: true });
  expect(await walk.nodeNow()).toBe('spec-approved');
  expect(walk.snapshot()).toEqual(base);
  expect(await walk.human('edit-approved-spec')).toEqual({ ok: true });
  expect(await walk.nodeNow()).toBe('spec-changed');
  expect(await walk.human('approve-spec')).toEqual({ ok: true });
  expect(await walk.nodeNow()).toBe('spec-approved');
  expect(walk.snapshot()).toEqual(base);
  const controller = await walk.createController();
  expect(controller.node()).toBe('spec-approved');

  // Step 3: start. Mode 1 writes the product file, the spec write is denied, and changes.md is
  // written. Review 1 has an ISSUES finding, fixed in Mode 2. Review 2 has a spec problem.
  const specBeforeBuild = readFileSync(join(root, SPECS_REL), 'utf8');
  const paused = await controller.start();
  expect(paused).toMatchObject({ kind: 'paused' });
  expect(controller.node()).toBe('paused');
  expect(await walk.nodeNow()).toBe('paused');
  expect(readFileSync(join(root, SPECS_REL), 'utf8')).toBe(specBeforeBuild);
  expect(readFileSync(join(root, PRODUCT_REL), 'utf8')).toBe('export const value = 2;\n');
  expect(readFileSync(join(root, CHANGES_REL), 'utf8')).toBe(CHANGES_V1);
  expect(
    walk.log.error.some((line) =>
      line.startsWith(
        `rule blocked: job=writer tool=write_file target=${SPECS_REL} reason=not allowed: the spec is approved`,
      ),
    ),
  ).toBe(true);
  expect(
    walk.log.info.some((line) =>
      line.startsWith(`rule allowed: job=writer tool=write_file target=${PRODUCT_REL}`),
    ),
  ).toBe(true);
  // No logged line holds the written content (the denied SPECS.md text or the product file text).
  const everyLine = [...walk.log.info, ...walk.log.error];
  expect(everyLine.some((line) => line.includes('tampered'))).toBe(false);
  expect(everyLine.some((line) => line.includes('value = '))).toBe(false);
  expect(walk.snapshot()).toEqual(base);

  // Step 4: resume('revise') waits for approval. edit-approved-spec is refused here, because
  // EDIT_SPEC is legal only from spec-approved. The test edits SPECS.md, and the lock reads it as
  // changed. approve-spec re-approves it, and approved() resumes in Mode 3.
  expect(await controller.resume('revise')).toEqual({ kind: 'awaiting-approval' });
  expect(controller.node()).toBe('spec-changed');
  const lockBeforeEdit = readFileSync(join(root, LOCK_REL), 'utf8');
  expect(await walk.human('edit-approved-spec')).toEqual({
    ok: false,
    code: 'refused',
    reason: EDIT_REFUSED,
  });
  expect(readFileSync(join(root, LOCK_REL), 'utf8')).toBe(lockBeforeEdit);
  appendFileSync(join(root, SPECS_REL), '- **AC2:** added after the spec problem.\n');
  await walk.refreshLive();
  expect(await walk.nodeNow()).toBe('spec-changed');
  expect(await walk.human('approve-spec')).toEqual({ ok: true });
  expect(controller.node()).toBe('spec-changed');
  expect(await controller.approved()).toEqual({ kind: 'done', outcome: 'Clean' });
  expect(controller.node()).toBe('build-done');
  expect(await walk.nodeNow()).toBe('build-done');
  expect(walk.snapshot()).toEqual(base);

  // Step 5: one change round, with its writer step and its review, which passes.
  expect(await controller.requestChanges(['Rename the value to three.'])).toEqual({
    kind: 'done',
    outcome: 'Clean',
  });
  expect(controller.node()).toBe('build-done');
  expect(await walk.nodeNow()).toBe('build-done');
  expect(readFileSync(join(root, PRODUCT_REL), 'utf8')).toBe('export const value = 3;\n');
  expect(walk.snapshot()).toEqual(base);

  // Step 6: approve-result through the channel. Exactly one commit, pushed, with the
  // commit-format message and only the allowed paths.
  expect(await walk.human('approve-result')).toEqual({ ok: true });
  const approved = walk.snapshot();
  expect(approved.commits).toBe(String(Number(base.commits) + 1));
  expect(approved.head).not.toBe(base.head);
  expect(approved.remoteRefs).toContain(`refs/heads/${BRANCH} ${approved.head}`);
  expect(sh(root, ['log', '-1', '--format=%s']).trim()).toBe(`${TICKET}: ${SUBTASK_TITLE}`);
  const approvedPaths = committedPaths(root, approved.head);
  expect(approvedPaths).toContain(PRODUCT_REL);
  expect(approvedPaths).toContain(`${FOLDER_REL}/SUMMARY.md`);
  expect(approvedPaths.every(isAllowedPath)).toBe(true);
  expect(await walk.nodeNow()).toBe('build-done');
  expect(readFileSync(join(root, `${FOLDER_REL}/SUMMARY.md`), 'utf8')).toContain(
    'approved; committed and pushed',
  );

  // Step 7: mark-done through the channel. The close is one more commit, pushed, and the
  // feature detects as closed.
  expect(await walk.human('mark-done')).toEqual({ ok: true });
  const closed = walk.snapshot();
  expect(closed.commits).toBe(String(Number(approved.commits) + 1));
  expect(closed.remoteRefs).toContain(`refs/heads/${BRANCH} ${closed.head}`);
  expect(sh(root, ['log', '-1', '--format=%s']).trim()).toBe(`Close ${FEATURE} spec`);
  expect(committedNameStatus(root, closed.head)).toEqual(
    expect.arrayContaining([`M\t${SPECS_REL}`, `D\t${LOCK_REL}`]),
  );
  expect(existsSync(join(root, LOCK_REL))).toBe(false);
  expect(await walk.nodeNow()).toBe('closed');
}

/** The folder of a repo's own parent: where a test keeps its store file beside the repo. */
export function storeBesideRepo(root: string): string {
  return join(dirname(root), 'projects.json');
}
