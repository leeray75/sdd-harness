import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasGitSegment, resolveInRoot, type ResolvedPath } from '../../src/main/tools/paths';

/** True when this OS lets the test process create a symlink (Windows may refuse). */
function probeSymlinks(): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'tool-paths-probe-'));
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

/** True when this OS lets the test process create a directory symlink (junctions need no Developer Mode). */
function probeDirSymlinks(): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'tool-paths-dprobe-'));
  try {
    mkdirSync(join(dir, 'target'));
    symlinkSync(join(dir, 'target'), join(dir, 'link'), 'junction');
    unlinkSync(join(dir, 'link'));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const canSymlink = probeSymlinks();
const canDirSymlink = probeDirSymlinks();

if (!canSymlink) {
  console.warn(
    'note: this OS cannot create file symlinks here; the file symlink tests are skipped',
  );
}
if (!canDirSymlink) {
  console.warn(
    'note: this OS cannot create directory links here; the folder link tests are skipped',
  );
}

let base: string;
let root: string;
let outside: string;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'tool-paths-'));
  root = join(base, 'root');
  outside = join(base, 'outside');
  mkdirSync(join(root, 'sub'), { recursive: true });
  mkdirSync(join(root, '.git'));
  mkdirSync(outside);
  writeFileSync(join(root, 'a.txt'), 'a');
  writeFileSync(join(root, 'sub', 'inner.txt'), 'inner');
  writeFileSync(join(root, '.git', 'config'), 'secret');
  writeFileSync(join(outside, 'secret.txt'), 'outside');
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

function expectRefused(result: ResolvedPath): string {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected a refusal');
  return result.reason;
}

function expectResolved(result: ResolvedPath): Extract<ResolvedPath, { ok: true }> {
  if (!result.ok) throw new Error(`expected a path, got: ${result.reason}`);
  return result;
}

describe('resolveInRoot: root and path checks', () => {
  it('refuses a missing root, an empty root, and a root that is a file', async () => {
    expect(expectRefused(await resolveInRoot(undefined, 'a.txt', { mustExist: true }))).toContain(
      'no root',
    );
    expect(expectRefused(await resolveInRoot('', 'a.txt', { mustExist: true }))).toContain(
      'no root',
    );
    expect(
      expectRefused(await resolveInRoot(join(base, 'missing'), 'a.txt', { mustExist: true })),
    ).toContain('root');
    expect(
      expectRefused(await resolveInRoot(join(root, 'a.txt'), 'x.txt', { mustExist: false })),
    ).toContain('root');
  });

  it('refuses an empty or non-string path', async () => {
    for (const bad of ['', 7, null, undefined, ['a.txt']]) {
      expect(expectRefused(await resolveInRoot(root, bad, { mustExist: false }))).toContain(
        'non-empty string',
      );
    }
  });

  it('refuses an absolute path, even one inside the root', async () => {
    const reason = expectRefused(
      await resolveInRoot(root, join(root, 'a.txt'), { mustExist: true }),
    );
    expect(reason).toContain('absolute');
    expect(expectRefused(await resolveInRoot(root, '/etc/passwd', { mustExist: true }))).toContain(
      'absolute',
    );
  });

  it('refuses `..` paths that escape, including ones that go through a folder', async () => {
    expect(
      expectRefused(await resolveInRoot(root, '../outside/secret.txt', { mustExist: true })),
    ).toContain('outside');
    expect(
      expectRefused(await resolveInRoot(root, 'sub/../../outside/secret.txt', { mustExist: true })),
    ).toContain('outside');
    expect(expectRefused(await resolveInRoot(root, '..', { mustExist: true }))).toContain(
      'outside',
    );
    expect(
      expectRefused(await resolveInRoot(root, '../new-file.txt', { mustExist: false })),
    ).toContain('outside');
  });

  it('allows a `..` path that stays inside the root', async () => {
    const found = expectResolved(await resolveInRoot(root, 'sub/../a.txt', { mustExist: true }));
    expect(found.rel).toBe('a.txt');
  });

  it('never echoes the path in a reason', async () => {
    const reason = expectRefused(
      await resolveInRoot(root, 'secret-name-7731/../../x', { mustExist: true }),
    );
    expect(reason).not.toContain('secret-name');
    expect(
      expectRefused(await resolveInRoot(root, 'missing-7731.txt', { mustExist: true })),
    ).not.toContain('missing-7731');
  });
});

describe('resolveInRoot: existing and missing files', () => {
  it('resolves an existing file to its real target and root-relative path', async () => {
    const found = expectResolved(await resolveInRoot(root, 'sub/inner.txt', { mustExist: true }));
    expect(found.rel).toBe('sub/inner.txt');
    expect(found.target.endsWith('inner.txt')).toBe(true);
  });

  it('refuses a missing file when it must exist', async () => {
    expect(expectRefused(await resolveInRoot(root, 'nope.txt', { mustExist: true }))).toContain(
      'does not exist',
    );
  });

  it('allows a file that does not exist yet when its parent exists inside the root', async () => {
    const found = expectResolved(await resolveInRoot(root, 'sub/new.txt', { mustExist: false }));
    expect(found.rel).toBe('sub/new.txt');
    expect(found.target).toBe(join(found.root, 'sub', 'new.txt'));
  });

  it('allows a file whose missing parent folders are plain names inside the root', async () => {
    const found = expectResolved(
      await resolveInRoot(root, 'deep/er/new.txt', { mustExist: false }),
    );
    expect(found.rel).toBe('deep/er/new.txt');
  });

  it('refuses a missing file whose parent is a file, not a folder', async () => {
    expect(
      expectRefused(await resolveInRoot(root, 'a.txt/child.txt', { mustExist: false })),
    ).toContain('not a folder');
  });
});

describe('resolveInRoot: .git refusal', () => {
  it.each([
    '.git',
    '.git/config',
    'sub/.git/config',
    '.GIT/config',
    '.Git',
    'x/.gIt/y',
    '.git./config',
    '.git /config',
    'x\\.git\\config',
  ])('refuses %s', async (path) => {
    expect(expectRefused(await resolveInRoot(root, path, { mustExist: false }))).toContain('.git');
  });

  it('allows names that only contain git', async () => {
    writeFileSync(join(root, 'gitfile.txt'), 'x');
    mkdirSync(join(root, '.github'));
    expectResolved(await resolveInRoot(root, 'gitfile.txt', { mustExist: true }));
    expectResolved(await resolveInRoot(root, '.github', { mustExist: true }));
    expectResolved(await resolveInRoot(root, 'my.git-notes.txt', { mustExist: false }));
  });

  it('refuses a missing .git path too', async () => {
    expect(
      expectRefused(await resolveInRoot(root, '.git/new.txt', { mustExist: false })),
    ).toContain('.git');
  });

  it('hasGitSegment matches segments only', () => {
    expect(hasGitSegment('.git')).toBe(true);
    expect(hasGitSegment('a/.GIT/b')).toBe(true);
    expect(hasGitSegment('a/.gitignore')).toBe(false);
    expect(hasGitSegment('digit.git.txt')).toBe(false);
  });

  it.skipIf(!canDirSymlink)('refuses a symlink whose real target is inside .git', async () => {
    symlinkSync(join(root, '.git'), join(root, 'git-link'), 'junction');
    try {
      expect(
        expectRefused(await resolveInRoot(root, 'git-link/config', { mustExist: true })),
      ).toContain('.git');
    } finally {
      unlinkSync(join(root, 'git-link'));
    }
  });
});

describe('resolveInRoot: symlinks', () => {
  it.skipIf(!canSymlink)('refuses a file symlink that resolves outside the root', async () => {
    symlinkSync(join(outside, 'secret.txt'), join(root, 'file-escape.txt'), 'file');
    try {
      expect(
        expectRefused(await resolveInRoot(root, 'file-escape.txt', { mustExist: true })),
      ).toContain('outside');
    } finally {
      unlinkSync(join(root, 'file-escape.txt'));
    }
  });

  it.skipIf(!canSymlink)('allows a file symlink that resolves inside the root', async () => {
    symlinkSync(join(root, 'a.txt'), join(root, 'inner-link.txt'), 'file');
    try {
      const found = expectResolved(
        await resolveInRoot(root, 'inner-link.txt', { mustExist: true }),
      );
      expect(found.rel).toBe('a.txt');
    } finally {
      unlinkSync(join(root, 'inner-link.txt'));
    }
  });

  it.skipIf(!canDirSymlink)(
    'refuses a folder symlink that leads outside, for a file that does not exist yet',
    async () => {
      symlinkSync(outside, join(root, 'out-dir'), 'junction');
      try {
        expect(
          expectRefused(await resolveInRoot(root, 'out-dir/new.txt', { mustExist: false })),
        ).toContain('outside');
        expect(
          expectRefused(await resolveInRoot(root, 'out-dir/secret.txt', { mustExist: true })),
        ).toContain('outside');
      } finally {
        unlinkSync(join(root, 'out-dir'));
      }
    },
  );

  it.skipIf(!canSymlink)(
    'refuses a dangling file symlink whose target would be outside when it exists',
    async () => {
      // A dangling link is not followed for writes: the rename replaces the link itself, inside the root.
      symlinkSync(join(outside, 'not-yet.txt'), join(root, 'dangling.txt'), 'file');
      try {
        expect(
          expectRefused(await resolveInRoot(root, 'dangling.txt', { mustExist: true })),
        ).toContain('does not exist');
      } finally {
        unlinkSync(join(root, 'dangling.txt'));
      }
    },
  );
});
