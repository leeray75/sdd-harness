// Main-side runner for the edit_file tool. Replaces exact text in one existing regular file
// inside the root. Without replace_all, old_text must occur exactly once. Writes through the
// same temporary-file-and-rename path as write_file. Runs only in main, only after the gate
// allows the call. Reasons are fixed strings: they never echo the path or the text.

import type { EditFileArgs } from '../../shared/tools';
import type { ToolRunResult } from '../agent/router';
import type { ToolEnvironment } from '../env/types';
import { writeFileAtomic } from './atomic-write';
import { areaMismatch, resolveInRoot } from './paths';
import { WRITE_MAX_BYTES } from './write-file';

const EMPTY_OLD = 'old_text must not be empty; nothing was changed';
const NOT_FOUND = 'old_text was not found in the file; nothing was changed';
const NOT_UNIQUE =
  'old_text occurs more than once; set replace_all to true, or give a longer old_text; nothing was changed';
const TOO_LARGE = 'the edit would make the file larger than 1 MiB; nothing was changed';
const NOT_REGULAR = 'the path is not a regular file; nothing was changed';
const READ_FAILED = 'the file could not be read; nothing was changed';

/** Replaces the first occurrence of `oldText`. Uses indexOf, so `$` in `newText` stays literal. */
function replaceFirst(text: string, oldText: string, newText: string): string {
  const index = text.indexOf(oldText);
  return text.slice(0, index) + newText + text.slice(index + oldText.length);
}

/** Replaces the one occurrence of `old_text`, or every occurrence when `replace_all` is true. */
export async function editFileInRoot(
  env: ToolEnvironment,
  root: unknown,
  args: EditFileArgs,
): Promise<ToolRunResult> {
  if (args.old_text.length === 0) {
    return { ok: false, reason: EMPTY_OLD };
  }

  const resolved = await resolveInRoot(env, root, args.path, { mustExist: true });
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason };
  }
  // A symlink must not move the edit into another policy area (for example into the spec folder).
  const moved = areaMismatch(args.path, resolved.rel);
  if (moved !== null) {
    return { ok: false, reason: moved };
  }
  const target = resolved.target;

  try {
    if (!(await env.files.stat(target)).isFile()) {
      return { ok: false, reason: NOT_REGULAR };
    }
  } catch {
    return { ok: false, reason: READ_FAILED };
  }

  let text: string;
  try {
    text = (await env.files.readFile(target)).toString('utf8');
  } catch {
    return { ok: false, reason: READ_FAILED };
  }

  const occurrences = text.split(args.old_text).length - 1;
  if (occurrences === 0) {
    return { ok: false, reason: NOT_FOUND };
  }
  const replaceAll = args.replace_all === true;
  if (occurrences > 1 && !replaceAll) {
    return { ok: false, reason: NOT_UNIQUE };
  }

  const updated = replaceAll
    ? text.split(args.old_text).join(args.new_text)
    : replaceFirst(text, args.old_text, args.new_text);
  const bytes = Buffer.from(updated, 'utf8');
  if (bytes.length > WRITE_MAX_BYTES) {
    return { ok: false, reason: TOO_LARGE };
  }

  const written = await writeFileAtomic(env.files, target, bytes);
  if (!written.ok) {
    return { ok: false, reason: written.reason };
  }
  const replaced = replaceAll ? occurrences : 1;
  return {
    ok: true,
    output: `replaced ${replaced} ${replaced === 1 ? 'occurrence' : 'occurrences'} in ${resolved.rel}`,
  };
}
