import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { READ_FILE_MAX_BYTES, readFileInRoot } from '../../src/main/tools/read-file';

/** True when this OS lets the test process create a file symlink (Windows may refuse). */
function probeSymlinks(): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'read-file-probe-'));
  try {
    writeFileSync(join(dir, 'target.txt'), 'x');
    symlinkSync(join(dir, 'target.txt'), join(dir, 'link.txt'), 'file');
    unlinkSync(join(dir, 'link.txt'));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const canSymlink = probeSymlinks();

let base: string;
let root: string;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'read-file-'));
  root = join(base, 'root');
  mkdirSync(join(root, 'sub'), { recursive: true });
  writeFileSync(join(root, 'a.txt'), 'hello from a');
  writeFileSync(join(root, 'unicode.txt'), 'café – naïve ✓');
  writeFileSync(join(base, 'outside.txt'), 'outside the root');
  // A `..` segment that stays inside the root, and an empty subdirectory is a directory.
  writeFileSync(join(root, 'sub', 'inner.txt'), 'inner');
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

function expectFailed(result: Awaited<ReturnType<typeof readFileInRoot>>): string {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error('expected a failed result');
  }
  expect(result.reason.length).toBeGreaterThan(0);
  return result.reason;
}

describe('readFileInRoot: reads inside the root', () => {
  it('returns the exact text of a regular file under the root', async () => {
    expect(await readFileInRoot(root, 'a.txt')).toEqual({ ok: true, output: 'hello from a' });
  });

  it('returns multi-byte text unchanged', async () => {
    expect(await readFileInRoot(root, 'unicode.txt')).toEqual({
      ok: true,
      output: 'café – naïve ✓',
    });
  });

  it('allows a path that goes down and back up but stays inside the root', async () => {
    expect(await readFileInRoot(root, 'sub/../a.txt')).toEqual({
      ok: true,
      output: 'hello from a',
    });
  });

  it('allows a file in a subdirectory', async () => {
    expect(await readFileInRoot(root, 'sub/inner.txt')).toEqual({ ok: true, output: 'inner' });
  });
});

describe('readFileInRoot: refusals', () => {
  it('fails when no root is configured', async () => {
    expect(expectFailed(await readFileInRoot(undefined, 'a.txt'))).toContain('no root');
    expect(expectFailed(await readFileInRoot('', 'a.txt'))).toContain('no root');
  });

  it('fails when the root does not exist or is a file', async () => {
    expectFailed(await readFileInRoot(join(base, 'missing-root'), 'a.txt'));
    expectFailed(await readFileInRoot(join(root, 'a.txt'), 'a.txt'));
  });

  it('fails when the path is not a non-empty string', async () => {
    expectFailed(await readFileInRoot(root, ''));
    expectFailed(await readFileInRoot(root, 7));
    expectFailed(await readFileInRoot(root, null));
    expectFailed(await readFileInRoot(root, ['a.txt']));
  });

  it('fails for an absolute path, even one inside the root', async () => {
    expect(expectFailed(await readFileInRoot(root, join(root, 'a.txt')))).toContain('absolute');
    expectFailed(await readFileInRoot(root, join(base, 'outside.txt')));
  });

  it('fails for a `..` path that escapes the root', async () => {
    expect(expectFailed(await readFileInRoot(root, '../outside.txt'))).toContain('outside');
    expectFailed(await readFileInRoot(root, 'sub/../../outside.txt'));
    expectFailed(await readFileInRoot(root, '..'));
  });

  it('fails for a directory', async () => {
    expect(expectFailed(await readFileInRoot(root, 'sub'))).toContain('not a regular file');
    expectFailed(await readFileInRoot(root, '.'));
  });

  it('fails for a missing file', async () => {
    expect(expectFailed(await readFileInRoot(root, 'nope.txt'))).toContain('does not exist');
  });

  it('never echoes the path in a reason', async () => {
    const reason = expectFailed(await readFileInRoot(root, 'secret-name.txt'));
    expect(reason).not.toContain('secret-name');
  });

  it.skipIf(!canSymlink)('fails for a symlink that resolves outside the root', async () => {
    symlinkSync(join(base, 'outside.txt'), join(root, 'escape.txt'), 'file');
    try {
      expect(expectFailed(await readFileInRoot(root, 'escape.txt'))).toContain('outside');
    } finally {
      unlinkSync(join(root, 'escape.txt'));
    }
  });

  it.skipIf(!canSymlink)('allows a symlink that resolves inside the root', async () => {
    symlinkSync(join(root, 'a.txt'), join(root, 'inner-link.txt'), 'file');
    try {
      expect(await readFileInRoot(root, 'inner-link.txt')).toEqual({
        ok: true,
        output: 'hello from a',
      });
    } finally {
      unlinkSync(join(root, 'inner-link.txt'));
    }
  });
});

describe('readFileInRoot: size cap', () => {
  it('returns a file of exactly the cap', async () => {
    const big = 'a'.repeat(READ_FILE_MAX_BYTES);
    writeFileSync(join(root, 'at-cap.txt'), big);
    const result = await readFileInRoot(root, 'at-cap.txt');
    expect(result).toEqual({ ok: true, output: big });
  });

  it('refuses a file one byte over the cap, with the cap in the reason and no partial output', async () => {
    writeFileSync(join(root, 'over-cap.txt'), 'a'.repeat(READ_FILE_MAX_BYTES + 1));
    const result = await readFileInRoot(root, 'over-cap.txt');
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('output');
    expect(expectFailed(result)).toContain('64 KiB');
  });
});
