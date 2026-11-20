import { describe, expect, it } from 'vitest';
import { classifyPath, sameArea, type PathArea } from '../../src/main/policy/path-areas';

const OUTSIDE: PathArea = { kind: 'outside' };
const GIT: PathArea = { kind: 'git' };
const SOURCE: PathArea = { kind: 'source' };
const SPEC_OTHER: PathArea = { kind: 'spec-other' };
const specDoc = (feature: string, name: string): PathArea => ({
  kind: 'spec-doc',
  feature,
  name: name as 'specs.md',
});

const CASES: Array<[string, PathArea]> = [
  // separators and dot segments
  ['docs\\specs\\f\\SPECS.md', specDoc('f', 'specs.md')],
  ['docs/specs/f/SPECS.md', specDoc('f', 'specs.md')],
  ['./src/a.ts', SOURCE],
  ['a/../src/a.ts', SOURCE],
  ['a/./b.ts', SOURCE],
  ['a/../../x', OUTSIDE],
  ['../x', OUTSIDE],
  ['a\\..\\..\\x', OUTSIDE],
  ['./', OUTSIDE],
  ['a/../', OUTSIDE],
  ['', OUTSIDE],
  // case, trailing dots and spaces
  ['DOCS/Specs/F/SPECS.md', specDoc('f', 'specs.md')],
  ['docs/specs/f/specs.md.', specDoc('f', 'specs.md')],
  ['docs/specs/f/specs.md ', specDoc('f', 'specs.md')],
  ['docs/specs/f/Tasks.MD', specDoc('f', 'tasks.md')],
  ['docs/specs/f/subtask.md', specDoc('f', 'subtask.md')],
  ['docs/specs/f/plan.md', specDoc('f', 'plan.md')],
  ['docs/specs/f/.. /x.md', SPEC_OTHER],
  // outside the root
  ['C:/x', OUTSIDE],
  ['c:\\x', OUTSIDE],
  ['/x', OUTSIDE],
  ['//server/x', OUTSIDE],
  ['docs/specs/f/SPECS.md:stream', OUTSIDE],
  ['a:b/c', OUTSIDE],
  // git
  ['.GIT/config', GIT],
  ['a/.git/x', GIT],
  ['.git./config', GIT],
  // spec folder, but not a planning doc
  ['docs/specs', SPEC_OTHER],
  ['docs/specs/f/state.json', SPEC_OTHER],
  ['docs/specs/f/build-ledger.md', SPEC_OTHER],
  ['docs/specs/f/SUMMARY.md', SPEC_OTHER],
  ['docs/specs/f/x/SPECS.md', SPEC_OTHER],
  ['docs/specs/f', SPEC_OTHER],
  // source
  ['docs/specs-old/x', SOURCE],
  ['src/docs/specs/f/SPECS.md', SOURCE],
  ['docs/readme.md', SOURCE],
];

describe('classifyPath: the areas of the design', () => {
  it.each(CASES)('classifies %j', (path, expected) => {
    expect(classifyPath(path)).toEqual(expected);
  });

  it('has at least 25 cases', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(25);
  });
});

describe('sameArea', () => {
  it('compares spec-doc by feature and name as well as kind', () => {
    expect(sameArea(specDoc('f', 'specs.md'), specDoc('f', 'specs.md'))).toBe(true);
    expect(sameArea(specDoc('f', 'specs.md'), specDoc('g', 'specs.md'))).toBe(false);
    expect(sameArea(specDoc('f', 'specs.md'), specDoc('f', 'tasks.md'))).toBe(false);
    expect(sameArea(SOURCE, SOURCE)).toBe(true);
    expect(sameArea(SOURCE, SPEC_OTHER)).toBe(false);
  });
});
