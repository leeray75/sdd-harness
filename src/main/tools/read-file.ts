// Main-side runner for the read_file tool. Reads one regular file inside one root, after
// resolving real paths, and returns its text. Runs only in main, only after the gate allows
// the call. Pure apart from fs. Reasons are fixed strings: they never echo the path or the
// file's contents.

import type { ToolEnvironment } from '../env/types';
import { resolveInRoot } from './paths';

/** Largest file, in bytes, that read_file returns. Larger files are refused, never truncated. */
export const READ_FILE_MAX_BYTES = 64 * 1024;

export type ReadFileResult = { ok: true; output: string } | { ok: false; reason: string };

const NOT_A_FILE = 'the path is not a regular file; directories cannot be read';
const TOO_LARGE = `the file is larger than the ${READ_FILE_MAX_BYTES / 1024} KiB limit; nothing was returned`;
const READ_FAILED = 'the file could not be read';

function fail(reason: string): ReadFileResult {
  return { ok: false, reason };
}

/**
 * Reads `path` (relative to `root`) and returns its text. Refuses, with a `failed` reason:
 * no root, a missing or non-directory root, absolute paths, `.git` paths, paths or symlinks
 * that resolve outside the root, directories, missing files, and files over READ_FILE_MAX_BYTES.
 */
export async function readFileInRoot(
  env: ToolEnvironment,
  root: unknown,
  path: unknown,
): Promise<ReadFileResult> {
  const resolved = await resolveInRoot(env, root, path, { mustExist: true });
  if (!resolved.ok) {
    return fail(resolved.reason);
  }
  const realFile = resolved.target;

  let info;
  try {
    info = await env.files.stat(realFile);
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
    bytes = await env.files.readFile(realFile);
  } catch {
    return fail(READ_FAILED);
  }
  // The file may have grown between stat and read; refuse rather than return part of it.
  if (bytes.length > READ_FILE_MAX_BYTES) {
    return fail(TOO_LARGE);
  }
  return { ok: true, output: bytes.toString('utf8') };
}
