// Shared folder walk and glob matcher for list_files and search_text. Runs only in main.
// The walk never descends into .git or node_modules and never follows a symlink: a symlink
// is neither a file nor a folder to it, so it is skipped. Matching uses root-relative paths
// with '/' separators.

import { promises as fs, type Dirent } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** One regular file found by the walk: its root-relative path (with '/') and absolute path. */
export interface FoundFile {
  rel: string;
  abs: string;
}

const SKIPPED_FOLDERS = ['.git', 'node_modules'];

function isSkipped(name: string): boolean {
  const lower = name.toLowerCase();
  return SKIPPED_FOLDERS.includes(lower);
}

function escapeChar(char: string): string {
  return /[.+^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
}

/**
 * Compiles a glob into an anchored regular expression over root-relative paths. `*` matches
 * within one segment, `**` matches across segments (`**\/` also matches none), and `?`
 * matches one character inside a segment. Every other character is literal. Backslashes are
 * read as `/`.
 */
export function globToRegExp(glob: string): RegExp {
  const pattern = glob.replace(/\\/g, '/');
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern.charAt(i);
    if (char === '*') {
      if (pattern.charAt(i + 1) === '*') {
        if (pattern.charAt(i + 2) === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else if (char === '?') {
      out += '[^/]';
    } else {
      out += escapeChar(char);
    }
  }
  return new RegExp(`^${out}$`);
}

/**
 * Every regular file under `start` (a real folder inside `realRoot`), sorted by root-relative
 * path. Unreadable folders are skipped rather than failing the walk.
 */
export async function walkFiles(realRoot: string, start: string): Promise<FoundFile[]> {
  const found: FoundFile[] = [];
  const folders: string[] = [start];
  while (folders.length > 0) {
    const folder = folders.pop() as string;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(folder, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (isSkipped(entry.name)) {
        continue;
      }
      const abs = join(folder, entry.name);
      if (entry.isDirectory()) {
        folders.push(abs);
      } else if (entry.isFile()) {
        found.push({ rel: relative(realRoot, abs).split(sep).join('/'), abs });
      }
    }
  }
  found.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return found;
}
