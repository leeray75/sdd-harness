// Path rules shared by every file tool. Resolves a relative path inside one project root, after
// real paths are resolved (symlinks, Windows short names), and refuses git. Runs only in main.
// Reasons are fixed strings: they never echo the path or the file's contents.

import { promises as fs, realpath } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * Real path with the OS's native resolver. On Windows this also expands 8.3 short names
 * (for example GIT~1 to .git), so the .git check sees the name the OS would open.
 */
function realpathNative(path: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    realpath.native(path, (error, resolved) => {
      if (error) {
        reject(error);
      } else {
        resolvePromise(resolved);
      }
    });
  });
}

export const NO_ROOT_REASON = 'no root is configured';
export const ROOT_UNREADABLE_REASON = 'the root is not a readable directory';
export const BAD_PATH_REASON = 'the path must be a non-empty string';
export const ABSOLUTE_REASON = 'absolute paths are not allowed; give a path relative to the root';
export const OUTSIDE_REASON = 'the path resolves outside the root';
export const GIT_REASON = 'paths inside .git are not allowed';
export const MISSING_REASON = 'the path does not exist';
export const NOT_A_FOLDER_REASON = 'a parent of the path is not a folder';
export const RESOLVE_FAILED_REASON = 'the path could not be resolved';

/** The outcome of resolving a path: the real root and target, or the reason it was refused. */
export type ResolvedPath =
  { ok: true; root: string; target: string; rel: string } | { ok: false; reason: string };

function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

/** True when `target` is `root` or lies below it. Both must already be real, absolute paths. */
export function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  if (isAbsolute(rel)) {
    return false;
  }
  return rel !== '..' && !rel.startsWith(`..${sep}`);
}

/**
 * True when any segment of `path` is `.git`, ignoring case. Trailing dots and spaces are
 * ignored too, because Windows treats `.git.` and `.git ` as `.git`. Accepts `/` and `\`.
 */
export function hasGitSegment(path: string): boolean {
  return path.split(/[\\/]+/).some((segment) => {
    const normal = segment.toLowerCase().replace(/[. ]+$/, '');
    return normal === '.git';
  });
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/** True for the errors that mean "this path does not exist as given". */
function isMissing(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * For a path whose final parts do not exist yet: walks up to the deepest existing parent,
 * resolves it, and checks that it is a folder. Returns the real parent joined with the rest.
 */
async function resolveMissing(
  lexical: string,
): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  const rest: string[] = [];
  let current = lexical;
  for (;;) {
    rest.unshift(basename(current));
    const parent = dirname(current);
    if (parent === current) {
      return fail(RESOLVE_FAILED_REASON);
    }
    current = parent;
    try {
      const real = await realpathNative(current);
      if (!(await fs.stat(real)).isDirectory()) {
        return fail(NOT_A_FOLDER_REASON);
      }
      return { ok: true, path: join(real, ...rest) };
    } catch (error) {
      if (!isMissing(error)) {
        return fail(RESOLVE_FAILED_REASON);
      }
    }
  }
}

/**
 * Resolves `path` (relative to `root`) for a file tool. Refuses, with a fixed reason: a missing
 * or non-folder root, an empty or non-string path, an absolute path, any `.git` segment, a path
 * that resolves outside the root (before or after symlinks are resolved), and, when
 * `mustExist` is true, a path that does not exist. When the path does not exist yet, its
 * deepest existing parent is resolved and checked, and the result is that parent plus the rest.
 */
export async function resolveInRoot(
  root: unknown,
  path: unknown,
  options: { mustExist: boolean },
): Promise<ResolvedPath> {
  if (typeof root !== 'string' || root.length === 0) {
    return fail(NO_ROOT_REASON);
  }
  if (typeof path !== 'string' || path.length === 0) {
    return fail(BAD_PATH_REASON);
  }
  if (isAbsolute(path)) {
    return fail(ABSOLUTE_REASON);
  }
  if (hasGitSegment(path)) {
    return fail(GIT_REASON);
  }

  let realRoot: string;
  try {
    realRoot = await realpathNative(root);
    if (!(await fs.stat(realRoot)).isDirectory()) {
      return fail(ROOT_UNREADABLE_REASON);
    }
  } catch {
    return fail(ROOT_UNREADABLE_REASON);
  }

  // Refuse `..` escapes before touching the target.
  const lexical = resolve(realRoot, path);
  if (!isInside(realRoot, lexical)) {
    return fail(OUTSIDE_REASON);
  }

  // Resolve symlinks, then check the real location again.
  let real: string;
  try {
    real = await realpathNative(lexical);
  } catch (error) {
    if (!isMissing(error)) {
      return fail(RESOLVE_FAILED_REASON);
    }
    if (options.mustExist) {
      return fail(MISSING_REASON);
    }
    const resolved = await resolveMissing(lexical);
    if (!resolved.ok) {
      return resolved;
    }
    real = resolved.path;
  }

  if (!isInside(realRoot, real)) {
    return fail(OUTSIDE_REASON);
  }
  const realRel = relative(realRoot, real);
  if (hasGitSegment(realRel)) {
    return fail(GIT_REASON);
  }
  return {
    ok: true,
    root: realRoot,
    target: real,
    rel: realRel.split(sep).join('/'),
  };
}
