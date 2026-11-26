// Main-side runner for the list_files tool. Lists the regular files under one folder of the
// root whose root-relative paths match a glob. Runs only in main, only after the gate allows
// the call. Reasons are fixed strings: they never echo the path or the pattern.

import { MAX_TOOL_OUTPUT_LENGTH } from '../../shared/agent-protocol';
import type { ListFilesArgs } from '../../shared/tools';
import type { ToolRunResult } from '../agent/router';
import type { ToolEnvironment } from '../env/types';
import { hasNodeModulesSegment, NODE_MODULES_REASON, resolveInRoot } from './paths';
import { globToRegExp, walkFiles, type FoundFile } from './walk';

/** Most entries list_files returns. More matches than this cut the list. */
export const LIST_MAX_ENTRIES = 1000;

/** The glob used when `pattern` is not given. */
export const DEFAULT_GLOB = '**/*';

/** Room kept at the end of the output for the note that says the list was cut. */
const NOTE_RESERVE = 256;

const EMPTY_PATTERN = 'the pattern must not be empty';
const EMPTY_PATH = 'the path must not be empty';
const NOT_A_FOLDER = 'the path is not a folder';

export type MatchResult =
  { ok: true; root: string; files: FoundFile[] } | { ok: false; reason: string };

/**
 * The regular files under `path` (default the root) whose root-relative path matches `glob`,
 * sorted. Shared by list_files and search_text, so both see the same set of files.
 */
export async function collectMatchingFiles(
  env: ToolEnvironment,
  root: unknown,
  path: string | undefined,
  glob: string | undefined,
): Promise<MatchResult> {
  if (glob === '') {
    return { ok: false, reason: EMPTY_PATTERN };
  }
  if (path === '') {
    return { ok: false, reason: EMPTY_PATH };
  }
  // Used by list_files and search_text. The walk skips node_modules anyway; a path into it is refused.
  if (path !== undefined && hasNodeModulesSegment(path)) {
    return { ok: false, reason: NODE_MODULES_REASON };
  }
  const resolved = await resolveInRoot(env, root, path ?? '.', { mustExist: true });
  if (!resolved.ok) {
    return resolved;
  }
  try {
    if (!(await env.files.stat(resolved.target)).isDirectory()) {
      return { ok: false, reason: NOT_A_FOLDER };
    }
  } catch {
    return { ok: false, reason: NOT_A_FOLDER };
  }
  const matcher = globToRegExp(glob ?? DEFAULT_GLOB);
  const all = await walkFiles(env, resolved.root, resolved.target);
  return { ok: true, root: resolved.root, files: all.filter((file) => matcher.test(file.rel)) };
}

/** Lists the matching regular files under a folder of the root, one per line, sorted. */
export async function listFilesInRoot(
  env: ToolEnvironment,
  root: unknown,
  args: ListFilesArgs,
): Promise<ToolRunResult> {
  const matched = await collectMatchingFiles(env, root, args.path, args.pattern);
  if (!matched.ok) {
    return { ok: false, reason: matched.reason };
  }
  if (matched.files.length === 0) {
    return { ok: true, output: 'no files matched' };
  }

  const lines: string[] = [];
  let used = 0;
  let note: string | null = null;
  for (const file of matched.files) {
    if (lines.length >= LIST_MAX_ENTRIES) {
      note = `list cut at ${LIST_MAX_ENTRIES.toLocaleString('en-US')} entries; more files matched`;
      break;
    }
    if (used + file.rel.length + 1 > MAX_TOOL_OUTPUT_LENGTH - NOTE_RESERVE) {
      note = `list cut at ${lines.length.toLocaleString('en-US')} entries to fit the 64 KiB output limit; more files matched`;
      break;
    }
    lines.push(file.rel);
    used += file.rel.length + 1;
  }
  if (note !== null) {
    lines.push(note);
  }
  return { ok: true, output: lines.join('\n') };
}
