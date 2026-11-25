// Protects files while a command runs and reverts what the command changed (D31). Main takes a
// snapshot of the protected set for the job, makes docs/specs read-only, runs the command, and
// then restores the set: contents and modes of changed files, files and folders the command
// deleted, and files and folders it created. Runs only in main. Reasons are fixed strings that
// never echo a path or a file's contents.

import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { ignoredEntries } from '../git/git';
import type { RevertAction } from '../policy/rule-event';

/** Total bytes of protected files a snapshot may hold: 256 MiB. Over it, the command is refused. */
export const PROTECT_CAP_BYTES = 256 * 1024 * 1024;

export const TOO_LARGE_REASON = 'the project is too large to protect while this command runs';
export const UNREADABLE_REASON =
  'the project could not be read to protect it while this command runs';

/** The jobs that run commands and so need protection. */
export type ProtectedJob = 'writer' | 'reviewer';

/** The areas a revert is reported under. */
export type RevertArea = 'docs/specs' | '.git' | 'project files';

/** One path the restore changed, and how. */
export interface RevertRecord {
  path: string;
  area: RevertArea;
  action: RevertAction;
}

export interface RestoreResult {
  records: RevertRecord[];
  /** True when some path could not be put back. The caller must say so. */
  incomplete: boolean;
}

/** A folder or set of files the protected set covers. Recursive scopes cover everything below. */
interface Scope {
  rel: string;
  recursive: boolean;
  /** Skips .git, node_modules and git-ignored paths (the reviewer's project scope only). */
  honorIgnore: boolean;
}

/** What the walk sees at one path now. */
type Listed =
  | { kind: 'file'; abs: string; mode: number; size: number }
  | { kind: 'link'; abs: string; target: string }
  | { kind: 'dir'; abs: string; mode: number };

/** What the snapshot keeps of one path. */
type Saved =
  | { kind: 'file'; mode: number; bytes: Buffer }
  | { kind: 'link'; target: string }
  | { kind: 'dir'; mode: number };

/** The snapshot taken before a command runs, and the modes locked so far. */
export interface Snapshot {
  root: string;
  job: ProtectedJob;
  /** The environment git's read-only query runs with, the same as the command's minimal one. */
  env: NodeJS.ProcessEnv;
  scopes: readonly Scope[];
  /** The ignore entries from the snapshot's query: the fallback when the restore's query fails. */
  ignored: ReadonlySet<string>;
  saved: Map<string, Saved>;
  /** The docs/specs entries whose modes were changed, with the mode to put back. */
  locked: Array<{ abs: string; mode: number }>;
}

export type SnapshotResult = { ok: true; snapshot: Snapshot } | { ok: false; reason: string };

const SPEC_ROOT = 'docs/specs';
const WRITE_BITS = 0o222;

function isMissing(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function isUnder(rel: string, prefix: string): boolean {
  return rel === prefix || rel.startsWith(`${prefix}/`);
}

/** The area a root-relative path is reported under. */
export function areaOf(rel: string): RevertArea {
  if (isUnder(rel, SPEC_ROOT)) return 'docs/specs';
  if (isUnder(rel, '.git')) return '.git';
  return 'project files';
}

/** The protected scopes for a job. Both jobs protect docs/specs and the .git key files. */
export function scopesFor(job: ProtectedJob): Scope[] {
  const shared: Scope[] = [
    { rel: SPEC_ROOT, recursive: true, honorIgnore: false },
    { rel: '.git/HEAD', recursive: false, honorIgnore: false },
    { rel: '.git/config', recursive: false, honorIgnore: false },
    { rel: '.git/packed-refs', recursive: false, honorIgnore: false },
    { rel: '.git/hooks', recursive: true, honorIgnore: false },
    { rel: '.git/refs', recursive: true, honorIgnore: false },
  ];
  if (job === 'reviewer') {
    // Every other file in the root that is not git-ignored, not under .git or node_modules.
    return [...shared, { rel: '', recursive: true, honorIgnore: true }];
  }
  return shared;
}

/**
 * True when a root-relative path is git-ignored. `git ls-files --directory` lists an ignored
 * folder once, with a trailing slash, so a path is ignored when it or any folder above it is
 * in the list.
 */
export function isIgnored(rel: string, isDir: boolean, ignored: ReadonlySet<string>): boolean {
  if (ignored.size === 0) {
    return false;
  }
  const parts = rel.split('/');
  for (let count = 1; count <= parts.length; count++) {
    const prefix = parts.slice(0, count).join('/');
    if (ignored.has(`${prefix}/`)) {
      return true;
    }
    if (count === parts.length && !isDir && ignored.has(prefix)) {
      return true;
    }
  }
  return false;
}

/**
 * The git-ignored entries of the root, from the read-only query in the git module (D31, moved to
 * src/main/git/git.ts). Null when git is missing or the root is not a repository.
 */
export function gitIgnoredEntries(
  root: string,
  env: NodeJS.ProcessEnv,
): Promise<Set<string> | null> {
  return ignoredEntries(root, env);
}

async function statEntry(root: string, rel: string): Promise<Listed | null> {
  const abs = join(root, rel);
  let stat;
  try {
    stat = await fs.lstat(abs);
  } catch (error) {
    if (isMissing(error)) {
      return null;
    }
    throw error;
  }
  if (stat.isSymbolicLink()) {
    return { kind: 'link', abs, target: await fs.readlink(abs) };
  }
  if (stat.isDirectory()) {
    return { kind: 'dir', abs, mode: stat.mode & 0o777 };
  }
  if (stat.isFile()) {
    return { kind: 'file', abs, mode: stat.mode & 0o777, size: stat.size };
  }
  return null;
}

async function listFolder(
  root: string,
  scope: Scope,
  rel: string,
  ignored: ReadonlySet<string>,
  out: Map<string, Listed>,
): Promise<void> {
  if (rel !== '') {
    const entry = await statEntry(root, rel);
    if (entry === null || entry.kind !== 'dir') {
      return;
    }
    out.set(rel, entry);
  }
  let names: string[];
  try {
    names = await fs.readdir(join(root, rel));
  } catch (error) {
    if (isMissing(error)) {
      return;
    }
    throw error;
  }
  for (const name of names) {
    if (scope.honorIgnore) {
      const lower = name.toLowerCase();
      if (lower === '.git' || lower === 'node_modules') {
        continue;
      }
    }
    const childRel = rel === '' ? name : `${rel}/${name}`;
    const entry = await statEntry(root, childRel);
    if (entry === null) {
      continue;
    }
    if (scope.honorIgnore && isIgnored(childRel, entry.kind === 'dir', ignored)) {
      continue;
    }
    if (entry.kind === 'dir') {
      await listFolder(root, scope, childRel, ignored, out);
    } else {
      out.set(childRel, entry);
    }
  }
}

/** Everything in the protected set now, keyed by root-relative path. */
async function listProtected(
  root: string,
  scopes: readonly Scope[],
  ignored: ReadonlySet<string>,
): Promise<Map<string, Listed>> {
  const out = new Map<string, Listed>();
  for (const scope of scopes) {
    if (scope.recursive) {
      await listFolder(root, scope, scope.rel, ignored, out);
    } else {
      const entry = await statEntry(root, scope.rel);
      if (entry !== null && entry.kind !== 'dir') {
        out.set(scope.rel, entry);
      }
    }
  }
  return out;
}

/**
 * Takes the snapshot for a job before its command runs. Refused, with a fixed reason, when the
 * protected files add up to more than `maxBytes` (256 MiB by default) or cannot be read. The
 * caller passes the root's real path and an environment for git.
 */
export async function snapshotForRun(options: {
  root: string;
  job: ProtectedJob;
  env: NodeJS.ProcessEnv;
  maxBytes?: number;
}): Promise<SnapshotResult> {
  const { root, job } = options;
  const maxBytes = options.maxBytes ?? PROTECT_CAP_BYTES;
  const scopes = scopesFor(job);
  const ignored =
    job === 'reviewer'
      ? ((await gitIgnoredEntries(root, options.env)) ?? new Set<string>())
      : new Set<string>();

  let listed: Map<string, Listed>;
  try {
    listed = await listProtected(root, scopes, ignored);
  } catch {
    return { ok: false, reason: UNREADABLE_REASON };
  }
  let total = 0;
  for (const entry of listed.values()) {
    if (entry.kind === 'file') {
      total += entry.size;
    }
  }
  if (total > maxBytes) {
    return { ok: false, reason: TOO_LARGE_REASON };
  }

  const saved = new Map<string, Saved>();
  try {
    for (const [rel, entry] of listed) {
      if (entry.kind === 'file') {
        saved.set(rel, { kind: 'file', mode: entry.mode, bytes: await fs.readFile(entry.abs) });
      } else if (entry.kind === 'link') {
        saved.set(rel, { kind: 'link', target: entry.target });
      } else {
        saved.set(rel, { kind: 'dir', mode: entry.mode });
      }
    }
  } catch {
    return { ok: false, reason: UNREADABLE_REASON };
  }
  return {
    ok: true,
    snapshot: { root, job, env: options.env, scopes, ignored, saved, locked: [] },
  };
}

/**
 * Makes docs/specs read-only: the write bits go from its files and folders (on Windows, the
 * read-only attribute goes on its files). Each entry is recorded before it is changed, so a
 * restore puts back whatever was changed, even when this stops part way.
 */
export async function lockSpecFolder(snapshot: Snapshot): Promise<void> {
  for (const [rel, saved] of snapshot.saved) {
    if (!isUnder(rel, SPEC_ROOT) || saved.kind === 'link') {
      continue;
    }
    const abs = join(snapshot.root, rel);
    snapshot.locked.push({ abs, mode: saved.mode });
    await fs.chmod(abs, saved.mode & ~WRITE_BITS);
  }
}

async function chmodQuiet(abs: string, mode: number): Promise<void> {
  await fs.chmod(abs, mode).catch(() => undefined);
}

function depthOf(rel: string): number {
  return rel.split('/').length;
}

/** Removes one entry the command created, or replaced, so that the saved state can go back. */
async function removeEntry(abs: string, entry: Listed): Promise<void> {
  if (entry.kind === 'file') {
    await chmodQuiet(abs, 0o666);
  }
  await fs.rm(abs, { recursive: true, force: true });
}

/**
 * Puts one saved path back. Returns 'same' when it already matches, else what was done. A file
 * is compared by bytes and mode; a folder or link by kind (and target).
 */
async function restoreOne(
  abs: string,
  saved: Saved,
  current: Listed | null,
): Promise<'same' | 'restored' | 're-created'> {
  if (saved.kind === 'dir') {
    if (current?.kind === 'dir') {
      return 'same';
    }
    const action = current === null ? 're-created' : 'restored';
    if (current !== null) {
      await removeEntry(abs, current);
    }
    await fs.mkdir(abs, { recursive: true });
    await chmodQuiet(abs, saved.mode);
    return action;
  }

  if (saved.kind === 'link') {
    if (current?.kind === 'link' && current.target === saved.target) {
      return 'same';
    }
    const action = current === null ? 're-created' : 'restored';
    if (current !== null) {
      await removeEntry(abs, current);
    }
    await fs.mkdir(dirname(abs), { recursive: true });
    await fs.symlink(saved.target, abs);
    return action;
  }

  if (current?.kind === 'file') {
    const bytes = await fs.readFile(abs);
    if (bytes.equals(saved.bytes) && current.mode === saved.mode) {
      return 'same';
    }
    await chmodQuiet(abs, 0o666);
    await fs.writeFile(abs, saved.bytes);
    await fs.chmod(abs, saved.mode);
    return 'restored';
  }
  const action = current === null ? 're-created' : 'restored';
  if (current !== null) {
    await removeEntry(abs, current);
  }
  await fs.mkdir(dirname(abs), { recursive: true });
  await fs.writeFile(abs, saved.bytes);
  await fs.chmod(abs, saved.mode);
  return action;
}

/**
 * Restores the protected set after a command, whatever happened to it. Order: the locked modes
 * go back first; each saved path is put back, parents first; then, with the ignore rules read
 * again, the files and links the command created are deleted, and the folders it created are
 * removed when empty, deepest first. Returns one record per path changed, and `incomplete` when
 * a path could not be put back. Never throws.
 */
export async function restoreAfterRun(snapshot: Snapshot): Promise<RestoreResult> {
  const { root } = snapshot;
  const records: RevertRecord[] = [];
  let incomplete = false;
  const note = (rel: string, action: RevertAction): void => {
    records.push({ path: rel, area: areaOf(rel), action });
  };

  for (const { abs, mode } of [...snapshot.locked].reverse()) {
    await chmodQuiet(abs, mode);
  }
  snapshot.locked.length = 0;

  // The saved paths first, parents first. Each is read as it is now. Their bytes and modes come
  // back before any ignore rule is read, so a .gitignore the command edited is put back first.
  const savedRels = [...snapshot.saved.keys()].sort(
    (a, b) => depthOf(a) - depthOf(b) || (a < b ? -1 : a > b ? 1 : 0),
  );
  for (const rel of savedRels) {
    const saved = snapshot.saved.get(rel);
    if (saved === undefined) {
      continue;
    }
    try {
      const outcome = await restoreOne(join(root, rel), saved, await statEntry(root, rel));
      if (outcome !== 'same') {
        note(rel, outcome);
      }
    } catch {
      incomplete = true;
    }
  }

  // The created paths. The reviewer's ignore rules are read again now, so a file the command
  // created that git ignores (for example a log) is kept, as the rule says.
  let now: Map<string, Listed>;
  try {
    const fresh = snapshot.job === 'reviewer' ? await gitIgnoredEntries(root, snapshot.env) : null;
    now = await listProtected(root, snapshot.scopes, fresh ?? snapshot.ignored);
  } catch {
    return { records, incomplete: true };
  }

  // Files and links the command created.
  for (const [rel, entry] of now) {
    if (entry.kind === 'dir' || snapshot.saved.has(rel)) {
      continue;
    }
    try {
      await removeEntry(entry.abs, entry);
      note(rel, 'deleted');
    } catch {
      incomplete = true;
    }
  }

  // Folders the command created, deepest first; only when they are empty now.
  const createdFolders = [...now]
    .filter(([rel, entry]) => entry.kind === 'dir' && !snapshot.saved.has(rel))
    .map(([rel]) => rel)
    .sort((a, b) => depthOf(b) - depthOf(a));
  for (const rel of createdFolders) {
    try {
      await fs.rmdir(join(root, rel));
      note(rel, 'deleted');
    } catch {
      // Not empty (it holds ignored or kept files), or already gone: nothing to revert.
    }
  }

  // Folder modes last, so no child write is blocked by a read-only parent.
  for (const rel of savedRels) {
    const saved = snapshot.saved.get(rel);
    if (saved?.kind === 'dir') {
      await chmodQuiet(join(root, rel), saved.mode);
    }
  }

  return { records, incomplete };
}
