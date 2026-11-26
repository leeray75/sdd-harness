// The approval lock on disk (p3-spec-lock, D36): reads and writes docs/specs/.sdd-state.json,
// hashes a feature's SPECS.md, and gives each feature its approval. It is the only main-side place
// that reads the state file or hashes a spec. The values and the rules are in
// src/shared/spec-state.ts. Nothing here throws: a failure is a result, and a symbolic link, a
// non-file or an oversized file is never followed or read whole. Every file call goes through the
// environment's files part (D41), so the lock works the same on any backend.

import { createHash } from 'node:crypto';
import { SPEC_FILES, SPECS_DIR, specFilePath, type SpecFileName } from '../../shared/spec-docs';
import type { Approval } from '../../shared/spec-detect';
import type { FileHandleLike, Environment } from '../env/types';
import {
  MAX_SPEC_STATE_BYTES,
  SPEC_STATE_FILE,
  approvalFor,
  normalizeSpecText,
  parseSpecState,
  serializeSpecState,
  type SpecStateFile,
} from '../../shared/spec-state';
import { writeFileAtomic } from '../tools/atomic-write';
import { MAX_SPEC_FILE_BYTES, scanSpecFolders, type SpecFolder } from './spec-folders';

/** What the state file holds right now, as read from disk. */
export type SpecStateRead =
  | { kind: 'absent' }
  | { kind: 'ok'; state: SpecStateFile }
  | { kind: 'unreadable'; reason: string };

/** The lock as approvalFor takes it: the parsed state, null when absent, or 'unreadable'. */
export type LockForApproval = SpecStateFile | null | 'unreadable';

/** The result of a capped read of one regular file. */
export type TextRead = { ok: true; text: string } | { ok: false; reason: string };

/** The result of an atomic write. */
export type WriteResult = { ok: true } | { ok: false; reason: string };

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String((error as { code: unknown }).code);
  }
  return 'error';
}

async function lstatOrNull(env: Environment, path: string) {
  try {
    return await env.files.lstat(path);
  } catch (error) {
    if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') return null;
    throw error;
  }
}

/** True when `path` is a folder that is not a symbolic link or junction. */
async function isRealDir(env: Environment, path: string): Promise<boolean> {
  try {
    const stats = await env.files.lstat(path);
    return stats.isDirectory() && !stats.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Reads a regular file of at most `cap` bytes as UTF-8 text. A symbolic link, a non-file, a file
 * over the cap (or one that grew past it) and any I/O error are returned as a reason.
 */
export async function readRegularText(
  env: Environment,
  path: string,
  cap: number,
): Promise<TextRead> {
  let handle: FileHandleLike | undefined;
  try {
    const stats = await env.files.lstat(path);
    if (stats.isSymbolicLink()) return { ok: false, reason: 'a symbolic link is not followed' };
    if (!stats.isFile()) return { ok: false, reason: 'not a regular file' };
    if (stats.size > cap) return { ok: false, reason: 'the file is over the size cap' };
    handle = await env.files.open(path, 'r');
    const buffer = Buffer.alloc(cap + 1);
    const { bytesRead } = await handle.read(buffer, 0, cap + 1, 0);
    if (bytesRead > cap) return { ok: false, reason: 'the file is over the size cap' };
    return { ok: true, text: buffer.subarray(0, bytesRead).toString('utf8') };
  } catch (error) {
    return { ok: false, reason: errorCode(error) };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * Reads the state file. `absent` when docs/specs or the file is missing. `unreadable` for a
 * symbolic link, a non-file, a file over MAX_SPEC_STATE_BYTES, an I/O error, or a file that does
 * not parse (the parser's fixed reason). Never throws.
 */
export async function readSpecState(env: Environment, root: string): Promise<SpecStateRead> {
  try {
    const dir = env.path.join(root, SPECS_DIR);
    const dirStats = await lstatOrNull(env, dir);
    if (dirStats === null) return { kind: 'absent' };
    if (dirStats.isSymbolicLink() || !dirStats.isDirectory()) {
      return { kind: 'unreadable', reason: 'docs/specs is not a folder' };
    }
    const path = env.path.join(dir, SPEC_STATE_FILE);
    const fileStats = await lstatOrNull(env, path);
    if (fileStats === null) return { kind: 'absent' };
    if (fileStats.isSymbolicLink()) {
      return { kind: 'unreadable', reason: 'a symbolic link is not followed' };
    }
    if (!fileStats.isFile()) return { kind: 'unreadable', reason: 'not a regular file' };
    const read = await readRegularText(env, path, MAX_SPEC_STATE_BYTES);
    if (!read.ok) return { kind: 'unreadable', reason: read.reason };
    const parsed = parseSpecState(read.text);
    if (!parsed.ok) return { kind: 'unreadable', reason: parsed.reason };
    return { kind: 'ok', state: parsed.state };
  } catch (error) {
    return { kind: 'unreadable', reason: errorCode(error) };
  }
}

/** The lock as approvalFor takes it. */
export function lockForApproval(read: SpecStateRead): LockForApproval {
  if (read.kind === 'absent') return null;
  if (read.kind === 'unreadable') return 'unreadable';
  return read.state;
}

/**
 * Writes the state file: the text goes to a temporary file beside it in docs/specs/ (`.<file>.<random>.tmp`), which is then
 * renamed over the file, so a reader sees the old file or the new one. The temp file is removed
 * when anything fails. Never throws.
 */
export async function writeSpecState(
  env: Environment,
  root: string,
  state: SpecStateFile,
): Promise<WriteResult> {
  const dir = env.path.join(root, SPECS_DIR);
  if (!(await isRealDir(env, dir))) return { ok: false, reason: 'docs/specs is not a folder' };
  return writeAtomic(env, env.path.join(dir, SPEC_STATE_FILE), serializeSpecState(state));
}

/**
 * Writes `text` to `path` through the shared atomic writer (D41, revision 1): a temp file in the same
 * folder, a rename with the shared retry, and the temp file removed when anything fails. The reason is
 * the Node code of the last error, a failed first write included. Never throws.
 */
export async function writeAtomic(
  env: Environment,
  path: string,
  text: string,
): Promise<WriteResult> {
  const written = await writeFileAtomic(env.files, path, Buffer.from(text, 'utf8'), {
    codeReason: true,
  });
  return written.ok ? { ok: true } : { ok: false, reason: written.reason };
}

/** The SHA-256 (hex) of a text after normalizeSpecText: the one hash input of the lock (D36). */
export function hashText(text: string): string {
  return createHash('sha256').update(normalizeSpecText(text), 'utf8').digest('hex');
}

/**
 * The path of one known file of a feature, when its folders are real folders and not links.
 * Null for an invalid feature or file name, or when docs/specs or the feature's folder is missing,
 * a symbolic link or a junction.
 */
export async function featureFilePath(
  env: Environment,
  root: string,
  feature: string,
  file: SpecFileName,
): Promise<string | null> {
  if (specFilePath(feature, file) === null || !(SPEC_FILES as readonly string[]).includes(file)) {
    return null;
  }
  const specsDir = env.path.join(root, SPECS_DIR);
  if (!(await isRealDir(env, specsDir))) return null;
  const folder = env.path.join(specsDir, feature);
  if (!(await isRealDir(env, folder))) return null;
  return env.path.join(folder, file);
}

/**
 * The SHA-256 of a feature's normalized SPECS.md, or null when the file is missing, unreadable, a
 * symbolic link, or over MAX_SPEC_FILE_BYTES.
 */
export async function hashSpec(
  env: Environment,
  root: string,
  feature: string,
): Promise<string | null> {
  const path = await featureFilePath(env, root, feature, 'SPECS.md');
  if (path === null) return null;
  const read = await readRegularText(env, path, MAX_SPEC_FILE_BYTES);
  return read.ok ? hashText(read.text) : null;
}

/**
 * The approval of one feature, read from disk. `feature` may be null (no feature open), which
 * gives `none` unless the state file is unreadable, which gives `unchecked`.
 */
export async function approvalOf(
  env: Environment,
  root: string,
  feature: string | null,
): Promise<Approval> {
  const lock = lockForApproval(await readSpecState(env, root));
  const locked =
    lock !== null && lock !== 'unreadable' && feature !== null && lock.feature === feature;
  const hash = locked ? await hashSpec(env, root, feature) : null;
  return approvalFor(lock, feature, hash);
}

/**
 * The current feature: the state file's feature when the file is valid, else the folder with the
 * greatest newest modification time. A tie goes to the smaller slug. Null when there is neither.
 */
export function currentFeature(read: SpecStateRead, folders: readonly SpecFolder[]): string | null {
  if (read.kind === 'ok') return read.state.feature;
  let best: SpecFolder | null = null;
  for (const folder of folders) {
    if (best === null || folder.newestMtime > best.newestMtime) {
      best = folder;
    } else if (folder.newestMtime === best.newestMtime && folder.feature < best.feature) {
      best = folder;
    }
  }
  return best?.feature ?? null;
}

/**
 * Scans docs/specs with the lock. The state is read once, and only the locked feature's SPECS.md
 * is hashed. Each folder's approval is then given to scanSpecFolders synchronously.
 */
export async function scanSpecFoldersWithLock(
  env: Environment,
  root: string,
): Promise<{ folders: SpecFolder[]; current: string | null }> {
  const read = await readSpecState(env, root);
  const lock = lockForApproval(read);
  const lockedFeature = lock !== null && lock !== 'unreadable' ? lock.feature : null;
  const lockedHash = lockedFeature === null ? null : await hashSpec(env, root, lockedFeature);
  const folders = await scanSpecFolders(env, root, (feature) =>
    approvalFor(lock, feature, feature === lockedFeature ? lockedHash : null),
  );
  return { folders, current: currentFeature(read, folders) };
}
