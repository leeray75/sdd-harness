import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  areaOf,
  gitIgnoredEntries,
  isIgnored,
  lockSpecFolder,
  PROTECT_CAP_BYTES,
  restoreAfterRun,
  scopesFor,
  snapshotForRun,
  TOO_LARGE_REASON,
  type RevertRecord,
  type Snapshot,
} from '../../src/main/commands/protect';
import { localEnvironment, toolEnvironment } from '../../src/main/env';

const HAS_GIT = spawnSync('git', ['--version']).status === 0;
const HAS_SYMLINK = (() => {
  const probe = mkdtempSync(join(tmpdir(), 'protect-probe-'));
  try {
    symlinkSync(probe, join(probe, 'link'));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
})();

let base: string;
let counter = 0;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'command-protect-'));
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

/** A fresh root under the test base. */
function freshRoot(): string {
  counter += 1;
  const root = join(base, `root-${counter}`);
  mkdirSync(root);
  return root;
}

function write(root: string, rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

/**
 * The fixture project: a spec folder, a source file, a .gitignore, and key files in .git.
 * `plain` has no .git at all. `git` runs git init and then adds the fixture files. `manual`
 * writes a .git folder by hand, for the writer, which never asks git.
 */
function build(root: string, kind: 'plain' | 'git' | 'manual'): void {
  write(root, 'docs/specs/feature/SPECS.md', 'spec v1');
  write(root, 'docs/specs/feature/tasks.md', 'tasks v1');
  write(root, 'src/app.ts', 'export const a = 1;');
  write(root, 'src/gone.ts', 'to be deleted');
  write(root, '.gitignore', 'out.log\nbuild/\n');
  if (kind === 'git') {
    // git init writes a real HEAD, config and index; only the key files the tests change are added.
    execFileSync('git', ['init', '-q'], { cwd: root });
  }
  if (kind !== 'plain') {
    if (kind === 'manual') {
      write(root, '.git/HEAD', 'ref: refs/heads/main\n');
      write(root, '.git/config', '[core]\n');
      write(root, '.git/index', 'index v1');
    }
    write(root, '.git/hooks/pre-commit', 'hook v1');
    write(root, '.git/refs/heads/main', 'sha1-v1');
  }
}

function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

/** What a command's stub does first: clears the read-only state so it can edit. */
function unlockTree(dir: string): void {
  chmodSync(dir, 0o777);
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      unlockTree(path);
    } else {
      chmodSync(path, 0o666);
    }
  }
}

function recordsOf(records: RevertRecord[]): string[] {
  return records.map((record) => `${record.path}=${record.action}`).sort();
}

function mustSnapshot(result: Awaited<ReturnType<typeof snapshotForRun>>): Snapshot {
  if (!result.ok) throw new Error(`expected a snapshot, got: ${result.reason}`);
  return result.snapshot;
}

describe('scopesFor and areaOf', () => {
  it('protects docs/specs and the .git key files for both jobs, and the root only for the reviewer', () => {
    for (const job of ['writer', 'reviewer'] as const) {
      const rels = scopesFor(job).map((scope) => scope.rel);
      expect(rels).toEqual(
        expect.arrayContaining([
          'docs/specs',
          '.git/HEAD',
          '.git/config',
          '.git/packed-refs',
          '.git/hooks',
          '.git/refs',
        ]),
      );
      expect(rels.includes('') === (job === 'reviewer')).toBe(true);
    }
  });

  it('reports the area of a path', () => {
    expect(areaOf('docs/specs/a/SPECS.md')).toBe('docs/specs');
    expect(areaOf('.git/HEAD')).toBe('.git');
    expect(areaOf('src/app.ts')).toBe('project files');
    expect(areaOf('docs/other.md')).toBe('project files');
  });
});

describe('isIgnored', () => {
  it('matches a file, a folder listed with a slash, and anything below it', () => {
    const ignored = new Set(['out.log', 'build/', 'dist/cache/']);
    expect(isIgnored('out.log', false, ignored)).toBe(true);
    expect(isIgnored('src/out.log', false, ignored)).toBe(false);
    expect(isIgnored('build', true, ignored)).toBe(true);
    expect(isIgnored('build/app.js', false, ignored)).toBe(true);
    expect(isIgnored('dist/cache/x.bin', false, ignored)).toBe(true);
    expect(isIgnored('dist/other.js', false, ignored)).toBe(false);
    expect(isIgnored('src/app.ts', false, ignored)).toBe(false);
  });

  it('ignores nothing for an empty set', () => {
    expect(isIgnored('anything', false, new Set())).toBe(false);
  });
});

describe('snapshotForRun: the writer set', () => {
  it('holds docs/specs and the .git key files, and not the project files or .git/index', async () => {
    const root = freshRoot();
    build(root, 'manual');
    const snapshot = mustSnapshot(
      await snapshotForRun(toolEnvironment(localEnvironment()), {
        root,
        job: 'writer',
        env: process.env,
      }),
    );
    const keys = [...snapshot.saved.keys()];
    expect(keys).toEqual(
      expect.arrayContaining([
        'docs/specs/feature/SPECS.md',
        'docs/specs/feature/tasks.md',
        '.git/HEAD',
        '.git/config',
        '.git/hooks/pre-commit',
        '.git/refs/heads/main',
      ]),
    );
    expect(keys).not.toContain('src/app.ts');
    expect(keys).not.toContain('.git/index');
  });
});

describe.skipIf(!HAS_GIT)('snapshotForRun: the reviewer set with git', () => {
  it('holds every non-ignored project file, and not the ignored or node_modules files', async () => {
    const root = freshRoot();
    build(root, 'git');
    write(root, 'out.log', 'ignored log');
    write(root, 'build/app.js', 'ignored build');
    write(root, 'node_modules/pkg/index.js', 'module');
    const snapshot = mustSnapshot(
      await snapshotForRun(toolEnvironment(localEnvironment()), {
        root,
        job: 'reviewer',
        env: process.env,
      }),
    );
    const keys = [...snapshot.saved.keys()];
    expect(keys).toEqual(expect.arrayContaining(['src/app.ts', 'src/gone.ts', '.gitignore']));
    expect(keys).not.toContain('out.log');
    expect(keys.some((key) => key.startsWith('build/'))).toBe(false);
    expect(keys.some((key) => key.startsWith('node_modules/'))).toBe(false);
    expect(keys).not.toContain('.git/index');
  });

  it('reads the ignored entries through git ls-files, as a read-only query', async () => {
    const root = freshRoot();
    build(root, 'git');
    write(root, 'out.log', 'x');
    write(root, 'build/app.js', 'ignored build');
    const ignored = await gitIgnoredEntries(toolEnvironment(localEnvironment()), root, process.env);
    expect(ignored).not.toBeNull();
    expect(ignored?.has('out.log')).toBe(true);
    expect(ignored?.has('build/')).toBe(true);
  });
});

describe('snapshotForRun: the reviewer set without git', () => {
  it('skips only node_modules and .git when the root is not a repository', async () => {
    const root = freshRoot();
    build(root, 'plain');
    write(root, 'out.log', 'not ignored without git');
    write(root, 'node_modules/pkg/index.js', 'module');
    expect(
      await gitIgnoredEntries(toolEnvironment(localEnvironment()), root, process.env),
    ).toBeNull();
    const snapshot = mustSnapshot(
      await snapshotForRun(toolEnvironment(localEnvironment()), {
        root,
        job: 'reviewer',
        env: process.env,
      }),
    );
    const keys = [...snapshot.saved.keys()];
    expect(keys).toEqual(expect.arrayContaining(['src/app.ts', 'out.log', '.gitignore']));
    expect(keys.some((key) => key.startsWith('node_modules/'))).toBe(false);
  });
});

describe('snapshotForRun: the cap', () => {
  it('refuses a snapshot over the cap, for either job, with the fixed reason', async () => {
    const root = freshRoot();
    build(root, 'manual');
    for (const job of ['writer', 'reviewer'] as const) {
      const result = await snapshotForRun(toolEnvironment(localEnvironment()), {
        root,
        job,
        env: process.env,
        maxBytes: 10,
      });
      expect(result).toEqual({ ok: false, reason: TOO_LARGE_REASON });
    }
  });

  it('accepts a snapshot exactly at the cap and refuses one byte less, and the default cap is 256 MiB', async () => {
    const root = freshRoot();
    build(root, 'manual');
    const whole = mustSnapshot(
      await snapshotForRun(toolEnvironment(localEnvironment()), {
        root,
        job: 'writer',
        env: process.env,
      }),
    );
    let total = 0;
    for (const saved of whole.saved.values()) {
      if (saved.kind === 'file') total += saved.bytes.length;
    }
    expect(total).toBeGreaterThan(0);
    const atCap = await snapshotForRun(toolEnvironment(localEnvironment()), {
      root,
      job: 'writer',
      env: process.env,
      maxBytes: total,
    });
    expect(atCap.ok).toBe(true);
    const underCap = await snapshotForRun(toolEnvironment(localEnvironment()), {
      root,
      job: 'writer',
      env: process.env,
      maxBytes: total - 1,
    });
    expect(underCap).toEqual({ ok: false, reason: TOO_LARGE_REASON });
    expect(PROTECT_CAP_BYTES).toBe(256 * 1024 * 1024);
  });
});

describe('lockSpecFolder', () => {
  it('makes every docs/specs file read-only, and leaves the .git files alone', async () => {
    const root = freshRoot();
    build(root, 'manual');
    const snapshot = mustSnapshot(
      await snapshotForRun(toolEnvironment(localEnvironment()), {
        root,
        job: 'writer',
        env: process.env,
      }),
    );
    await lockSpecFolder(toolEnvironment(localEnvironment()), snapshot);
    expect(modeOf(join(root, 'docs/specs/feature/SPECS.md')) & 0o200).toBe(0);
    expect(modeOf(join(root, 'docs/specs/feature/tasks.md')) & 0o200).toBe(0);
    expect(modeOf(join(root, '.git/HEAD')) & 0o200).not.toBe(0);
    expect(() => writeFileSync(join(root, 'docs/specs/feature/SPECS.md'), 'tampered')).toThrow();
    await restoreAfterRun(toolEnvironment(localEnvironment()), snapshot);
  });
});

describe('restoreAfterRun: the writer', () => {
  it('reverts docs/specs and the .git key files, keeps everything else, and reports each path once', async () => {
    const root = freshRoot();
    build(root, 'manual');
    const specsMode = modeOf(join(root, 'docs/specs/feature/SPECS.md'));
    const snapshot = mustSnapshot(
      await snapshotForRun(toolEnvironment(localEnvironment()), {
        root,
        job: 'writer',
        env: process.env,
      }),
    );
    await lockSpecFolder(toolEnvironment(localEnvironment()), snapshot);

    // The command clears the read-only state first, then edits, creates and deletes.
    unlockTree(join(root, 'docs/specs'));
    writeFileSync(join(root, 'docs/specs/feature/SPECS.md'), 'spec TAMPERED');
    writeFileSync(join(root, 'docs/specs/feature/new.md'), 'created');
    unlinkSync(join(root, 'docs/specs/feature/tasks.md'));
    mkdirSync(join(root, 'docs/specs/newdir'));
    writeFileSync(join(root, 'docs/specs/newdir/x.md'), 'in a new folder');
    chmodSync(join(root, '.git'), 0o777);
    writeFileSync(join(root, '.git/HEAD'), 'ref: refs/heads/evil');
    writeFileSync(join(root, '.git/refs/heads/feature'), 'created ref');
    writeFileSync(join(root, '.git/hooks/post-commit'), 'evil hook');
    writeFileSync(join(root, '.git/hooks/pre-commit'), 'hook tampered');
    writeFileSync(join(root, '.git/index'), 'index changed');
    writeFileSync(join(root, 'src/app.ts'), 'writer edit kept');

    const result = await restoreAfterRun(toolEnvironment(localEnvironment()), snapshot);
    expect(result.incomplete).toBe(false);
    expect(readFileSync(join(root, 'docs/specs/feature/SPECS.md'), 'utf8')).toBe('spec v1');
    expect(readFileSync(join(root, 'docs/specs/feature/tasks.md'), 'utf8')).toBe('tasks v1');
    expect(existsSync(join(root, 'docs/specs/feature/new.md'))).toBe(false);
    expect(existsSync(join(root, 'docs/specs/newdir'))).toBe(false);
    expect(readFileSync(join(root, '.git/HEAD'), 'utf8')).toBe('ref: refs/heads/main\n');
    expect(existsSync(join(root, '.git/refs/heads/feature'))).toBe(false);
    expect(existsSync(join(root, '.git/hooks/post-commit'))).toBe(false);
    expect(readFileSync(join(root, '.git/hooks/pre-commit'), 'utf8')).toBe('hook v1');
    expect(modeOf(join(root, 'docs/specs/feature/SPECS.md'))).toBe(specsMode);
    expect(readFileSync(join(root, '.git/index'), 'utf8')).toBe('index changed');
    expect(readFileSync(join(root, 'src/app.ts'), 'utf8')).toBe('writer edit kept');

    expect(recordsOf(result.records)).toEqual([
      '.git/HEAD=restored',
      '.git/hooks/post-commit=deleted',
      '.git/hooks/pre-commit=restored',
      '.git/refs/heads/feature=deleted',
      'docs/specs/feature/SPECS.md=restored',
      'docs/specs/feature/new.md=deleted',
      'docs/specs/feature/tasks.md=re-created',
      'docs/specs/newdir/x.md=deleted',
      'docs/specs/newdir=deleted',
    ]);
    const areas = new Set(result.records.map((record) => record.area));
    expect([...areas].sort()).toEqual(['.git', 'docs/specs']);
  });

  it('puts the modes of the locked tree back even when the command changed nothing', async () => {
    const root = freshRoot();
    build(root, 'manual');
    const fileBefore = modeOf(join(root, 'docs/specs/feature/SPECS.md'));
    const folderBefore = modeOf(join(root, 'docs/specs/feature'));
    const snapshot = mustSnapshot(
      await snapshotForRun(toolEnvironment(localEnvironment()), {
        root,
        job: 'writer',
        env: process.env,
      }),
    );
    await lockSpecFolder(toolEnvironment(localEnvironment()), snapshot);
    const result = await restoreAfterRun(toolEnvironment(localEnvironment()), snapshot);
    expect(result.records).toEqual([]);
    expect(modeOf(join(root, 'docs/specs/feature/SPECS.md'))).toBe(fileBefore);
    expect(modeOf(join(root, 'docs/specs/feature'))).toBe(folderBefore);
  });

  it.skipIf(!HAS_SYMLINK)('deletes a symlink the command created in docs/specs', async () => {
    const root = freshRoot();
    build(root, 'manual');
    const snapshot = mustSnapshot(
      await snapshotForRun(toolEnvironment(localEnvironment()), {
        root,
        job: 'writer',
        env: process.env,
      }),
    );
    await lockSpecFolder(toolEnvironment(localEnvironment()), snapshot);
    unlockTree(join(root, 'docs/specs'));
    symlinkSync(join(root, 'src/app.ts'), join(root, 'docs/specs/link.ts'));
    const result = await restoreAfterRun(toolEnvironment(localEnvironment()), snapshot);
    expect(existsSync(join(root, 'docs/specs/link.ts'))).toBe(false);
    expect(recordsOf(result.records)).toEqual(['docs/specs/link.ts=deleted']);
  });
});

describe.skipIf(!HAS_GIT)('restoreAfterRun: the reviewer with git', () => {
  it('reverts tracked and new non-ignored files, and keeps ignored, node_modules and .git/index changes', async () => {
    const root = freshRoot();
    build(root, 'git');
    write(root, 'node_modules/pkg/index.js', 'module');
    const snapshot = mustSnapshot(
      await snapshotForRun(toolEnvironment(localEnvironment()), {
        root,
        job: 'reviewer',
        env: process.env,
      }),
    );
    await lockSpecFolder(toolEnvironment(localEnvironment()), snapshot);

    writeFileSync(join(root, 'src/app.ts'), 'edited by reviewer');
    writeFileSync(join(root, 'src/new.ts'), 'new file');
    unlinkSync(join(root, 'src/gone.ts'));
    writeFileSync(join(root, 'out.log'), 'an ignored log');
    mkdirSync(join(root, 'build'), { recursive: true });
    writeFileSync(join(root, 'build/app.js'), 'ignored build output');
    writeFileSync(join(root, 'node_modules/pkg/index.js'), 'changed module');

    const result = await restoreAfterRun(toolEnvironment(localEnvironment()), snapshot);
    expect(result.incomplete).toBe(false);
    expect(readFileSync(join(root, 'src/app.ts'), 'utf8')).toBe('export const a = 1;');
    expect(existsSync(join(root, 'src/new.ts'))).toBe(false);
    expect(readFileSync(join(root, 'src/gone.ts'), 'utf8')).toBe('to be deleted');
    expect(readFileSync(join(root, 'out.log'), 'utf8')).toBe('an ignored log');
    expect(readFileSync(join(root, 'build/app.js'), 'utf8')).toBe('ignored build output');
    expect(readFileSync(join(root, 'node_modules/pkg/index.js'), 'utf8')).toBe('changed module');
    expect(recordsOf(result.records)).toEqual([
      'src/app.ts=restored',
      'src/gone.ts=re-created',
      'src/new.ts=deleted',
    ]);
    expect(result.records.every((record) => record.area === 'project files')).toBe(true);
  });
});

describe('restoreAfterRun: the reviewer without git', () => {
  it('reverts a file that git would have ignored, because without git only node_modules is skipped', async () => {
    const root = freshRoot();
    build(root, 'plain');
    const snapshot = mustSnapshot(
      await snapshotForRun(toolEnvironment(localEnvironment()), {
        root,
        job: 'reviewer',
        env: process.env,
      }),
    );
    writeFileSync(join(root, 'out.log'), 'created log');
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    writeFileSync(join(root, 'node_modules/kept.js'), 'kept');
    const result = await restoreAfterRun(toolEnvironment(localEnvironment()), snapshot);
    expect(existsSync(join(root, 'out.log'))).toBe(false);
    expect(readFileSync(join(root, 'node_modules/kept.js'), 'utf8')).toBe('kept');
    expect(recordsOf(result.records)).toEqual(['out.log=deleted']);
  });
});
