import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHumanActionChannel } from '../../src/main/human/channel';
import { createShipHandlers } from '../../src/main/human/ship-handlers';
import { createSpecHandlers } from '../../src/main/human/spec-handlers';
import type { Logger } from '../../src/main/log';
import { DEFAULT_POLICY_CONTEXT, type PolicyContext } from '../../src/main/policy/context';
import { createProjectRegistry, type ProjectRegistry } from '../../src/main/projects/registry';
import { createProjectStore, type Project } from '../../src/main/projects/store';
import type { ToolRunner } from '../../src/main/agent/router';
import { createInProcessJobRunner } from '../../src/main/workflow/job-runner';
import { createBuildController } from '../../src/main/workflow/build-loop';
import type { SpecLockWatcher, SpecLockValue } from '../../src/main/workflow/spec-watch';
import { createScriptedProvider, type ScriptedRequest } from '../support/scripted-provider';
import type { HumanActionRequest } from '../../src/shared/human-actions';

// The project registry on temp folders (AC4, AC5, AC7). The store is the real one on a temp file;
// the watcher is a fake that records its close, so no file watch runs. The spec and ship handlers
// are the real ones, so an approval writes only into the folder of the project it names.

const NOW = new Date('2026-11-25T10:00:00.000Z');
const FEATURE = 'p4-demo';
const UNKNOWN = '11111111-1111-4111-8111-111111111111';
const DRAFT = [
  '---',
  'status: draft',
  'ticket:',
  '---',
  '',
  '# Demo',
  '',
  '## Goals',
  '',
  '- **G1:** x',
  '',
  '## Acceptance criteria',
  '',
  '- **AC1:** y',
  '',
].join('\n');

const IMPL_OK = `## Implementation report
- Tasks completed: T1   - Tasks not completed: none
- Changes file: docs/specs/${FEATURE}/changes.md; rows: 1 (created 1, edited 0, deleted 0, moved 0)
- Checks run: pnpm test -> pass
- Deviations or concerns: none
`;

/** A review with a spec-change finding: the build pauses after one round when the limit is 1. */
const REVIEW_SPEC_1 = `## Review round 1
Verdict: ISSUES
Summary: One spec problem and one defect.
### Findings
- id: R1-1
  severity: minor
  location: src/a.ts:2
  problem: small issue
  evidence: a.ts line 2
  suggested fix: tidy the name
- id: R1-2
  type: spec-change
  severity: major
  location: docs/specs/${FEATURE}/SPECS.md:5
  spec line: "the limit is 3 or 4"
  problem: contradictory
  evidence: SPECS.md line 5
  suggested fix: name one value
`;

const noTool: ToolRunner = async () => ({ ok: true, output: '' });
const CONTEXT: PolicyContext = { ...DEFAULT_POLICY_CONTEXT, feature: FEATURE, spec: 'approved' };
const LOCAL = { kind: 'local' as const };

interface FakeWatcher {
  root: string;
  close: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
  current: ReturnType<typeof vi.fn>;
}

let base: string;
let projA: string;
let projB: string;
let storePath: string;
let logger: Logger;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'sdd-registry-'));
  projA = join(base, 'project-a');
  projB = join(base, 'project-b');
  mkdirSync(projA);
  mkdirSync(projB);
  storePath = join(base, 'data', 'projects.json');
  logger = { info: vi.fn(), error: vi.fn() };
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

/** A hash of every path and content under a folder, in a fixed order. */
function hashTree(dir: string): string {
  const hash = createHash('sha256');
  const walk = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(folder, entry.name);
      hash.update(full.slice(dir.length));
      hash.update('\0');
      if (entry.isDirectory()) {
        walk(full);
      } else {
        hash.update(readFileSync(full));
        hash.update('\0');
      }
    }
  };
  walk(dir);
  return hash.digest('hex');
}

/** Writes a draft SPECS.md for the feature in one project folder. */
function draftIn(folder: string): void {
  mkdirSync(join(folder, 'docs', 'specs', FEATURE), { recursive: true });
  writeFileSync(join(folder, 'docs', 'specs', FEATURE, 'SPECS.md'), DRAFT);
}

function specStatus(folder: string): string {
  return readFileSync(join(folder, 'docs', 'specs', FEATURE, 'SPECS.md'), 'utf8');
}

/** Builds a registry over a fresh store, with fake watchers that are recorded. */
async function makeRegistry(options: { devProject?: Project } = {}) {
  const watchers: FakeWatcher[] = [];
  const startLock = vi.fn((root: string) => {
    const value: SpecLockValue = { feature: null, approval: 'unchecked' };
    const watcher: FakeWatcher = {
      root,
      close: vi.fn(),
      refresh: vi.fn(async () => value),
      current: vi.fn(() => value),
    };
    watchers.push(watcher);
    return watcher as unknown as SpecLockWatcher;
  });
  const store = createProjectStore({
    filePath: storePath,
    newId: () => randomUUID(),
    now: () => NOW,
    platform: 'linux',
    logger,
  });
  await store.load();
  const registry: ProjectRegistry = createProjectRegistry({
    store,
    ...(options.devProject === undefined ? {} : { devProject: options.devProject }),
    startLock,
    makeSpecHandlers: ({ project, refresh }) =>
      createSpecHandlers({ root: project.root, now: () => NOW, onLockChanged: refresh }),
    makeShipHandlers: ({ project, refresh, controllerNode }) =>
      createShipHandlers({
        root: project.root,
        onLockChanged: refresh,
        controllerNode,
        commitFormat: project.rules.commitFormat,
      }),
    controllerNode: () => null,
  });
  return { registry, startLock, watchers };
}

/** Sends one request through the human-only channel's handler for the action. */
function request(
  action: HumanActionRequest['action'],
  project: string,
  feature = FEATURE,
): HumanActionRequest {
  return { action, project, feature };
}

describe('the project list (G4, G6)', () => {
  it('lists the stored projects and puts the dev project first when there is one', async () => {
    const { registry } = await makeRegistry({
      devProject: {
        id: 'dev',
        name: 'dev',
        environment: LOCAL,
        root: projB,
        rules: { roundLimit: 3, modelPolicy: 'defaults', commitFormat: '{ticket}: {summary}' },
      },
    });
    const added = await registry.addProject({ name: 'A', environment: LOCAL, root: projA });
    expect(added.ok).toBe(true);
    expect(registry.projects().map((project) => project.id)).toEqual([
      'dev',
      ...(added.ok ? [added.project.id] : []),
    ]);
  });

  it('refuses to start with a dev project whose id is not dev', () => {
    expect(() =>
      createProjectRegistry({
        store: createProjectStore({
          filePath: storePath,
          newId: () => randomUUID(),
          now: () => NOW,
          platform: 'linux',
          logger,
        }),
        devProject: {
          id: 'other',
          name: 'other',
          environment: LOCAL,
          root: projB,
          rules: { roundLimit: 3, modelPolicy: 'defaults', commitFormat: '{ticket}: {summary}' },
        },
        startLock: () => ({}) as SpecLockWatcher,
        makeSpecHandlers: () => ({}) as never,
        makeShipHandlers: () => ({}) as never,
        controllerNode: () => null,
      }),
    ).toThrow();
  });
});

describe('per-project handlers (AC5)', () => {
  it('approves the spec in the one project the request names, and no other', async () => {
    draftIn(projA);
    draftIn(projB);
    const { registry } = await makeRegistry();
    const a = await registry.addProject({ name: 'A', environment: LOCAL, root: projA });
    const b = await registry.addProject({ name: 'B', environment: LOCAL, root: projB });
    if (!a.ok || !b.ok) throw new Error('add failed');

    const beforeB = hashTree(projB);
    const result = await registry.handlerFor('approve-spec')(request('approve-spec', a.project.id));
    expect(result).toEqual({ ok: true });
    expect(specStatus(projA)).toContain('status: approved');
    expect(specStatus(projB)).toContain('status: draft');
    expect(hashTree(projB)).toBe(beforeB);
  });

  it('refuses an unknown project with refused and the fixed reason, and changes nothing', async () => {
    draftIn(projA);
    draftIn(projB);
    const { registry } = await makeRegistry();
    await registry.addProject({ name: 'A', environment: LOCAL, root: projA });

    const beforeA = hashTree(projA);
    const beforeB = hashTree(projB);
    const result = await registry.handlerFor('approve-spec')(request('approve-spec', UNKNOWN));
    expect(result).toEqual({ ok: false, code: 'refused', reason: 'no project with this id' });
    expect(hashTree(projA)).toBe(beforeA);
    expect(hashTree(projB)).toBe(beforeB);
  });

  it('answers the dev project from its root in an unpackaged run (G6)', async () => {
    draftIn(projB);
    const { registry } = await makeRegistry({
      devProject: {
        id: 'dev',
        name: 'dev',
        environment: LOCAL,
        root: projB,
        rules: { roundLimit: 3, modelPolicy: 'defaults', commitFormat: '{ticket}: {summary}' },
      },
    });
    expect(await registry.handlerFor('approve-spec')(request('approve-spec', 'dev'))).toEqual({
      ok: true,
    });
    expect(specStatus(projB)).toContain('status: approved');
  });

  it('routes every action to its own handler for the project', async () => {
    const { registry } = await makeRegistry();
    // With no approved spec, the spec and ship handlers each refuse for their own reason.
    const added = await registry.addProject({ name: 'A', environment: LOCAL, root: projA });
    if (!added.ok) throw new Error('add failed');
    const id = added.project.id;
    expect(
      await registry.handlerFor('edit-approved-spec')(request('edit-approved-spec', id)),
    ).toEqual({
      ok: false,
      code: 'refused',
      reason: 'no spec is approved, so there is nothing to edit',
    });
    expect(await registry.handlerFor('mark-done')(request('mark-done', id))).toMatchObject({
      ok: false,
      code: 'refused',
    });
    expect(
      await registry.handlerFor('approve-result')(request('approve-result', id)),
    ).toMatchObject({
      ok: false,
      code: 'refused',
    });
  });

  it('is reached through the channel with the project in the request', async () => {
    draftIn(projA);
    const { registry } = await makeRegistry();
    const added = await registry.addProject({ name: 'A', environment: LOCAL, root: projA });
    if (!added.ok) throw new Error('add failed');
    const tracker = { record: vi.fn(), consume: vi.fn(() => true) };
    const channel = createHumanActionChannel({
      isTrustedSender: () => true,
      tracker,
      logger,
    });
    channel.register('approve-spec', registry.handlerFor('approve-spec'));
    const result = await channel.handle(
      { senderId: 1, frameUrl: 'app://page' },
      { action: 'approve-spec', project: added.project.id, feature: FEATURE },
    );
    expect(result).toEqual({ ok: true });
    expect(specStatus(projA)).toContain('status: approved');
  });
});

describe('watchers and removal (AC7)', () => {
  it('starts one watcher per project, refreshed once, and closes it on remove', async () => {
    const { registry, startLock, watchers } = await makeRegistry();
    const a = await registry.addProject({ name: 'A', environment: LOCAL, root: projA });
    const b = await registry.addProject({ name: 'B', environment: LOCAL, root: projB });
    if (!a.ok || !b.ok) throw new Error('add failed');
    expect(startLock).toHaveBeenCalledTimes(2);
    expect(watchers.map((watcher) => watcher.root)).toEqual([projA, projB]);
    for (const watcher of watchers) expect(watcher.refresh).toHaveBeenCalledTimes(1);

    const removed = await registry.removeProject(a.project.id);
    expect(removed.ok).toBe(true);
    expect(watchers[0]?.close).toHaveBeenCalledTimes(1);
    expect(watchers[1]?.close).not.toHaveBeenCalled();
    expect(registry.projects().map((project) => project.id)).toEqual([b.project.id]);
  });

  it('refuses to remove an unknown project or the dev project, and closes nothing', async () => {
    const { registry, watchers } = await makeRegistry({
      devProject: {
        id: 'dev',
        name: 'dev',
        environment: LOCAL,
        root: projB,
        rules: { roundLimit: 3, modelPolicy: 'defaults', commitFormat: '{ticket}: {summary}' },
      },
    });
    expect(await registry.removeProject(UNKNOWN)).toEqual({
      ok: false,
      reason: 'no project with this id',
    });
    expect(await registry.removeProject('dev')).toEqual({
      ok: false,
      reason: 'no project with this id',
    });
    expect(watchers.every((watcher) => watcher.close.mock.calls.length === 0)).toBe(true);
  });

  it('closes every watcher, the dev project included, on close()', async () => {
    const { registry, watchers } = await makeRegistry({
      devProject: {
        id: 'dev',
        name: 'dev',
        environment: LOCAL,
        root: projB,
        rules: { roundLimit: 3, modelPolicy: 'defaults', commitFormat: '{ticket}: {summary}' },
      },
    });
    await registry.addProject({ name: 'A', environment: LOCAL, root: projA });
    expect(watchers).toHaveLength(2);
    registry.close();
    for (const watcher of watchers) expect(watcher.close).toHaveBeenCalledTimes(1);
    expect(await registry.handlerFor('approve-spec')(request('approve-spec', 'dev'))).toEqual({
      ok: false,
      code: 'refused',
      reason: 'no project with this id',
    });
  });
});

describe('build options from the project rules (AC4, G3)', () => {
  it('gives the project round limit, and a build with it stops after one review round', async () => {
    draftIn(projA);
    const { registry } = await makeRegistry();
    const added = await registry.addProject({
      name: 'A',
      environment: LOCAL,
      root: projA,
      rules: { roundLimit: 1 },
    });
    if (!added.ok) throw new Error('add failed');
    const id = added.project.id;
    expect(await registry.handlerFor('approve-spec')(request('approve-spec', id))).toEqual({
      ok: true,
    });

    const options = registry.buildOptionsFor(id);
    expect(options).toEqual({ root: projA, roundLimit: 1 });
    expect(registry.buildOptionsFor(UNKNOWN)).toBeNull();

    const scripted = createScriptedProvider({
      writer: [{ text: IMPL_OK }],
      reviewer: [{ text: REVIEW_SPEC_1 }],
    });
    const runner = createInProcessJobRunner({
      root: projA,
      provider: scripted,
      model: 'test-model',
      contextNow: () => CONTEXT,
      toolRunner: noTool,
    });
    const created = await createBuildController({
      root: projA,
      feature: FEATURE,
      runner,
      roundLimit: options?.roundLimit,
      models: { writer: 'writer-model', reviewer: 'reviewer-model' },
      now: () => NOW,
    });
    if (!created.ok) throw new Error(created.reason);
    const controller = created.controller;

    expect(await controller.start()).toMatchObject({ kind: 'paused' });
    expect(await controller.resume('continue')).toEqual({
      kind: 'done',
      outcome: 'Open issues remain',
    });
    const reviewerRuns = scripted.requests.filter(
      (entry: ScriptedRequest) => entry.job === 'reviewer',
    );
    expect(reviewerRuns).toHaveLength(1);
  });
});
