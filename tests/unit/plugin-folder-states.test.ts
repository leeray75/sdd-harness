// Plugin-written folders in every state the detector knows (p3-headless-e2e, G4, AC6). The seven
// files of docs/specs/p3-ship/ at commit c580d56 are vendored under tests/fixtures/sdd-plugin. The
// first test checks each copy against the SHA-256 recorded below, taken from `git show c580d56`
// output when the fixtures were made. No git runs here: CI's checkout is shallow, so the commit is
// not there. Each other test builds one state in a temp root from a subset of those files (plus the
// approval lock where the state needs one), makes at most one line edit in the temp copy, and reads
// the folder with the app's scanner. Only temp copies are edited.

import { createHash } from 'node:crypto';
import { appendFile, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localEnvironment } from '../../src/main/env';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  hashSpec,
  scanSpecFoldersWithLock,
  writeSpecState,
} from '../../src/main/workflow/spec-lock';
import { SPEC_STATE_VERSION } from '../../src/shared/spec-state';
import type { StageView } from '../../src/shared/workflow';

const FEATURE = 'p3-ship';
const FIXTURE_DIR = fileURLToPath(new URL('../fixtures/sdd-plugin/specs/p3-ship', import.meta.url));

/** The seven files of the folder, in the order of the Design's table. */
const FILES = [
  'PLAN.md',
  'SPECS.md',
  'tasks.md',
  'SUBTASK.md',
  'build-ledger.md',
  'changes.md',
  'SUMMARY.md',
] as const;
type FixtureFile = (typeof FILES)[number];

/** The SHA-256 (hex) of each fixture's bytes, recorded from `git show c580d56:docs/specs/p3-ship/<file>`. */
const RECORDED_SHA256: Record<FixtureFile, string> = {
  'PLAN.md': '979f38f37d8ddff0bd904209cbe90f467c9266883b5107020546c7e336cb95e0',
  'SPECS.md': '48d3b533760e13de8153b5f734788f58de300d89ad060204c08557be525e9c47',
  'tasks.md': '847ea21df2f7c03e2d007f651cedc28152796d5ae3083321d9580eca44136942',
  'SUBTASK.md': 'd44f0b4ec022b0527c85908028d8da2c133a581e328f73bf8d647c3120c5628e',
  'build-ledger.md': '6555a59d14b841c013511540a17bfb2dde294e988ad17979ecc1ce70306d1ff7',
  'changes.md': '46d207b3f7416332286940a215c977de284d63d64e852c66dd059c482a30b0aa',
  'SUMMARY.md': 'e32f14945fae498067611eaab1a4be0ac26c981380dc97c8734ef19c02a7a43a',
};

const SPEC_FILES = ['PLAN.md', 'SPECS.md', 'tasks.md', 'SUBTASK.md'] as const;
const LEDGER_FILE = 'build-ledger.md';

let root: string;
let folder: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sdd-plugin-states-'));
  folder = join(root, 'docs', 'specs', FEATURE);
  await mkdir(folder, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Copies the named fixture files into the temp folder, byte for byte. */
async function copyFiles(names: readonly FixtureFile[]): Promise<void> {
  for (const name of names) {
    await copyFile(join(FIXTURE_DIR, name), join(folder, name));
  }
}

/** Writes the approval lock for SPECS.md as it is now on disk (the approval that was given). */
async function lockNow(): Promise<void> {
  const hash = await hashSpec(localEnvironment(), root, FEATURE);
  if (hash === null) throw new Error('the temp SPECS.md could not be hashed');
  const written = await writeSpecState(localEnvironment(), root, {
    version: SPEC_STATE_VERSION,
    feature: FEATURE,
    sha256: hash,
    approvedAt: '2026-11-25T10:00:00.000Z',
    editing: false,
  });
  expect(written.ok).toBe(true);
}

/** Replaces the first line that matches `pattern` with `replacement`. Exactly one line changes. */
async function editLine(name: FixtureFile, pattern: RegExp, replacement: string): Promise<void> {
  const path = join(folder, name);
  const lines = (await readFile(path, 'utf8')).split('\n');
  const index = lines.findIndex((line) => pattern.test(line));
  if (index < 0) throw new Error(`no line of ${name} matches the edit`);
  lines[index] = replacement;
  await writeFile(path, lines.join('\n'));
}

/** The one folder the scanner reads for this root, with its node and stage. */
async function openFolder(): Promise<{
  node: string;
  stage: StageView;
  source: string | null;
}> {
  const { folders } = await scanSpecFoldersWithLock(localEnvironment(), root);
  expect(folders).toHaveLength(1);
  const detection = folders[0]?.detection;
  if (detection === undefined) throw new Error('the folder was not detected');
  return { node: detection.node, stage: detection.stage, source: detection.source };
}

describe('the p3-ship fixtures (AC6)', () => {
  it('are the seven files of the work commit, matching the SHA-256 recorded in the test', async () => {
    for (const name of FILES) {
      const bytes = await readFile(join(FIXTURE_DIR, name));
      const digest = createHash('sha256').update(bytes).digest('hex');
      expect(digest, name).toBe(RECORDED_SHA256[name]);
    }
  });
});

describe('plugin-written folders open at their node and stage (AC6)', () => {
  it('planning: PLAN.md with Status draft, no lock', async () => {
    await copyFiles(['PLAN.md']);
    await editLine('PLAN.md', /^Status:/, 'Status: draft');
    expect(await openFolder()).toMatchObject({
      node: 'planning',
      stage: { stage: 'plan', paused: false },
    });
  });

  it('plan-approved: PLAN.md with Status approved, no lock', async () => {
    await copyFiles(['PLAN.md']);
    expect(await openFolder()).toMatchObject({
      node: 'plan-approved',
      stage: { stage: 'plan', paused: false },
    });
  });

  it('spec-drafted: PLAN, SPECS, tasks and SUBTASK, no lock', async () => {
    await copyFiles(SPEC_FILES);
    expect(await openFolder()).toMatchObject({
      node: 'spec-drafted',
      stage: { stage: 'spec', paused: false },
    });
  });

  it('spec-approved: the same files with a lock holding SPECS.md hash', async () => {
    await copyFiles(SPEC_FILES);
    await lockNow();
    expect(await openFolder()).toMatchObject({
      node: 'spec-approved',
      stage: { stage: 'build', paused: false },
    });
  });

  it('spec-changed: the same lock, with SPECS.md changed in the temp copy', async () => {
    await copyFiles(SPEC_FILES);
    await lockNow();
    await appendFile(join(folder, 'SPECS.md'), '\nA line added after approval.\n');
    expect(await openFolder()).toMatchObject({
      node: 'spec-changed',
      stage: { stage: 'spec', paused: false },
    });
  });

  it('implementing: plus the ledger running with phase implementing, with the lock', async () => {
    await copyFiles([...SPEC_FILES, LEDGER_FILE]);
    await lockNow();
    await editLine(LEDGER_FILE, /^state:/, 'state: running');
    await editLine(LEDGER_FILE, /^phase:/, 'phase: implementing');
    expect(await openFolder()).toMatchObject({
      node: 'implementing',
      stage: { stage: 'build', paused: false },
      source: 'phase',
    });
  });

  it('reviewing: plus the ledger running with phase reviewing, with the lock', async () => {
    await copyFiles([...SPEC_FILES, LEDGER_FILE]);
    await lockNow();
    await editLine(LEDGER_FILE, /^state:/, 'state: running');
    await editLine(LEDGER_FILE, /^phase:/, 'phase: reviewing');
    expect(await openFolder()).toMatchObject({
      node: 'reviewing',
      stage: { stage: 'build', paused: false },
      source: 'phase',
    });
  });

  it('paused: plus the ledger with state paused-for-revision, with the lock', async () => {
    await copyFiles([...SPEC_FILES, LEDGER_FILE]);
    await lockNow();
    await editLine(LEDGER_FILE, /^state:/, 'state: paused-for-revision');
    expect(await openFolder()).toMatchObject({
      node: 'paused',
      stage: { stage: 'build', paused: true },
    });
  });

  it('build-done: all seven files, with the lock', async () => {
    await copyFiles([...FILES]);
    await lockNow();
    expect(await openFolder()).toMatchObject({
      node: 'build-done',
      stage: { stage: 'review', paused: false },
    });
  });

  it('closed: all seven files, no lock', async () => {
    await copyFiles([...FILES]);
    expect(await openFolder()).toMatchObject({
      node: 'closed',
      stage: { stage: 'done', paused: false },
    });
  });
});
