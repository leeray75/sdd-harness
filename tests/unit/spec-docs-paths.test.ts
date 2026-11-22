import { describe, expect, it } from 'vitest';
import { MAX_FEATURE_LENGTH } from '../../src/shared/human-actions';
import { SPEC_FILES, SPECS_DIR, isFeatureSlug, specFilePath } from '../../src/shared/spec-docs';

describe('the docs/specs layout (AC2)', () => {
  it('SPECS_DIR is docs/specs', () => {
    expect(SPECS_DIR).toBe('docs/specs');
  });

  it('SPEC_FILES lists exactly the seven known names', () => {
    expect([...SPEC_FILES].sort()).toEqual(
      [
        'PLAN.md',
        'SPECS.md',
        'tasks.md',
        'SUBTASK.md',
        'build-ledger.md',
        'changes.md',
        'SUMMARY.md',
      ].sort(),
    );
  });
});

describe('isFeatureSlug (AC2)', () => {
  it('accepts slugs that match FEATURE_SLUG_PATTERN within MAX_FEATURE_LENGTH', () => {
    for (const slug of [
      'p3-spec-docs',
      'a',
      '0',
      'p3-state-machine',
      'x'.repeat(MAX_FEATURE_LENGTH),
    ]) {
      expect(isFeatureSlug(slug), slug).toBe(true);
    }
  });

  it('refuses what the pattern and the length limit refuse', () => {
    const refused: unknown[] = [
      '',
      'Uppercase',
      '..',
      '.',
      'a/b',
      'a\\b',
      '/abs',
      'a b',
      'a..b',
      '-a',
      'a-',
      'a--b',
      'x'.repeat(MAX_FEATURE_LENGTH + 1),
      42,
      null,
      undefined,
      ['a'],
    ];
    for (const value of refused) {
      expect(isFeatureSlug(value), String(value)).toBe(false);
    }
  });
});

describe('specFilePath (AC2)', () => {
  it('returns docs/specs/<feature>/<file> for a valid slug and a known name', () => {
    expect(specFilePath('p3-spec-docs', 'PLAN.md')).toBe('docs/specs/p3-spec-docs/PLAN.md');
    expect(specFilePath('p3-spec-docs', 'build-ledger.md')).toBe(
      'docs/specs/p3-spec-docs/build-ledger.md',
    );
  });

  it('returns a path for every known name', () => {
    for (const file of SPEC_FILES) {
      expect(specFilePath('p3-spec-docs', file)).toBe(`docs/specs/p3-spec-docs/${file}`);
    }
  });

  it('refuses traversal, separators and absolute paths in the feature', () => {
    for (const feature of ['..', '.', 'a/b', 'a\\b', '/abs', 'C:\\x', '../x', 'x/..']) {
      expect(specFilePath(feature, 'PLAN.md'), feature).toBeNull();
    }
  });

  it('refuses traversal, separators and absolute paths in the file name', () => {
    for (const file of [
      '../PLAN.md',
      './PLAN.md',
      'sub/PLAN.md',
      'a\\PLAN.md',
      '/etc/passwd',
      'C:/PLAN.md',
      '..',
    ]) {
      expect(specFilePath('p3-spec-docs', file), file).toBeNull();
    }
  });

  it('refuses an empty name, uppercase, a name not in the list, and a non-string', () => {
    for (const file of ['', 'plan.md', 'PLAN.MD', 'UNKNOWN.md', 'notes.txt']) {
      expect(specFilePath('p3-spec-docs', file), file).toBeNull();
    }
    expect(specFilePath('p3-spec-docs', 42)).toBeNull();
    expect(specFilePath('p3-spec-docs', null)).toBeNull();
    expect(specFilePath(42, 'PLAN.md')).toBeNull();
  });

  it('refuses an uppercase feature', () => {
    expect(specFilePath('P3-Spec', 'PLAN.md')).toBeNull();
  });
});
