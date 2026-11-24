// Classifies a project-relative path into the areas the write rules use. Pure: no Electron or
// file-system imports. The path is normalized first, so the result does not depend on the
// separator, the letter case, or trailing dots and spaces in a segment.

export type PathArea =
  | { kind: 'outside' }
  | { kind: 'git' }
  | { kind: 'spec-doc'; feature: string; name: SpecDocName }
  | { kind: 'spec-other' }
  | { kind: 'source' };

// changes.md (D37) is the writer's record of what it touched; the planner never writes it.
export const SPEC_DOC_NAMES = [
  'plan.md',
  'specs.md',
  'tasks.md',
  'subtask.md',
  'changes.md',
] as const;

export type SpecDocName = (typeof SPEC_DOC_NAMES)[number];

const OUTSIDE: PathArea = { kind: 'outside' };
const GIT: PathArea = { kind: 'git' };
const SOURCE: PathArea = { kind: 'source' };
const SPEC_OTHER: PathArea = { kind: 'spec-other' };

const WINDOWS_DRIVE = /^[a-z]:/;
const SPEC_DOC_NAME_SET: ReadonlySet<string> = new Set<string>(SPEC_DOC_NAMES);

/**
 * Normalizes a path to lower-case segments with `/` separators, dropping empty and `.`
 * segments and removing the previous segment for `..`. Returns null when a `..` climbs above
 * the root, or when the path is absolute or starts with a drive letter. Each kept segment
 * loses its trailing dots and spaces.
 */
function normalizeSegments(path: string): string[] | null {
  const unified = path.replace(/\\/g, '/');
  if (unified.startsWith('/') || WINDOWS_DRIVE.test(unified.toLowerCase())) {
    return null;
  }
  const segments: string[] = [];
  for (const raw of unified.split('/')) {
    if (raw === '') {
      continue;
    }
    // Windows ignores trailing spaces, so `.. ` climbs exactly like `..`; check without them.
    const spaceless = raw.replace(/ +$/, '');
    if (spaceless === '.') {
      continue;
    }
    if (spaceless === '..') {
      if (segments.length === 0) {
        return null;
      }
      segments.pop();
      continue;
    }
    segments.push(raw.replace(/[. ]+$/, '').toLowerCase());
  }
  return segments;
}

/** The area of a project-relative path. Anything that cannot be a path inside the root is `outside`. */
export function classifyPath(path: string): PathArea {
  const segments = normalizeSegments(path);
  if (segments === null || segments.length === 0) {
    return OUTSIDE;
  }
  if (segments.some((segment) => segment.includes(':'))) {
    return OUTSIDE;
  }
  if (segments.includes('.git')) {
    return GIT;
  }
  if (segments[0] === 'docs' && segments[1] === 'specs') {
    if (segments.length === 4) {
      const name = segments[3] as string;
      if (SPEC_DOC_NAME_SET.has(name)) {
        return { kind: 'spec-doc', feature: segments[2] as string, name: name as SpecDocName };
      }
    }
    return SPEC_OTHER;
  }
  return SOURCE;
}

/** True when two areas are the same area: the same kind, and for spec-doc the same feature and name. */
export function sameArea(a: PathArea, b: PathArea): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  if (a.kind === 'spec-doc' && b.kind === 'spec-doc') {
    return a.feature === b.feature && a.name === b.name;
  }
  return true;
}
