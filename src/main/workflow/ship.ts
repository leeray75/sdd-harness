// The ship step of the sdd workflow (p3-ship, D38). approveResult commits a feature's approved
// work and pushes its branch; markDone closes the feature (CLOSE through transition()). Both run
// only through the human-only channel (src/main/human/ship-handlers.ts, D33). Git runs only through
// src/main/git/git.ts. Every refusal is a fixed reason that never names a path, a branch, a commit
// message or git's output. Nothing here throws, and a refusal changes nothing it did not undo.
// docs/workflow-engine.md ("Ship and close") is the reference.

import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  aheadOfUpstream,
  changedPaths,
  commit,
  currentBranch,
  defaultBranch,
  isRepoPath,
  push,
  stage,
  type GitFailure,
} from '../git/git';
import { SPECS_DIR, parseSpecs } from '../../shared/spec-docs';
import {
  MAX_SPEC_STATE_BYTES,
  SPEC_STATE_PATH,
  setFrontmatterStatus,
} from '../../shared/spec-state';
import type { NodeId } from '../../shared/workflow';
import { transition } from '../../shared/workflow';
import type { Approval } from '../../shared/spec-detect';
import { DEFAULT_RULES, formatCommitMessage } from '../../shared/project-rules';
import { MAX_SPEC_FILE_BYTES, readSpecFolder } from './spec-folders';
import {
  approvalOf,
  featureFilePath,
  readRegularText,
  readSpecState,
  writeAtomic,
} from './spec-lock';

/** The outcome of a ship step: done, or refused with a fixed reason. */
export type ShipResult = { ok: true } | { ok: false; reason: string };

/** A step's value, or the fixed reason it was refused. */
type Step<T> = { ok: true; value: T } | { ok: false; reason: string };

export interface ShipOptions {
  /** The node of the feature's build controller, or null when it has none (D37). */
  controllerNode?: () => NodeId | null;
  /** The project's commit format (D40). Undefined takes the default format. */
  commitFormat?: string;
}

/** The text that marks a Git state line as approved and pushed. */
const APPROVED_MARK = 'approved; committed and pushed';
/** The heading whose next line is the Git state line of SUMMARY.md. */
const GIT_STATE_HEADING = '## Git state';
/** The byte order mark some editors write at the start of a file, as a character. */
const BOM = String.fromCharCode(0xfeff);
/** The longest summary in a commit message, in characters. */
const SUMMARY_MAX_CHARS = 72;
/** The default branches when origin/HEAD is unset. */
const FALLBACK_DEFAULTS = ['main', 'master'];
/** The file of a feature's changes table (the allowed set). */
const CHANGES_FILE = 'changes.md';

/** The fixed refusal reasons. None names a path, a branch, a message or git's output. */
export const SHIP_REASONS = {
  buildRunning: 'a build is still running',
  folder: 'the feature folder could not be read',
  notBuildDone: 'the build is not done',
  notApproved: 'the spec is not approved',
  detached: 'HEAD is detached, so the work cannot be committed here',
  defaultBranch: 'the work is on the default branch, so it cannot be committed here',
  summary: 'SUMMARY.md is missing, unreadable or has no Git state line',
  approvedDirty: 'the work is approved but the tree has changes',
  alreadyPushed: 'the work is already committed and pushed',
  outside: 'the tree has changes that are not part of this feature',
  summaryWrite: 'SUMMARY.md could not be written, so nothing was committed',
  commitFailed: 'the commit failed',
  pushKept: 'the push failed; the commit is kept. Approve the result again to retry the push',
  approveFirst: 'approve the result first',
  pushFirst: 'push the approved work first',
  closedDirty: 'the tree has changes after the feature was closed',
  closedAlready: 'the feature is already closed and pushed',
  pushKeptClose:
    'the push failed; the commit is kept. Mark the feature done again to retry the push',
  specsWrite: 'SPECS.md could not be written, so nothing was closed',
  closeWrite: 'the close could not be saved, so nothing was closed',
  notAllowed: 'the workflow does not allow this step',
  failed: 'the action failed',
  gitMissing: 'git is not installed or cannot be run',
  gitTimeout: 'git did not finish in time',
  gitNotRepo: 'the project is not a git repository',
  gitFailed: 'git could not complete the step',
} as const;

function refuse(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

/** The fixed reason for a git failure code. */
function gitReason(code: GitFailure): { ok: false; reason: string } {
  switch (code) {
    case 'git-missing':
      return refuse(SHIP_REASONS.gitMissing);
    case 'timeout':
      return refuse(SHIP_REASONS.gitTimeout);
    case 'not-a-repo':
      return refuse(SHIP_REASONS.gitNotRepo);
    case 'failed':
      return refuse(SHIP_REASONS.gitFailed);
  }
}

/** A path relative to the project root, for a file of a feature folder. */
function relPath(feature: string, name: string): string {
  return `${SPECS_DIR}/${feature}/${name}`;
}

/** Reads one file of a feature folder as text, or null when it is missing or unreadable. */
async function readFeatureText(
  root: string,
  feature: string,
  name: 'SPECS.md' | 'SUBTASK.md' | 'SUMMARY.md' | 'changes.md',
  cap: number,
): Promise<string | null> {
  const path = await featureFilePath(root, feature, name);
  if (path === null) return null;
  const read = await readRegularText(path, cap);
  return read.ok ? read.text : null;
}

// ---------------------------------------------------------------------------------------------
// The commit message (pure)
// ---------------------------------------------------------------------------------------------

/**
 * The first `# ` heading of a Markdown text, flattened to one line, trimmed and capped at
 * SUMMARY_MAX_CHARS characters. Null when there is no such heading or it is empty.
 */
export function firstHeading(text: string | null): string | null {
  if (text === null) return null;
  const body = (text.startsWith(BOM) ? text.slice(BOM.length) : text).replace(/\r\n/g, '\n');
  const line = body.split('\n').find((candidate) => candidate.startsWith('# '));
  if (line === undefined) return null;
  const flat = line.slice(2).replace(/\s+/g, ' ').trim();
  if (flat === '') return null;
  return Array.from(flat).slice(0, SUMMARY_MAX_CHARS).join('').trim() || null;
}

/** The summary: SUBTASK.md's first heading, else SPECS.md's, else the feature slug. */
export function commitSummary(
  feature: string,
  subtask: string | null,
  specs: string | null,
): string {
  return firstHeading(subtask) ?? firstHeading(specs) ?? feature;
}

/** The close commit's message. */
export function closeMessage(feature: string): string {
  return `Close ${feature} spec`;
}

// ---------------------------------------------------------------------------------------------
// The Git state line and the allowed set (pure)
// ---------------------------------------------------------------------------------------------

/** The line after `## Git state` (the first non-blank line before the next heading), or null. */
function locateGitState(text: string): { lines: string[]; index: number } | null {
  const lines = text.split('\n');
  const heading = lines.findIndex((line) => line.trim() === GIT_STATE_HEADING);
  if (heading < 0) return null;
  for (let index = heading + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.trim().startsWith('## ')) return null;
    if (line.trim() !== '') return { lines, index };
  }
  return null;
}

/** The text of the Git state line, or null when SUMMARY has none. */
export function gitStateOf(text: string): string | null {
  const located = locateGitState(text);
  if (located === null) return null;
  return (located.lines[located.index] ?? '').trim();
}

/** The text with its Git state line replaced by `value`, keeping a CR when the line had one. */
export function withGitState(text: string, value: string): string | null {
  const located = locateGitState(text);
  if (located === null) return null;
  const { lines, index } = located;
  const old = lines[index] ?? '';
  lines[index] = `${value}${old.endsWith('\r') ? '\r' : ''}`;
  return lines.join('\n');
}

/**
 * The paths a feature's changes may include: the File column of every table row of changes.md,
 * with backticks removed and separators as `/`. Header and separator rows are skipped, and a path
 * that is not a plain repo-relative path is dropped.
 */
export function allowedFromChanges(text: string | null): Set<string> {
  const paths = new Set<string>();
  if (text === null) return paths;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('|')) continue;
    const cell = (line.split('|')[1] ?? '').replace(/`/g, '').trim().replace(/\\/g, '/');
    if (cell === '' || cell === 'File' || /^:?-+:?$/.test(cell)) continue;
    if (isRepoPath(cell)) paths.add(cell);
  }
  return paths;
}

/** True when a changed path may be committed for this feature. */
function isAllowed(path: string, feature: string, listed: ReadonlySet<string>): boolean {
  return (
    listed.has(path) || path.startsWith(`${SPECS_DIR}/${feature}/`) || path === SPEC_STATE_PATH
  );
}

// ---------------------------------------------------------------------------------------------
// Shared steps
// ---------------------------------------------------------------------------------------------

/**
 * The controller and the folder's node. A controller that is not at build-done refuses. The
 * node is detected with the feature's approval (D35, D36).
 */
async function gate(
  root: string,
  feature: string,
  options: ShipOptions,
): Promise<Step<{ node: NodeId; approval: Approval }>> {
  const controller = options.controllerNode ? options.controllerNode() : null;
  if (controller !== null && controller !== 'build-done') {
    return refuse(SHIP_REASONS.buildRunning);
  }
  const approval = await approvalOf(root, feature);
  const folder = await readSpecFolder(root, feature, approval);
  if (folder === null) return refuse(SHIP_REASONS.folder);
  return { ok: true, value: { node: folder.detection.node, approval } };
}

/** The branch to commit to: refuses a detached HEAD and the default branch. */
async function checkBranch(root: string): Promise<Step<string>> {
  const head = await currentBranch(root);
  if (!head.ok) return gitReason(head.code);
  if (!('branch' in head.value)) return refuse(SHIP_REASONS.detached);
  const defaults = await defaultBranch(root);
  if (!defaults.ok) return gitReason(defaults.code);
  const named = defaults.value === null ? FALLBACK_DEFAULTS : [defaults.value];
  if (named.includes(head.value.branch)) return refuse(SHIP_REASONS.defaultBranch);
  return { ok: true, value: head.value.branch };
}

/** Pushes the branch and returns the fixed reason when the push fails. */
async function pushBranch(root: string, branch: string, failure: string): Promise<ShipResult> {
  const pushed = await push(root, branch);
  return pushed.ok ? { ok: true } : refuse(failure);
}

/** Restores one text file after a failed step. A failure to restore is ignored. */
async function restore(path: string, text: string): Promise<void> {
  await writeAtomic(path, text).catch(() => undefined);
}

// ---------------------------------------------------------------------------------------------
// approve-result
// ---------------------------------------------------------------------------------------------

async function approveInner(
  root: string,
  feature: string,
  options: ShipOptions,
): Promise<ShipResult> {
  const gated = await gate(root, feature, options);
  if (!gated.ok) return gated;
  if (gated.value.node !== 'build-done') return refuse(SHIP_REASONS.notBuildDone);
  if (gated.value.approval !== 'approved') return refuse(SHIP_REASONS.notApproved);

  const branch = await checkBranch(root);
  if (!branch.ok) return branch;

  const summaryPath = await featureFilePath(root, feature, 'SUMMARY.md');
  const summaryText = await readFeatureText(root, feature, 'SUMMARY.md', MAX_SPEC_FILE_BYTES);
  const current = summaryText === null ? null : gitStateOf(summaryText);
  if (summaryPath === null || summaryText === null || current === null) {
    return refuse(SHIP_REASONS.summary);
  }

  // A retry: the work was approved, so nothing is committed again and only the push is retried.
  if (current.includes(APPROVED_MARK)) {
    const changed = await changedPaths(root);
    if (!changed.ok) return gitReason(changed.code);
    if (changed.value.length > 0) return refuse(SHIP_REASONS.approvedDirty);
    const ahead = await aheadOfUpstream(root);
    if (!ahead.ok) return gitReason(ahead.code);
    if (ahead.value.upstream && ahead.value.ahead === 0) return refuse(SHIP_REASONS.alreadyPushed);
    return pushBranch(root, branch.value, SHIP_REASONS.pushKept);
  }

  const changed = await changedPaths(root);
  if (!changed.ok) return gitReason(changed.code);
  const listed = allowedFromChanges(
    await readFeatureText(root, feature, CHANGES_FILE, MAX_SPEC_FILE_BYTES),
  );
  if (!changed.value.every((path) => isAllowed(path, feature, listed))) {
    return refuse(SHIP_REASONS.outside);
  }

  const specsText = await readFeatureText(root, feature, 'SPECS.md', MAX_SPEC_FILE_BYTES);
  const subtaskText = await readFeatureText(root, feature, 'SUBTASK.md', MAX_SPEC_FILE_BYTES);
  const ticket = parseSpecs(specsText).ticket;
  const format = options.commitFormat ?? DEFAULT_RULES.commitFormat;
  const message = formatCommitMessage(
    format,
    ticket,
    commitSummary(feature, subtaskText, specsText),
  );

  const approvedLine = `Branch ${branch.value}; approved; committed and pushed in the commit that adds this report.`;
  const rewritten = withGitState(summaryText, approvedLine);
  if (rewritten === null) return refuse(SHIP_REASONS.summary);
  const written = await writeAtomic(summaryPath, rewritten);
  if (!written.ok) return refuse(SHIP_REASONS.summaryWrite);

  const paths = [...new Set([...changed.value, relPath(feature, 'SUMMARY.md')])].sort();
  // A failed stage or commit puts the file back and re-stages the paths, so the index matches the
  // restored files and a later approve-result sees the same changes again.
  const undo = async (): Promise<void> => {
    await restore(summaryPath, summaryText);
    await stage(root, paths);
  };
  const staged = await stage(root, paths);
  if (!staged.ok) {
    await undo();
    return refuse(SHIP_REASONS.commitFailed);
  }
  const committed = await commit(root, message);
  if (!committed.ok) {
    await undo();
    return refuse(SHIP_REASONS.commitFailed);
  }
  return pushBranch(root, branch.value, SHIP_REASONS.pushKept);
}

/**
 * Approves the result of a feature at build-done: rewrites SUMMARY's Git state line, commits the
 * changed paths of the feature (its folder, the state file and the changes table's files), and
 * pushes the branch. A second call on approved work only retries the push. Never throws.
 */
export async function approveResult(
  root: string,
  feature: string,
  options: ShipOptions = {},
): Promise<ShipResult> {
  try {
    return await approveInner(root, feature, options);
  } catch {
    return refuse(SHIP_REASONS.failed);
  }
}

// ---------------------------------------------------------------------------------------------
// mark-done
// ---------------------------------------------------------------------------------------------

async function markDoneInner(
  root: string,
  feature: string,
  options: ShipOptions,
): Promise<ShipResult> {
  const gated = await gate(root, feature, options);
  if (!gated.ok) return gated;
  // A closed feature whose close was not pushed is retried here: only the push runs.
  const retry = gated.value.node === 'closed';
  if (!retry) {
    if (gated.value.node !== 'build-done') return refuse(SHIP_REASONS.notBuildDone);
    if (gated.value.approval !== 'approved') return refuse(SHIP_REASONS.notApproved);
  }

  const summaryText = await readFeatureText(root, feature, 'SUMMARY.md', MAX_SPEC_FILE_BYTES);
  const current = summaryText === null ? null : gitStateOf(summaryText);
  // A missing SUMMARY, or one with no Git state line, refuses both actions (revision 1).
  if (current === null) return refuse(SHIP_REASONS.summary);
  if (!current.includes(APPROVED_MARK)) return refuse(SHIP_REASONS.approveFirst);

  const changed = await changedPaths(root);
  if (!changed.ok) return gitReason(changed.code);
  const ahead = await aheadOfUpstream(root);
  if (!ahead.ok) return gitReason(ahead.code);
  const pushedUpToDate = ahead.value.upstream && ahead.value.ahead === 0;

  if (retry) {
    if (changed.value.length > 0) return refuse(SHIP_REASONS.closedDirty);
    if (pushedUpToDate) return refuse(SHIP_REASONS.closedAlready);
    const branch = await checkBranch(root);
    if (!branch.ok) return branch;
    return pushBranch(root, branch.value, SHIP_REASONS.pushKeptClose);
  }

  if (changed.value.length > 0 || !pushedUpToDate) return refuse(SHIP_REASONS.pushFirst);
  const branch = await checkBranch(root);
  if (!branch.ok) return branch;

  const step = transition('build-done', 'CLOSE');
  if (!step.ok) return refuse(SHIP_REASONS.notAllowed);

  const specsPath = await featureFilePath(root, feature, 'SPECS.md');
  const specsRead =
    specsPath === null ? null : await readRegularText(specsPath, MAX_SPEC_FILE_BYTES);
  if (specsPath === null || specsRead === null || !specsRead.ok) {
    return refuse(SHIP_REASONS.specsWrite);
  }
  const specsOriginal = specsRead.text;

  const statePath = join(root, SPEC_STATE_PATH);
  const lock = await readSpecState(root);
  const removeState = lock.kind === 'ok' && lock.state.feature === feature;
  let stateOriginal: string | null = null;
  if (removeState) {
    const stateRead = await readRegularText(statePath, MAX_SPEC_STATE_BYTES);
    if (!stateRead.ok) return refuse(SHIP_REASONS.closeWrite);
    stateOriginal = stateRead.text;
  }

  const paths = [relPath(feature, 'SPECS.md')];
  if (removeState) paths.push(SPEC_STATE_PATH);

  // Puts both files back and re-stages them, so the index matches the restored files again.
  const undo = async (): Promise<void> => {
    await restore(specsPath, specsOriginal);
    if (removeState && stateOriginal !== null) await restore(statePath, stateOriginal);
    await stage(root, paths);
  };

  const closed = await writeAtomic(specsPath, setFrontmatterStatus(specsOriginal, 'done'));
  if (!closed.ok) return refuse(SHIP_REASONS.specsWrite);
  if (removeState) {
    try {
      await rm(statePath);
    } catch {
      await undo();
      return refuse(SHIP_REASONS.closeWrite);
    }
  }

  const staged = await stage(root, paths);
  if (!staged.ok) {
    await undo();
    return refuse(SHIP_REASONS.commitFailed);
  }
  const committed = await commit(root, closeMessage(feature));
  if (!committed.ok) {
    await undo();
    return refuse(SHIP_REASONS.commitFailed);
  }
  return pushBranch(root, branch.value, SHIP_REASONS.pushKeptClose);
}

/**
 * Closes a feature whose approved work is pushed: CLOSE from build-done through transition(), SPECS
 * status `done`, the state file removed when it names this feature, then the close commit and push.
 * Never throws.
 */
export async function markDone(
  root: string,
  feature: string,
  options: ShipOptions = {},
): Promise<ShipResult> {
  try {
    return await markDoneInner(root, feature, options);
  } catch {
    return refuse(SHIP_REASONS.failed);
  }
}
