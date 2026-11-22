import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MAX_SPEC_STATE_BYTES,
  SPEC_STATE_FILE,
  SPEC_STATE_VERSION,
  approvalFor,
  hasRequiredHeadings,
  normalizeSpecText,
  parseSpecState,
  serializeSpecState,
  setFrontmatterStatus,
  type SpecStateFile,
} from '../../src/shared/spec-state';

const BOM = '﻿';
const HASH = 'a'.repeat(64);
const OTHER_HASH = 'b'.repeat(64);

const LOCK: SpecStateFile = {
  version: 1,
  feature: 'p3-x',
  sha256: HASH,
  approvedAt: '2026-11-22T10:00:00.000Z',
  editing: false,
};

function withKeys(changes: Record<string, unknown>): string {
  return JSON.stringify({ ...LOCK, ...changes });
}

describe('constants', () => {
  it('names the file, the version and the cap', () => {
    expect(SPEC_STATE_FILE).toBe('.sdd-state.json');
    expect(SPEC_STATE_VERSION).toBe(1);
    expect(MAX_SPEC_STATE_BYTES).toBe(4096);
  });
});

describe('parseSpecState (AC2)', () => {
  it('accepts a valid state and returns it', () => {
    expect(parseSpecState(JSON.stringify(LOCK))).toEqual({ ok: true, state: LOCK });
  });

  it('reports malformed text: not JSON, not text, not an object, or an array', () => {
    for (const text of ['{not json', '', 'null', '42', '"x"', '[1,2]']) {
      const got = parseSpecState(text);
      expect(got.ok, text).toBe(false);
      if (!got.ok) expect(got.problem, text).toBe('malformed');
    }
    expect(parseSpecState(undefined).ok).toBe(false);
  });

  it('reports wrong-version when version is present and not 1', () => {
    expect(parseSpecState(withKeys({ version: 2 }))).toMatchObject({
      ok: false,
      problem: 'wrong-version',
    });
    expect(parseSpecState(withKeys({ version: '1' }))).toMatchObject({
      ok: false,
      problem: 'wrong-version',
    });
  });

  it('reports invalid for a missing or extra key', () => {
    const missing = JSON.stringify({ ...LOCK, feature: undefined });
    expect(parseSpecState(missing)).toMatchObject({ ok: false, problem: 'invalid' });
    expect(parseSpecState(withKeys({ extra: true }))).toMatchObject({
      ok: false,
      problem: 'invalid',
    });
    const noVersion = JSON.stringify({
      feature: 'p3-x',
      sha256: HASH,
      approvedAt: LOCK.approvedAt,
      editing: false,
    });
    expect(parseSpecState(noVersion)).toMatchObject({ ok: false, problem: 'invalid' });
  });

  it('reports invalid for a bad slug, including a double dash and a leading dash', () => {
    for (const feature of ['a--b', '-a', 'a-', 'Upper', '../x', 'x'.repeat(65), 7]) {
      expect(parseSpecState(withKeys({ feature })), String(feature)).toMatchObject({
        ok: false,
        problem: 'invalid',
      });
    }
  });

  it('reports invalid for a hash that is not 64 lowercase hex characters', () => {
    for (const sha256 of ['A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64), 'a'.repeat(65)]) {
      expect(parseSpecState(withKeys({ sha256 }))).toMatchObject({
        ok: false,
        problem: 'invalid',
      });
    }
  });

  it('reports invalid for a time that is not ISO 8601 UTC, or not a real date', () => {
    for (const approvedAt of [
      '2026-11-22',
      '2026-11-22T10:00:00+01:00',
      'yesterday',
      '2026-13-45T99:00:00Z',
    ]) {
      expect(parseSpecState(withKeys({ approvedAt })), approvedAt).toMatchObject({
        ok: false,
        problem: 'invalid',
      });
    }
  });

  it('reports invalid for a flag that is not a boolean', () => {
    expect(parseSpecState(withKeys({ editing: 'no' }))).toMatchObject({
      ok: false,
      problem: 'invalid',
    });
  });

  it('never echoes a value in its reason', () => {
    const secret = 'SECRET-VALUE-123';
    const got = parseSpecState(withKeys({ feature: secret }));
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.reason).not.toContain(secret);
  });
});

describe('serializeSpecState', () => {
  it('writes 2-space JSON in key order with a trailing newline, and parses back', () => {
    const text = serializeSpecState(LOCK);
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('\n  "version": 1,\n');
    expect(parseSpecState(text)).toEqual({ ok: true, state: LOCK });
  });
});

describe('normalizeSpecText', () => {
  it('drops one leading BOM and turns every CRLF into LF', () => {
    expect(normalizeSpecText(`${BOM}a\r\nb\r\n`)).toBe('a\nb\n');
    expect(normalizeSpecText(`${BOM}${BOM}x`)).toBe(`${BOM}x`);
    expect(normalizeSpecText('plain\n')).toBe('plain\n');
  });
});

describe('approvalFor (AC1 table)', () => {
  it('is none with no lock, and with another feature locked', () => {
    expect(approvalFor(null, 'p3-x', HASH)).toBe('none');
    expect(approvalFor(LOCK, 'p3-other', HASH)).toBe('none');
    expect(approvalFor(LOCK, null, HASH)).toBe('none');
  });

  it('is unchecked when the lock is unreadable, whatever the feature', () => {
    expect(approvalFor('unreadable', 'p3-x', HASH)).toBe('unchecked');
    expect(approvalFor('unreadable', 'p3-other', HASH)).toBe('unchecked');
  });

  it('is unchecked when SPECS.md is missing or unreadable (hash null) for the locked feature', () => {
    expect(approvalFor(LOCK, 'p3-x', null)).toBe('unchecked');
  });

  it('is approved when the hash matches and the lock is not editing', () => {
    expect(approvalFor(LOCK, 'p3-x', HASH)).toBe('approved');
  });

  it('is changed when the hash differs', () => {
    expect(approvalFor(LOCK, 'p3-x', OTHER_HASH)).toBe('changed');
  });

  it('is changed when editing is true, even with the same hash', () => {
    expect(approvalFor({ ...LOCK, editing: true }, 'p3-x', HASH)).toBe('changed');
  });
});

describe('setFrontmatterStatus', () => {
  it('replaces an existing status line inside the frontmatter', () => {
    const text = '---\nstatus: draft\nticket: T-1\n---\n\n# Spec\n';
    expect(setFrontmatterStatus(text, 'approved')).toBe(
      '---\nstatus: approved\nticket: T-1\n---\n\n# Spec\n',
    );
  });

  it('adds a status line before the closing --- when the frontmatter has none', () => {
    const text = '---\nticket: T-1\n---\n# Spec\n';
    expect(setFrontmatterStatus(text, 'approved')).toBe(
      '---\nticket: T-1\nstatus: approved\n---\n# Spec\n',
    );
  });

  it('prepends a frontmatter block when the text has none', () => {
    expect(setFrontmatterStatus('# Spec\n', 'approved')).toBe(
      '---\nstatus: approved\n---\n# Spec\n',
    );
  });

  it('prepends a block when the frontmatter is never closed', () => {
    expect(setFrontmatterStatus('---\nticket: x\n# Spec\n', 'approved')).toBe(
      '---\nstatus: approved\n---\n---\nticket: x\n# Spec\n',
    );
  });

  it('keeps CRLF line endings, including on a line it adds', () => {
    expect(setFrontmatterStatus('---\r\nstatus: draft\r\n---\r\n# S\r\n', 'approved')).toBe(
      '---\r\nstatus: approved\r\n---\r\n# S\r\n',
    );
    expect(setFrontmatterStatus('---\r\nticket: x\r\n---\r\n', 'approved')).toBe(
      '---\r\nticket: x\r\nstatus: approved\r\n---\r\n',
    );
    expect(setFrontmatterStatus('# S\r\n', 'approved')).toBe(
      '---\r\nstatus: approved\r\n---\r\n# S\r\n',
    );
  });

  it('keeps a leading BOM', () => {
    expect(setFrontmatterStatus(`${BOM}---\nstatus: draft\n---\n`, 'approved')).toBe(
      `${BOM}---\nstatus: approved\n---\n`,
    );
  });

  it('ignores a status line after the closing ---', () => {
    const text = '---\nticket: x\n---\nstatus: body\n';
    expect(setFrontmatterStatus(text, 'approved')).toBe(
      '---\nticket: x\nstatus: approved\n---\nstatus: body\n',
    );
  });
});

describe('hasRequiredHeadings', () => {
  it('needs both the Goals and the Acceptance criteria headings', () => {
    expect(hasRequiredHeadings('## Goals\n\n## Acceptance criteria\n')).toBe(true);
    expect(hasRequiredHeadings('## Goals\r\n## Acceptance criteria\r\n')).toBe(true);
    expect(hasRequiredHeadings('## Goals\n')).toBe(false);
    expect(hasRequiredHeadings('## Acceptance criteria\n')).toBe(false);
    expect(hasRequiredHeadings('### Goals\n## Acceptance criteria\n')).toBe(false);
  });
});

describe('purity (AC8)', () => {
  it('imports nothing from Node, Electron or the DOM', () => {
    const path = fileURLToPath(new URL('../../src/shared/spec-state.ts', import.meta.url));
    const text = readFileSync(path, 'utf8');
    const specifiers = [...text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map(
      (match) => match[1] ?? '',
    );
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(specifier.startsWith('node:'), specifier).toBe(false);
      expect(specifier, specifier).not.toMatch(/electron/);
    }
    expect(text).not.toMatch(/\b(window|document)\b/);
  });
});
