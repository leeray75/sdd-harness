import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  aheadOfUpstream,
  changedPaths,
  commit,
  currentBranch,
  defaultBranch,
  ignoredEntries,
  isRepoPath,
  push,
  stage,
} from '../../src/main/git/git';

// Each test drives its own temp repo, with a bare remote as a local folder and an empty hooks
// folder, so no global hook or config can change a result. No network is used.

const SLOW = 20_000;

let scratch: string;
let work: string;
let remote: string;

/** Runs git in a test repo and returns its stdout. Test setup only; the module under test is git.ts. */
function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
}

function write(relative: string, text: string): void {
  writeFileSync(join(work, relative), text);
}

function configure(dir: string): void {
  const hooks = join(scratch, 'no-hooks');
  mkdirSync(hooks, { recursive: true });
  sh(dir, ['config', 'user.name', 'Test User']);
  sh(dir, ['config', 'user.email', 'test@example.com']);
  sh(dir, ['config', 'core.autocrlf', 'false']);
  sh(dir, ['config', 'commit.gpgsign', 'false']);
  sh(dir, ['config', 'core.hooksPath', hooks]);
}

/** A work repo with one commit on main, pushed to a bare remote with upstream set. */
function setupRepo(): void {
  remote = join(scratch, 'remote.git');
  mkdirSync(remote);
  sh(remote, ['init', '-q', '--bare', '-b', 'main']);
  work = join(scratch, 'work');
  mkdirSync(work);
  sh(work, ['init', '-q', '-b', 'main']);
  configure(work);
  write('a.txt', 'a\n');
  write('b.txt', 'b\n');
  sh(work, ['add', 'a.txt', 'b.txt']);
  sh(work, ['commit', '-q', '-m', 'init']);
  sh(work, ['remote', 'add', 'origin', remote]);
  sh(work, ['push', '-q', '--set-upstream', 'origin', 'main']);
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'sdd-git-test-'));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('currentBranch', () => {
  it(
    'names the branch HEAD is on',
    async () => {
      setupRepo();
      expect(await currentBranch(work)).toEqual({ ok: true, value: { branch: 'main' } });
    },
    SLOW,
  );

  it(
    'reports a detached HEAD',
    async () => {
      setupRepo();
      sh(work, ['checkout', '-q', '--detach']);
      expect(await currentBranch(work)).toEqual({ ok: true, value: { detached: true } });
    },
    SLOW,
  );

  it(
    'gives not-a-repo for a folder that is not a repository',
    async () => {
      const plain = join(scratch, 'plain');
      mkdirSync(plain);
      expect(await currentBranch(plain)).toEqual({ ok: false, code: 'not-a-repo' });
    },
    SLOW,
  );
});

describe('defaultBranch', () => {
  it(
    'is null while origin/HEAD is unset',
    async () => {
      setupRepo();
      expect(await defaultBranch(work)).toEqual({ ok: true, value: null });
    },
    SLOW,
  );

  it(
    'names the branch origin/HEAD points to',
    async () => {
      setupRepo();
      sh(work, ['remote', 'set-head', 'origin', 'main']);
      expect(await defaultBranch(work)).toEqual({ ok: true, value: 'main' });
    },
    SLOW,
  );
});

describe('changedPaths', () => {
  it(
    'is empty on a clean tree',
    async () => {
      setupRepo();
      expect(await changedPaths(work)).toEqual({ ok: true, value: [] });
    },
    SLOW,
  );

  it(
    'lists modified, untracked and deleted files, with forward slashes',
    async () => {
      setupRepo();
      write('a.txt', 'changed\n');
      mkdirSync(join(work, 'docs'));
      write('docs/new file.md', 'new\n');
      unlinkSync(join(work, 'b.txt'));
      expect(await changedPaths(work)).toEqual({
        ok: true,
        value: ['a.txt', 'b.txt', 'docs/new file.md'],
      });
    },
    SLOW,
  );

  it(
    'gives both sides of a rename',
    async () => {
      setupRepo();
      sh(work, ['mv', 'a.txt', 'renamed.txt']);
      expect(await changedPaths(work)).toEqual({
        ok: true,
        value: ['a.txt', 'renamed.txt'],
      });
    },
    SLOW,
  );

  it(
    'lists a staged deletion',
    async () => {
      setupRepo();
      sh(work, ['rm', '-q', 'b.txt']);
      expect(await changedPaths(work)).toEqual({ ok: true, value: ['b.txt'] });
    },
    SLOW,
  );
});

describe('isRepoPath and stage', () => {
  it('accepts plain repo-relative paths and refuses the bad ones', () => {
    expect(isRepoPath('docs/specs/p3-ship/SUMMARY.md')).toBe(true);
    expect(isRepoPath('../outside.txt')).toBe(false);
    expect(isRepoPath('docs/../../x')).toBe(false);
    expect(isRepoPath('/etc/passwd')).toBe(false);
    expect(isRepoPath('C:/x')).toBe(false);
    expect(isRepoPath('-rf')).toBe(false);
    expect(isRepoPath('')).toBe(false);
    expect(isRepoPath('a\\b')).toBe(false);
    expect(isRepoPath('a//b')).toBe(false);
  });

  it(
    'stages a new file and a deletion',
    async () => {
      setupRepo();
      write('c.txt', 'c\n');
      unlinkSync(join(work, 'b.txt'));
      expect(await stage(work, ['c.txt', 'b.txt'])).toEqual({ ok: true });
      expect(sh(work, ['diff', '--cached', '--name-status']).trim().split('\n').sort()).toEqual([
        'A\tc.txt',
        'D\tb.txt',
      ]);
    },
    SLOW,
  );

  it(
    'matches a path literally, not as a glob',
    async () => {
      setupRepo();
      write('[a]', 'bracket\n');
      write('a', 'plain\n');
      expect(await stage(work, ['[a]'])).toEqual({ ok: true });
      expect(sh(work, ['diff', '--cached', '--name-only']).trim()).toBe('[a]');
    },
    SLOW,
  );

  it(
    'refuses a bad path, or an empty list, before git runs',
    async () => {
      setupRepo();
      write('c.txt', 'c\n');
      for (const bad of [['../c.txt'], ['/c.txt'], ['-c.txt'], [], ['c.txt', '..']]) {
        expect(await stage(work, bad)).toEqual({ ok: false, code: 'failed' });
      }
      expect(sh(work, ['diff', '--cached', '--name-only']).trim()).toBe('');
    },
    SLOW,
  );
});

describe('commit', () => {
  it(
    'commits what is staged with the message as given',
    async () => {
      setupRepo();
      write('c.txt', 'c\n');
      await stage(work, ['c.txt']);
      expect(await commit(work, 'T-1: add the c file')).toEqual({ ok: true });
      expect(sh(work, ['log', '-1', '--format=%s']).trim()).toBe('T-1: add the c file');
    },
    SLOW,
  );

  it(
    'fails when nothing is staged, and makes no commit',
    async () => {
      setupRepo();
      const before = sh(work, ['rev-parse', 'HEAD']).trim();
      expect(await commit(work, 'nothing')).toEqual({ ok: false, code: 'failed' });
      expect(sh(work, ['rev-parse', 'HEAD']).trim()).toBe(before);
    },
    SLOW,
  );

  it('refuses an empty message before git runs', async () => {
    expect(await commit(join(scratch, 'missing'), '')).toEqual({ ok: false, code: 'failed' });
  });
});

describe('push', () => {
  it(
    'pushes the branch to the bare remote and sets its upstream',
    async () => {
      setupRepo();
      write('c.txt', 'c\n');
      await stage(work, ['c.txt']);
      await commit(work, 'add c');
      sh(work, ['checkout', '-q', '-b', 'feature/p3-ship']);
      expect(await push(work, 'feature/p3-ship')).toEqual({ ok: true });
      expect(sh(remote, ['branch', '--list', 'feature/p3-ship']).trim()).toContain(
        'feature/p3-ship',
      );
      expect(sh(work, ['rev-parse', '--abbrev-ref', '@{u}']).trim()).toBe('origin/feature/p3-ship');
    },
    SLOW,
  );

  it(
    'fails for a missing remote, a local path that is not a repository',
    async () => {
      setupRepo();
      sh(work, ['remote', 'set-url', 'origin', join(scratch, 'nowhere.git')]);
      expect(await push(work, 'main')).toEqual({ ok: false, code: 'failed' });
    },
    SLOW,
  );

  it('refuses a name that is not a valid branch, before git runs', async () => {
    for (const bad of ['-force', '+main', 'a b', '', 'x:y', 'a..b']) {
      expect(await push(join(scratch, 'missing'), bad)).toEqual({ ok: false, code: 'failed' });
    }
  });
});

describe('ignoredEntries (D31, moved from protect.ts)', () => {
  it(
    'lists the git-ignored files and folders, with a folder as a trailing slash',
    async () => {
      setupRepo();
      write('.gitignore', 'ignored.txt\nbuild/\n');
      write('ignored.txt', 'x\n');
      mkdirSync(join(work, 'build'));
      write('build/out.js', 'y\n');
      write('kept.txt', 'z\n');
      const entries = await ignoredEntries(work, process.env);
      expect(entries).not.toBeNull();
      expect([...(entries ?? [])].sort()).toEqual(['build/', 'ignored.txt']);
    },
    SLOW,
  );

  it(
    'gives null for a folder that is not a repository',
    async () => {
      const plain = join(scratch, 'plain');
      mkdirSync(plain);
      expect(await ignoredEntries(plain, process.env)).toBeNull();
    },
    SLOW,
  );
});

describe('aheadOfUpstream', () => {
  it(
    'reports no upstream for a branch without one',
    async () => {
      setupRepo();
      sh(work, ['checkout', '-q', '-b', 'local-only']);
      expect(await aheadOfUpstream(work)).toEqual({ ok: true, value: { upstream: false } });
    },
    SLOW,
  );

  it(
    'reports no upstream on a detached HEAD',
    async () => {
      setupRepo();
      sh(work, ['checkout', '-q', '--detach']);
      expect(await aheadOfUpstream(work)).toEqual({ ok: true, value: { upstream: false } });
    },
    SLOW,
  );

  it(
    'counts the local commits the upstream does not have',
    async () => {
      setupRepo();
      expect(await aheadOfUpstream(work)).toEqual({
        ok: true,
        value: { upstream: true, ahead: 0 },
      });
      write('c.txt', 'c\n');
      await stage(work, ['c.txt']);
      await commit(work, 'add c');
      expect(await aheadOfUpstream(work)).toEqual({
        ok: true,
        value: { upstream: true, ahead: 1 },
      });
    },
    SLOW,
  );
});
