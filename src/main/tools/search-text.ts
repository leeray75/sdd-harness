// Main-side runner for the search_text tool. Searches the files that list_files would return
// for a folder and glob, for lines that match a JavaScript regular expression. Runs only in
// main, only after the gate allows the call. Reasons are fixed strings: they never echo the
// pattern, the path or the file's contents.

import { promises as fs } from 'node:fs';
import { MAX_TOOL_OUTPUT_LENGTH } from '../../shared/agent-protocol';
import type { SearchTextArgs } from '../../shared/tools';
import type { ToolRunResult } from '../agent/router';
import { collectMatchingFiles } from './list-files';

/** Most matches returned. A later match stops the search and says so. */
export const SEARCH_MAX_MATCHES = 200;

/** Files over this size, in bytes, are skipped. */
export const SEARCH_MAX_FILE_BYTES = 1024 * 1024;

/** A file whose first bytes hold a NUL is treated as binary and skipped. */
export const SEARCH_BINARY_PROBE_BYTES = 8 * 1024;

/** Each match's text is cut to this many characters. */
export const SEARCH_LINE_CHARS = 500;

/** Room kept at the end of the output for the note that says the search was cut. */
const NOTE_RESERVE = 256;

const BAD_PATTERN = 'the pattern is not a valid regular expression';

function isBinary(bytes: Buffer): boolean {
  return bytes.subarray(0, SEARCH_BINARY_PROBE_BYTES).includes(0);
}

/**
 * Searches the matching files for lines that match `pattern`. Returns `path:line: text` lines.
 * Stops with a note at SEARCH_MAX_MATCHES matches or at the output cap. Skips binary files and
 * files over SEARCH_MAX_FILE_BYTES.
 */
export async function searchTextInRoot(
  root: unknown,
  args: SearchTextArgs,
): Promise<ToolRunResult> {
  let matcher: RegExp;
  try {
    matcher = new RegExp(args.pattern);
  } catch {
    return { ok: false, reason: BAD_PATTERN };
  }

  const matched = await collectMatchingFiles(root, args.path, args.glob);
  if (!matched.ok) {
    return { ok: false, reason: matched.reason };
  }

  const lines: string[] = [];
  let used = 0;
  let matches = 0;
  let note: string | null = null;

  search: for (const file of matched.files) {
    let bytes: Buffer;
    try {
      const info = await fs.stat(file.abs);
      if (!info.isFile() || info.size > SEARCH_MAX_FILE_BYTES) {
        continue;
      }
      bytes = await fs.readFile(file.abs);
    } catch {
      continue;
    }
    if (bytes.length > SEARCH_MAX_FILE_BYTES || isBinary(bytes)) {
      continue;
    }

    const fileLines = bytes.toString('utf8').split('\n');
    for (let index = 0; index < fileLines.length; index++) {
      const line = (fileLines[index] as string).replace(/\r$/, '');
      if (!matcher.test(line)) {
        continue;
      }
      if (matches >= SEARCH_MAX_MATCHES) {
        note = `search stopped at ${SEARCH_MAX_MATCHES} matches; there may be more`;
        break search;
      }
      const text = `${file.rel}:${index + 1}: ${line.slice(0, SEARCH_LINE_CHARS)}`;
      if (used + text.length + 1 > MAX_TOOL_OUTPUT_LENGTH - NOTE_RESERVE) {
        note = 'search output cut at 64 KiB; there may be more matches';
        break search;
      }
      lines.push(text);
      used += text.length + 1;
      matches++;
    }
  }

  if (note !== null) {
    lines.push(note);
  }
  if (lines.length === 0) {
    return { ok: true, output: 'no matches' };
  }
  return { ok: true, output: lines.join('\n') };
}
