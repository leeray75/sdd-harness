// Main-side runner for the read_file tool. Reads one regular file inside one root, after
// resolving real paths, and returns its text. Runs only in main, only after the gate allows
// the call. Pure apart from fs. Reasons are fixed strings: they never echo the path or the
// file's contents.

import { promises as fs } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/** Largest file, in bytes, that read_file returns. Larger files are refused, never truncated. */
export const READ_FILE_MAX_BYTES = 64 * 1024;

export type ReadFileResult = { ok: true; output: string } | { ok: false; reason: string };

const NO_ROOT = 'read_file is not available: no root is configured';
const ROOT_UNREADABLE = 'read_file is not available: the root is not a readable directory';
const BAD_PATH = 'read_file needs a non-empty string path';
const ABSOLUTE = 'absolute paths are not allowed; give a path relative to the root';
const OUTSIDE = 'the path resolves outside the root';
const MISSING = 'the file does not exist';
const NOT_A_FILE = 'the path is not a regular file; directories cannot be read';
const TOO_LARGE = `the file is larger than the ${READ_FILE_MAX_BYTES / 1024} KiB limit; nothing was returned`;
const READ_FAILED = 'the file could not be read';

function fail(reason: string): ReadFileResult {
  return { ok: false, reason };
}

/** True when `target` is `root` or lies below it. Both must already be real, absolute paths. */
function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  if (isAbsolute(rel)) {
    return false;
  }
  return rel !== '..' && !rel.startsWith(`..${sep}`);
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'ENOENT'
  );
}

/**
 * Reads `path` (relative to `root`) and returns its text. Refuses, with a `failed` reason:
 * no root, a missing or non-directory root, absolute paths, paths or symlinks that resolve
 * outside the root, directories, missing files, and files over READ_FILE_MAX_BYTES.
 */
export async function readFileInRoot(root: unknown, path: unknown): Promise<ReadFileResult> {
  if (typeof root !== 'string' || root.length === 0) {
    return fail(NO_ROOT);
  }
  if (typeof path !== 'string' || path.length === 0) {
    return fail(BAD_PATH);
  }
  if (isAbsolute(path)) {
    return fail(ABSOLUTE);
  }

  let realRoot: string;
  try {
    realRoot = await fs.realpath(root);
    if (!(await fs.stat(realRoot)).isDirectory()) {
      return fail(ROOT_UNREADABLE);
    }
  } catch {
    return fail(ROOT_UNREADABLE);
  }

  // Refuse `..` escapes before touching the target.
  if (!isInside(realRoot, resolve(realRoot, path))) {
    return fail(OUTSIDE);
  }

  // Resolve symlinks, then check the real location again.
  let realFile: string;
  try {
    realFile = await fs.realpath(resolve(realRoot, path));
  } catch (error) {
    return fail(isNotFound(error) ? MISSING : READ_FAILED);
  }
  if (!isInside(realRoot, realFile)) {
    return fail(OUTSIDE);
  }

  let info;
  try {
    info = await fs.stat(realFile);
  } catch {
    return fail(READ_FAILED);
  }
  if (!info.isFile()) {
    return fail(NOT_A_FILE);
  }
  if (info.size > READ_FILE_MAX_BYTES) {
    return fail(TOO_LARGE);
  }

  let bytes: Buffer;
  try {
    bytes = await fs.readFile(realFile);
  } catch {
    return fail(READ_FAILED);
  }
  // The file may have grown between stat and read; refuse rather than return part of it.
  if (bytes.length > READ_FILE_MAX_BYTES) {
    return fail(TOO_LARGE);
  }
  return { ok: true, output: bytes.toString('utf8') };
}
