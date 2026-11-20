import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { writeFileAtomic } from '../../src/main/tools/atomic-write';
import { editFileInRoot } from '../../src/main/tools/edit-file';
import { writeFileInRoot, WRITE_MAX_BYTES } from '../../src/main/tools/write-file';

/** True when this OS lets the test process create a file symlink (Windows may refuse). */
function probeSymlinks(): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'tool-write-probe-'));
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

/** True when this OS lets the test process create a folder junction. */
function probeDirSymlinks(): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'tool-write-dprobe-'));
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
  console.warn('note: this OS cannot create folder links here; the folder link tests are skipped');
}

let base: string;
let root: string;
let outside: string;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'tool-write-'));
  root = join(base, 'root');
  outside = join(base, 'outside');
  mkdirSync(join(root, 'sub'), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(root, 'existing.txt'), 'old body');
  writeFileSync(join(outside, 'secret.txt'), 'outside');
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

/** Lists the names in `dir` that look like atomic-write temporary files. */
function tempFiles(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.endsWith('.tmp'));
}

function expectFailed(result: { ok: boolean; reason?: string; output?: string }): string {
  expect(result.ok).toBe(false);
  if (result.ok || result.reason === undefined) throw new Error('expected a failure');
  return result.reason;
}

describe('write_file: writes', () => {
  it('creates a new file and reports the path and byte count', async () => {
    expect(await writeFileInRoot(root, { path: 'new.txt', content: 'hello' })).toEqual({
      ok: true,
      output: 'wrote 5 bytes to new.txt',
    });
    expect(readFileSync(join(root, 'new.txt'), 'utf8')).toBe('hello');
  });

  it('creates missing parent folders inside the root', async () => {
    const result = await writeFileInRoot(root, { path: 'a/b/c.txt', content: 'deep' });
    expect(result).toEqual({ ok: true, output: 'wrote 4 bytes to a/b/c.txt' });
    expect(readFileSync(join(root, 'a', 'b', 'c.txt'), 'utf8')).toBe('deep');
  });

  it('overwrites an existing file', async () => {
    const result = await writeFileInRoot(root, { path: 'existing.txt', content: 'new body' });
    expect(result).toEqual({ ok: true, output: 'wrote 8 bytes to existing.txt' });
    expect(readFileSync(join(root, 'existing.txt'), 'utf8')).toBe('new body');
  });

  it('counts bytes, not characters', async () => {
    const result = await writeFileInRoot(root, { path: 'utf.txt', content: 'é' });
    expect(result).toEqual({ ok: true, output: 'wrote 2 bytes to utf.txt' });
  });

  it('leaves no temporary file behind', async () => {
    await writeFileInRoot(root, { path: 'sub/clean.txt', content: 'clean' });
    expect(tempFiles(join(root, 'sub'))).toEqual([]);
  });
});

describe('write_file: refusals', () => {
  it('refuses an existing directory as the target', async () => {
    expect(expectFailed(await writeFileInRoot(root, { path: 'sub', content: 'x' }))).toContain(
      'folder',
    );
    expect(readdirSync(root)).toContain('sub');
  });

  it('refuses content over 1 MiB in bytes, even if it is under the character cap', async () => {
    // 600,000 two-byte characters: 600,000 characters, 1.2 MB in UTF-8.
    const content = 'é'.repeat(600_000);
    const reason = expectFailed(await writeFileInRoot(root, { path: 'big-utf.txt', content }));
    expect(reason).toContain('1 MiB');
    expect(readdirSync(root)).not.toContain('big-utf.txt');
  });

  it('accepts content of exactly 1 MiB', async () => {
    const result = await writeFileInRoot(root, {
      path: 'exact-cap.txt',
      content: 'a'.repeat(WRITE_MAX_BYTES),
    });
    expect(result).toEqual({
      ok: true,
      output: `wrote ${WRITE_MAX_BYTES} bytes to exact-cap.txt`,
    });
  });

  it('refuses paths that fail the AC2 rules, and writes nothing outside the root', async () => {
    const cases = [
      join(outside, 'escape.txt'),
      '../outside/escape.txt',
      'sub/../../outside/escape.txt',
      '.git/config',
      'sub/.GIT/config',
    ];
    for (const path of cases) {
      expectFailed(await writeFileInRoot(root, { path, content: 'x' }));
    }
    expect(readdirSync(outside)).toEqual(['secret.txt']);
  });

  it.skipIf(!canSymlink)(
    'refuses to overwrite a file symlink that points outside the root',
    async () => {
      symlinkSync(join(outside, 'secret.txt'), join(root, 'leak.txt'), 'file');
      try {
        expectFailed(await writeFileInRoot(root, { path: 'leak.txt', content: 'pwned' }));
        expect(readFileSync(join(outside, 'secret.txt'), 'utf8')).toBe('outside');
      } finally {
        unlinkSync(join(root, 'leak.txt'));
      }
    },
  );

  it.skipIf(!canDirSymlink)(
    'refuses a new file under a folder link that leads outside',
    async () => {
      symlinkSync(outside, join(root, 'out-dir'), 'junction');
      try {
        expectFailed(await writeFileInRoot(root, { path: 'out-dir/new.txt', content: 'x' }));
        expect(readdirSync(outside)).not.toContain('new.txt');
      } finally {
        unlinkSync(join(root, 'out-dir'));
      }
    },
  );
});

describe('writeFileAtomic: the temporary file and the rename', () => {
  let folder: string;

  beforeEach(() => {
    folder = join(root, 'atomic');
    mkdirSync(folder, { recursive: true });
  });

  it('retries a failed rename, then succeeds', async () => {
    const target = join(folder, 'retry.txt');
    let calls = 0;
    const result = await writeFileAtomic(target, Buffer.from('ok'), {
      retryMs: 0,
      rename: async (from, to) => {
        calls++;
        if (calls < 3) {
          throw Object.assign(new Error('busy'), { code: 'EPERM' });
        }
        renameSync(from, to);
      },
    });
    expect(result).toEqual({ ok: true });
    expect(calls).toBe(3);
    expect(readFileSync(target, 'utf8')).toBe('ok');
    expect(tempFiles(folder)).toEqual([]);
  });

  it('gives up after the attempts, returns a fixed failure and removes the temporary file', async () => {
    const target = join(folder, 'never.txt');
    let calls = 0;
    const result = await writeFileAtomic(target, Buffer.from('lost'), {
      attempts: 3,
      retryMs: 0,
      rename: async () => {
        calls++;
        throw Object.assign(new Error('locked'), { code: 'EPERM' });
      },
    });
    expect(calls).toBe(3);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a failure');
    expect(result.reason).not.toContain('never');
    expect(tempFiles(folder)).toEqual([]);
    expect(readdirSync(folder)).not.toContain('never.txt');
  });
});

describe('edit_file', () => {
  let dir: string;

  beforeEach(() => {
    dir = join(root, 'edits');
    mkdirSync(dir, { recursive: true });
  });

  function write(name: string, content: string): void {
    writeFileSync(join(dir, name), content);
  }

  function read(name: string): string {
    return readFileSync(join(dir, name), 'utf8');
  }

  it('replaces the one occurrence and reports the count', async () => {
    write('one.txt', 'hello world');
    expect(
      await editFileInRoot(root, {
        path: 'edits/one.txt',
        old_text: 'world',
        new_text: 'there',
      }),
    ).toEqual({ ok: true, output: 'replaced 1 occurrence in edits/one.txt' });
    expect(read('one.txt')).toBe('hello there');
    expect(tempFiles(dir)).toEqual([]);
  });

  it('refuses old_text that is not found, and changes nothing', async () => {
    write('miss.txt', 'hello');
    expectFailed(
      await editFileInRoot(root, { path: 'edits/miss.txt', old_text: 'absent', new_text: 'x' }),
    );
    expect(read('miss.txt')).toBe('hello');
  });

  it('refuses an empty old_text', async () => {
    write('empty.txt', 'hello');
    expect(
      expectFailed(
        await editFileInRoot(root, { path: 'edits/empty.txt', old_text: '', new_text: 'x' }),
      ),
    ).toContain('must not be empty');
    expect(read('empty.txt')).toBe('hello');
  });

  it('refuses old_text that occurs twice without replace_all, and changes nothing', async () => {
    write('twice.txt', 'cat and cat');
    expect(
      expectFailed(
        await editFileInRoot(root, { path: 'edits/twice.txt', old_text: 'cat', new_text: 'dog' }),
      ),
    ).toContain('more than once');
    expect(
      expectFailed(
        await editFileInRoot(root, {
          path: 'edits/twice.txt',
          old_text: 'cat',
          new_text: 'dog',
          replace_all: false,
        }),
      ),
    ).toContain('more than once');
    expect(read('twice.txt')).toBe('cat and cat');
  });

  it('replaces every occurrence with replace_all and reports the count', async () => {
    write('all.txt', 'cat and cat and cat');
    expect(
      await editFileInRoot(root, {
        path: 'edits/all.txt',
        old_text: 'cat',
        new_text: 'dog',
        replace_all: true,
      }),
    ).toEqual({ ok: true, output: 'replaced 3 occurrences in edits/all.txt' });
    expect(read('all.txt')).toBe('dog and dog and dog');
  });

  it('keeps $ patterns in new_text literal', async () => {
    write('dollar.txt', 'price: X');
    await editFileInRoot(root, { path: 'edits/dollar.txt', old_text: 'X', new_text: '$& $1 $$' });
    expect(read('dollar.txt')).toBe('price: $& $1 $$');
    write('dollar-all.txt', 'X X');
    await editFileInRoot(root, {
      path: 'edits/dollar-all.txt',
      old_text: 'X',
      new_text: '$&',
      replace_all: true,
    });
    expect(read('dollar-all.txt')).toBe('$& $&');
  });

  it('refuses a directory, and a missing file', async () => {
    expect(
      expectFailed(await editFileInRoot(root, { path: 'edits', old_text: 'a', new_text: 'b' })),
    ).toContain('not a regular file');
    expect(
      expectFailed(
        await editFileInRoot(root, { path: 'edits/none.txt', old_text: 'a', new_text: 'b' }),
      ),
    ).toContain('does not exist');
  });

  it('refuses an edit that would take the file over 1 MiB, and changes nothing', async () => {
    write('grow.txt', `a${'x'.repeat(WRITE_MAX_BYTES - 2)}`);
    const before = read('grow.txt');
    expect(
      expectFailed(
        await editFileInRoot(root, { path: 'edits/grow.txt', old_text: 'a', new_text: 'bbb' }),
      ),
    ).toContain('1 MiB');
    expect(read('grow.txt')).toBe(before);
  });

  it('refuses paths that fail the AC2 rules, and changes nothing', async () => {
    write('guard.txt', 'guarded');
    expectFailed(
      await editFileInRoot(root, { path: '../existing.txt', old_text: 'o', new_text: 'x' }),
    );
    expectFailed(
      await editFileInRoot(root, { path: join(dir, 'guard.txt'), old_text: 'g', new_text: 'x' }),
    );
    expectFailed(await editFileInRoot(root, { path: '.git/config', old_text: 'a', new_text: 'b' }));
    expect(read('guard.txt')).toBe('guarded');
  });
});
