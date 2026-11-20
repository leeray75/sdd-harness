// Main-side runner for the write_file tool. Creates or overwrites one regular file inside the
// root, creating missing folders inside the root, through a temporary file and a rename.
// Runs only in main, only after the gate allows the call. Reasons are fixed strings: they
// never echo the path or the content.

import { promises as fs, type Stats } from 'node:fs';
import { dirname } from 'node:path';
import { MAX_CONTENT_LENGTH, type WriteFileArgs } from '../../shared/tools';
import type { ToolRunResult } from '../agent/router';
import { writeFileAtomic } from './atomic-write';
import { resolveInRoot } from './paths';

/** Largest content, in bytes, that write_file or edit_file writes. */
export const WRITE_MAX_BYTES = 1024 * 1024;

const TOO_LARGE = 'the content is larger than 1 MiB; nothing was written';
const IS_FOLDER = 'the path is a folder; write_file needs a file path';
const NOT_REGULAR = 'the path is not a regular file; nothing was written';
const CHECK_FAILED = 'the path could not be checked; nothing was written';
const MAKE_FOLDERS_FAILED = 'the parent folders could not be created; nothing was written';

/**
 * What is at `target` without following a symlink: null when nothing is there, the stats
 * otherwise. Throws for any error other than "does not exist".
 */
async function existingEntry(target: string): Promise<Stats | null> {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      const code = (error as { code: unknown }).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        return null;
      }
    }
    throw error;
  }
}

/** Creates or overwrites one regular file under the root with `args.content`. */
export async function writeFileInRoot(root: unknown, args: WriteFileArgs): Promise<ToolRunResult> {
  const bytes = Buffer.from(args.content, 'utf8');
  if (bytes.length > WRITE_MAX_BYTES || args.content.length > MAX_CONTENT_LENGTH) {
    return { ok: false, reason: TOO_LARGE };
  }

  const resolved = await resolveInRoot(root, args.path, { mustExist: false });
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason };
  }
  const target = resolved.target;

  let existing: Stats | null;
  try {
    existing = await existingEntry(target);
  } catch {
    return { ok: false, reason: CHECK_FAILED };
  }
  if (existing !== null) {
    if (existing.isDirectory()) {
      return { ok: false, reason: IS_FOLDER };
    }
    if (!existing.isFile()) {
      return { ok: false, reason: NOT_REGULAR };
    }
  }

  try {
    await fs.mkdir(dirname(target), { recursive: true });
  } catch {
    return { ok: false, reason: MAKE_FOLDERS_FAILED };
  }

  const written = await writeFileAtomic(target, bytes);
  if (!written.ok) {
    return { ok: false, reason: written.reason };
  }
  return { ok: true, output: `wrote ${bytes.length} bytes to ${resolved.rel}` };
}
