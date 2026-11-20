import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_TOOL_OUTPUT_LENGTH } from '../../src/shared/agent-protocol';
import { listFilesInRoot, LIST_MAX_ENTRIES } from '../../src/main/tools/list-files';
import { hasNodeModulesSegment, NODE_MODULES_REASON } from '../../src/main/tools/paths';
import { readFileInRoot } from '../../src/main/tools/read-file';
import { globToRegExp } from '../../src/main/tools/walk';
import {
  SEARCH_MAX_FILE_BYTES,
  SEARCH_MAX_MATCHES,
  searchTextInRoot,
} from '../../src/main/tools/search-text';

/** True when this OS lets the test process create a file symlink (Windows may refuse). */
function probeSymlinks(): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'tool-files-probe-'));
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

/** True when this OS lets the test process create a folder junction (no Developer Mode needed). */
function probeDirSymlinks(): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'tool-files-dprobe-'));
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

/** Writes a file under `dir`, creating its folders. */
function put(dir: string, rel: string, content: string | Buffer): void {
  const target = join(dir, rel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'tool-files-'));
  root = join(base, 'root');
  outside = join(base, 'outside');
  mkdirSync(root, { recursive: true });
  mkdirSync(outside, { recursive: true });
  put(root, 'a.txt', 'one\nneedle here\nthree');
  put(root, 'a1.txt', 'a1');
  put(root, 'ab.txt', 'ab');
  put(root, 'b.log', 'log needle');
  put(root, 'sub/c.txt', 'needle in sub');
  put(root, 'sub/deep/d.txt', 'deep');
  put(root, '.github/ci.yml', 'ci');
  put(root, '.git/config', 'needle in git');
  put(root, 'node_modules/pkg/index.js', 'needle in modules');
  put(root, 'sub/node_modules/x.txt', 'needle in nested modules');
  put(outside, 'secret.txt', 'needle outside');
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

function lines(output: string): string[] {
  return output.split('\n');
}

async function list(args: Parameters<typeof listFilesInRoot>[1]): Promise<string> {
  const result = await listFilesInRoot(root, args);
  if (!result.ok) throw new Error(`expected output, got: ${result.reason}`);
  return result.output;
}

describe('globToRegExp', () => {
  const matches = (glob: string, rel: string): boolean => globToRegExp(glob).test(rel);

  it('* stays inside one segment', () => {
    expect(matches('*.txt', 'a.txt')).toBe(true);
    expect(matches('*.txt', 'sub/a.txt')).toBe(false);
  });

  it('** crosses segments and ** / matches zero folders too', () => {
    expect(matches('**/*.txt', 'a.txt')).toBe(true);
    expect(matches('**/*.txt', 'x/y/z.txt')).toBe(true);
    expect(matches('sub/**', 'sub/x/y.md')).toBe(true);
    expect(matches('sub/**/d.txt', 'sub/d.txt')).toBe(true);
  });

  it('? matches one character inside a segment', () => {
    expect(matches('a?.txt', 'a1.txt')).toBe(true);
    expect(matches('a?.txt', 'a.txt')).toBe(false);
    expect(matches('a?.txt', 'a12.txt')).toBe(false);
    expect(matches('a?.txt', 'a/.txt')).toBe(false);
  });

  it('treats every other character literally', () => {
    expect(matches('a.txt', 'abtxt')).toBe(false);
    expect(matches('(x)+[y]', '(x)+[y]')).toBe(true);
    expect(matches('a+b', 'aab')).toBe(false);
  });

  it('is anchored: a partial match is not a match', () => {
    expect(matches('txt', 'a.txt')).toBe(false);
  });
});

describe('list_files: glob forms', () => {
  it('the default lists every regular file except skipped folders', async () => {
    const out = lines(await list({}));
    expect(out).toContain('a.txt');
    expect(out).toContain('sub/deep/d.txt');
    expect(out).toContain('.github/ci.yml');
    expect(out).not.toContain('.git/config');
    expect(out).not.toContain('node_modules/pkg/index.js');
    expect(out).not.toContain('sub/node_modules/x.txt');
  });

  it('uses / separators and sorts the paths', async () => {
    const out = lines(await list({}));
    expect(out.some((line) => line.includes('\\'))).toBe(false);
    expect(out).toEqual([...out].sort());
  });

  it('* matches only at the root level', async () => {
    expect(lines(await list({ pattern: '*.txt' }))).toEqual(['a.txt', 'a1.txt', 'ab.txt']);
  });

  it('? matches exactly one character', async () => {
    expect(lines(await list({ pattern: 'a?.txt' }))).toEqual(['a1.txt', 'ab.txt']);
    expect(lines(await list({ pattern: 'a??.txt' }))).toEqual(['no files matched']);
  });

  it('** crosses folders', async () => {
    expect(lines(await list({ pattern: '**/*.txt' }))).toEqual([
      'a.txt',
      'a1.txt',
      'ab.txt',
      'sub/c.txt',
      'sub/deep/d.txt',
    ]);
  });

  it('a folder prefix with ** lists everything under it', async () => {
    expect(lines(await list({ pattern: 'sub/**' }))).toEqual(['sub/c.txt', 'sub/deep/d.txt']);
  });

  it('a pattern with a middle wildcard matches one level', async () => {
    expect(lines(await list({ pattern: 'sub/*/d.txt' }))).toEqual(['sub/deep/d.txt']);
  });

  it('matches the root-relative path, not the bare name', async () => {
    expect(lines(await list({ pattern: 'c.txt' }))).toEqual(['no files matched']);
  });

  it('says that no files matched when nothing matches', async () => {
    expect(await list({ pattern: '*.nothing' })).toBe('no files matched');
  });

  it('lists under a path, with root-relative results', async () => {
    expect(lines(await list({ path: 'sub' }))).toEqual(['sub/c.txt', 'sub/deep/d.txt']);
    expect(lines(await list({ path: 'sub', pattern: '**/*.txt' }))).toEqual([
      'sub/c.txt',
      'sub/deep/d.txt',
    ]);
  });

  it('refuses an empty pattern, a missing path, a file path and a path outside the root', async () => {
    expect((await listFilesInRoot(root, { pattern: '' })).ok).toBe(false);
    expect((await listFilesInRoot(root, { path: '' })).ok).toBe(false);
    expect((await listFilesInRoot(root, { path: 'missing' })).ok).toBe(false);
    const file = await listFilesInRoot(root, { path: 'a.txt' });
    expect(file.ok).toBe(false);
    const escape = await listFilesInRoot(root, { path: '..' });
    expect(escape.ok).toBe(false);
  });

  it('refuses a .git path', async () => {
    const result = await listFilesInRoot(root, { path: '.git' });
    expect(result.ok).toBe(false);
  });
});

describe('list_files and search_text: node_modules paths (AC10)', () => {
  let nmBase: string;
  let nmRoot: string;

  beforeAll(() => {
    nmBase = mkdtempSync(join(tmpdir(), 'tool-files-nm-'));
    nmRoot = join(nmBase, 'root');
    mkdirSync(nmRoot, { recursive: true });
    put(nmRoot, 'node_modules/pkg/index.js', 'needle in modules');
    put(nmRoot, 'a/node_modules/b/x.js', 'needle nested');
    put(nmRoot, 'src/app.js', 'needle in source');
  });

  afterAll(() => {
    rmSync(nmBase, { recursive: true, force: true });
  });

  it.each(['node_modules', 'NODE_MODULES/x', 'a/node_modules/b', 'a\\node_modules'])(
    'list_files refuses the path %j with the fixed reason',
    async (path) => {
      expect(await listFilesInRoot(nmRoot, { path })).toEqual({
        ok: false,
        reason: NODE_MODULES_REASON,
      });
    },
  );

  it.each(['node_modules', 'NODE_MODULES/x', 'a/node_modules/b', 'a\\node_modules'])(
    'search_text refuses the path %j with the fixed reason',
    async (path) => {
      expect(await searchTextInRoot(nmRoot, { pattern: 'needle', path })).toEqual({
        ok: false,
        reason: NODE_MODULES_REASON,
      });
    },
  );

  it('keeps node_modules out of the default listing and the default search', async () => {
    expect(await listFilesInRoot(nmRoot, {})).toEqual({ ok: true, output: 'src/app.js' });
    expect(await searchTextInRoot(nmRoot, { pattern: 'needle' })).toEqual({
      ok: true,
      output: 'src/app.js:1: needle in source',
    });
  });

  it('still reads a file under node_modules with read_file', async () => {
    expect(await readFileInRoot(nmRoot, 'node_modules/pkg/index.js')).toEqual({
      ok: true,
      output: 'needle in modules',
    });
  });

  it('recognises node_modules segments with any case, trailing dots and spaces, and either separator', () => {
    expect(hasNodeModulesSegment('node_modules')).toBe(true);
    expect(hasNodeModulesSegment('Node_Modules.')).toBe(true);
    expect(hasNodeModulesSegment('a/node_modules /b')).toBe(true);
    expect(hasNodeModulesSegment('a\\node_modules\\b')).toBe(true);
    expect(hasNodeModulesSegment('node_modules_x')).toBe(false);
    expect(hasNodeModulesSegment('nodemodules')).toBe(false);
    expect(hasNodeModulesSegment('src/app.js')).toBe(false);
  });
});

describe('list_files: skipped folders and symlinks', () => {
  it.skipIf(!canDirSymlink)('does not descend into a folder link to outside the root', async () => {
    symlinkSync(outside, join(root, 'out-link'), 'junction');
    try {
      const out = lines(await list({}));
      expect(out.some((line) => line.startsWith('out-link'))).toBe(false);
      expect(out).not.toContain('out-link/secret.txt');
    } finally {
      unlinkSync(join(root, 'out-link'));
    }
  });

  it.skipIf(!canSymlink)('does not list a file link', async () => {
    symlinkSync(join(outside, 'secret.txt'), join(root, 'file-link.txt'), 'file');
    try {
      expect(lines(await list({ pattern: 'file-link.txt' }))).toEqual(['no files matched']);
    } finally {
      unlinkSync(join(root, 'file-link.txt'));
    }
  });
});

describe('list_files: caps', () => {
  it('cuts the list at 1,000 entries and says so', async () => {
    const many = join(root, 'many');
    for (let i = 0; i < LIST_MAX_ENTRIES + 1; i++) {
      put(many, `f${String(i).padStart(4, '0')}.txt`, 'x');
    }
    try {
      const out = lines(await list({ path: 'many' }));
      expect(out.length).toBe(LIST_MAX_ENTRIES + 1);
      expect(out[LIST_MAX_ENTRIES - 1]).toBe('many/f0999.txt');
      expect(out[LIST_MAX_ENTRIES]).toContain('list cut at 1,000 entries');
    } finally {
      rmSync(many, { recursive: true, force: true });
    }
  });

  it('does not add a cut note at exactly 1,000 entries', async () => {
    const exact = join(root, 'exact');
    for (let i = 0; i < LIST_MAX_ENTRIES; i++) {
      put(exact, `f${String(i).padStart(4, '0')}.txt`, 'x');
    }
    try {
      const out = lines(await list({ path: 'exact' }));
      expect(out.length).toBe(LIST_MAX_ENTRIES);
      expect(out.join('\n')).not.toContain('cut');
    } finally {
      rmSync(exact, { recursive: true, force: true });
    }
  });

  it('keeps the output within the 64 KiB limit and says so when long names fill it', async () => {
    const wide = join(root, 'wide');
    const name = `${'x'.repeat(115)}`;
    for (let i = 0; i < 600; i++) {
      put(wide, `${name}-${String(i).padStart(3, '0')}.txt`, 'x');
    }
    try {
      const output = await list({ path: 'wide' });
      expect(output.length).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_LENGTH);
      const out = lines(output);
      expect(out[out.length - 1]).toContain('64 KiB');
      expect(out.length).toBeLessThan(LIST_MAX_ENTRIES);
    } finally {
      rmSync(wide, { recursive: true, force: true });
    }
  });
});

describe('search_text', () => {
  it('returns path:line: text for each match, in file order', async () => {
    const result = await searchTextInRoot(root, { pattern: 'needle' });
    expect(result).toEqual({
      ok: true,
      output: ['a.txt:2: needle here', 'b.log:1: log needle', 'sub/c.txt:1: needle in sub'].join(
        '\n',
      ),
    });
  });

  it('does not search skipped folders', async () => {
    const out = await searchTextInRoot(root, { pattern: 'needle' });
    if (!out.ok) throw new Error('expected output');
    expect(out.output).not.toContain('.git');
    expect(out.output).not.toContain('node_modules');
  });

  it('limits the search with glob and path, using the same file set as list_files', async () => {
    const byGlob = await searchTextInRoot(root, { pattern: 'needle', glob: '**/*.txt' });
    expect(byGlob).toEqual({
      ok: true,
      output: 'a.txt:2: needle here\nsub/c.txt:1: needle in sub',
    });
    const byPath = await searchTextInRoot(root, { pattern: 'needle', path: 'sub' });
    expect(byPath).toEqual({ ok: true, output: 'sub/c.txt:1: needle in sub' });
  });

  it('says no matches when nothing matches', async () => {
    expect(await searchTextInRoot(root, { pattern: 'absent-phrase-42' })).toEqual({
      ok: true,
      output: 'no matches',
    });
  });

  it('refuses a pattern that does not compile, without echoing it', async () => {
    const result = await searchTextInRoot(root, { pattern: 'secret-(' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a failure');
    expect(result.reason).toContain('regular expression');
    expect(result.reason).not.toContain('secret');
  });

  it('removes a trailing carriage return from each line', async () => {
    put(root, 'crlf.txt', 'x\r\nneedle\r\n');
    try {
      const result = await searchTextInRoot(root, { pattern: 'needle', glob: 'crlf.txt' });
      expect(result).toEqual({ ok: true, output: 'crlf.txt:2: needle' });
    } finally {
      unlinkSync(join(root, 'crlf.txt'));
    }
  });

  it('cuts each match text to 500 characters', async () => {
    put(root, 'long.txt', `needle${'z'.repeat(800)}`);
    try {
      const result = await searchTextInRoot(root, { pattern: 'needle', glob: 'long.txt' });
      if (!result.ok) throw new Error('expected output');
      expect(result.output).toBe(`long.txt:1: needle${'z'.repeat(500 - 6)}`);
    } finally {
      unlinkSync(join(root, 'long.txt'));
    }
  });

  it('skips a binary file (a NUL in its first 8 KiB) but not a NUL after that', async () => {
    put(root, 'bin.dat', Buffer.from([0x6e, 0x65, 0x65, 0x00, 0x64, 0x6c, 0x65]));
    put(root, 'late-nul.txt', `needle\n${'a'.repeat(9000)}\u0000`);
    try {
      const binary = await searchTextInRoot(root, { pattern: 'nee', glob: 'bin.dat' });
      expect(binary).toEqual({ ok: true, output: 'no matches' });
      const late = await searchTextInRoot(root, { pattern: 'needle', glob: 'late-nul.txt' });
      expect(late).toEqual({ ok: true, output: 'late-nul.txt:1: needle' });
    } finally {
      unlinkSync(join(root, 'bin.dat'));
      unlinkSync(join(root, 'late-nul.txt'));
    }
  });

  it('skips a file over 1 MiB and keeps a file of exactly 1 MiB', async () => {
    const exactLine = `needle${'a'.repeat(SEARCH_MAX_FILE_BYTES - 6)}`;
    put(root, 'over.txt', `needle\n${'a'.repeat(SEARCH_MAX_FILE_BYTES)}`);
    put(root, 'exact.txt', exactLine);
    try {
      const over = await searchTextInRoot(root, { pattern: 'needle', glob: 'over.txt' });
      expect(over).toEqual({ ok: true, output: 'no matches' });
      const exact = await searchTextInRoot(root, { pattern: 'needle', glob: 'exact.txt' });
      expect(exact).toEqual({ ok: true, output: `exact.txt:1: ${exactLine.slice(0, 500)}` });
    } finally {
      unlinkSync(join(root, 'over.txt'));
      unlinkSync(join(root, 'exact.txt'));
    }
  });

  it('stops at 200 matches and says so', async () => {
    const body = Array.from({ length: SEARCH_MAX_MATCHES + 50 }, () => 'needle n').join('\n');
    put(root, 'many-matches.txt', body);
    try {
      const result = await searchTextInRoot(root, { pattern: 'needle', glob: 'many-matches.txt' });
      if (!result.ok) throw new Error('expected output');
      const out = lines(result.output);
      expect(out.length).toBe(SEARCH_MAX_MATCHES + 1);
      expect(out[SEARCH_MAX_MATCHES - 1]).toBe(`many-matches.txt:${SEARCH_MAX_MATCHES}: needle n`);
      expect(out[SEARCH_MAX_MATCHES]).toContain('stopped at 200 matches');
    } finally {
      unlinkSync(join(root, 'many-matches.txt'));
    }
  });

  it('stops at the 64 KiB output cap, keeps it within the limit and says so', async () => {
    const body = Array.from({ length: 300 }, () => `needle ${'x'.repeat(490)}`).join('\n');
    put(root, 'wide-matches.txt', body);
    try {
      const result = await searchTextInRoot(root, { pattern: 'needle', glob: 'wide-matches.txt' });
      if (!result.ok) throw new Error('expected output');
      expect(result.output.length).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_LENGTH);
      const out = lines(result.output);
      expect(out[out.length - 1]).toContain('output cut at 64 KiB');
      expect(out.length - 1).toBeLessThan(SEARCH_MAX_MATCHES);
    } finally {
      unlinkSync(join(root, 'wide-matches.txt'));
    }
  });

  it.skipIf(!canSymlink)('does not follow a file link to outside the root', async () => {
    symlinkSync(join(outside, 'secret.txt'), join(root, 'leak.txt'), 'file');
    try {
      const result = await searchTextInRoot(root, { pattern: 'outside' });
      expect(result).toEqual({ ok: true, output: 'no matches' });
    } finally {
      unlinkSync(join(root, 'leak.txt'));
    }
  });

  it.skipIf(!canDirSymlink)('does not descend into a folder link to outside the root', async () => {
    symlinkSync(outside, join(root, 'out-dir'), 'junction');
    try {
      const result = await searchTextInRoot(root, { pattern: 'outside' });
      expect(result).toEqual({ ok: true, output: 'no matches' });
    } finally {
      unlinkSync(join(root, 'out-dir'));
    }
  });
});
