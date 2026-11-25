// The git module of the main process (p3-ship, D38). It is the only code in the app that runs git.
// Every call goes through one private runner, runGit: the user's git CLI through execFile, with no
// shell, from the project root, with the process environment plus GIT_TERMINAL_PROMPT=0 and
// GCM_INTERACTIVE=never, so a missing credential fails instead of waiting for a prompt.
//
// The exported functions each run one fixed argument list. Their results carry only the values the
// module parses from git's stdout; git's output (stdout and stderr) is never returned, logged or put
// in an error. A failure is one of four fixed codes. Nothing here throws.
//
// No agent tool, job base tool or agent-process message reaches this module (D4). The ship module
// (src/main/workflow/ship.ts) is its only caller, and only from the human-only channel (D33).

import { execFile } from 'node:child_process';

/** The four failure codes. A value is never part of a code. */
export type GitFailure = 'git-missing' | 'timeout' | 'not-a-repo' | 'failed';

/** The outcome of a call that returns a value. */
export type GitResult<T> = { ok: true; value: T } | { ok: false; code: GitFailure };

/** The outcome of a call that returns nothing. */
export type GitStatus = { ok: true } | { ok: false; code: GitFailure };

/** The timeout of a local command, in milliseconds. */
export const LOCAL_TIMEOUT_MS = 30_000;
/** The timeout of a push, in milliseconds. */
export const PUSH_TIMEOUT_MS = 120_000;
/** The most stdout bytes a call may return to its parser. */
const MAX_BUFFER_BYTES = 16 * 1024 * 1024;

/** The environment added to the process environment for every call. */
const GIT_ENV = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } as const;

/** The stderr text of a folder that is not a repository. Read here only to pick the code. */
const NOT_A_REPO = /not a git repository/i;

/** The prefix of the remote's default branch ref, as origin/HEAD points to it. */
const ORIGIN_PREFIX = 'refs/remotes/origin/';

type ExecError = NodeJS.ErrnoException & { killed?: boolean };

type GitRun = { ok: true; stdout: string } | { ok: false; code: GitFailure };

function classify(error: ExecError, stderr: string): GitFailure {
  if (error.code === 'ENOENT') return 'git-missing';
  if (error.killed === true) return 'timeout';
  if (NOT_A_REPO.test(stderr)) return 'not-a-repo';
  return 'failed';
}

/**
 * Runs git with a fixed argument list, from `root`, without a shell. `literal` sets
 * GIT_LITERAL_PATHSPECS so a path is matched as written, never as a glob. Never throws.
 */
function runGit(
  root: string,
  args: readonly string[],
  options: { timeoutMs?: number; literal?: boolean } = {},
): Promise<GitRun> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...GIT_ENV,
    ...(options.literal === true ? { GIT_LITERAL_PATHSPECS: '1' } : {}),
  };
  return new Promise((resolve) => {
    try {
      execFile(
        'git',
        [...args],
        {
          cwd: root,
          shell: false,
          windowsHide: true,
          timeout: options.timeoutMs ?? LOCAL_TIMEOUT_MS,
          maxBuffer: MAX_BUFFER_BYTES,
          encoding: 'utf8',
          env,
        },
        (error, stdout, stderr) => {
          if (error === null) {
            resolve({ ok: true, stdout: String(stdout) });
            return;
          }
          resolve({ ok: false, code: classify(error as ExecError, String(stderr ?? '')) });
        },
      );
    } catch {
      resolve({ ok: false, code: 'failed' });
    }
  });
}

/**
 * True for a name git accepts as a branch to push: not empty, not starting with `-` or `+` (a
 * leading `+` would force a push), and no space, control character or ref-name punctuation that
 * git refuses (`~ ^ : ? * [ \`).
 */
function isBranchName(name: string): boolean {
  if (name === '' || name.startsWith('-') || name.startsWith('+')) return false;
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f) return false;
    if ('~^:?*[\\'.includes(char)) return false;
  }
  return !name.includes('..');
}

/**
 * True for a repo-relative path that may be staged: a non-empty string with forward slashes only,
 * not absolute, with no empty, `.` or `..` segment, no NUL and no leading `-`.
 */
export function isRepoPath(path: string): boolean {
  if (path === '' || path.startsWith('-') || path.includes('\0') || path.includes('\\')) {
    return false;
  }
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return false;
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/** The branch HEAD names, or `{ detached: true }` when HEAD is not on a branch. */
export async function currentBranch(
  root: string,
): Promise<GitResult<{ branch: string } | { detached: true }>> {
  const run = await runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!run.ok) return run;
  const name = run.stdout.trim();
  // git prints HEAD for a detached head; no branch can be named HEAD.
  if (name === 'HEAD') return { ok: true, value: { detached: true } };
  if (!isBranchName(name)) return { ok: false, code: 'failed' };
  return { ok: true, value: { branch: name } };
}

/**
 * The remote's default branch, from refs/remotes/origin/HEAD (set by the clone). Null when that
 * ref is unset or does not point at origin.
 */
export async function defaultBranch(root: string): Promise<GitResult<string | null>> {
  const run = await runGit(root, [
    'for-each-ref',
    '--format=%(symref)',
    'refs/remotes/origin/HEAD',
  ]);
  if (!run.ok) return run;
  const target = run.stdout.trim();
  if (!target.startsWith(ORIGIN_PREFIX)) return { ok: true, value: null };
  const name = target.slice(ORIGIN_PREFIX.length);
  return { ok: true, value: isBranchName(name) ? name : null };
}

/**
 * Every path with a change in the tree: staged, unstaged, untracked (each file) and deleted. A
 * rename gives both its old and its new path. Repo-relative, with forward slashes, sorted.
 */
export async function changedPaths(root: string): Promise<GitResult<string[]>> {
  const run = await runGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (!run.ok) return run;
  const items = run.stdout.split('\0');
  const paths = new Set<string>();
  for (let index = 0; index < items.length; index += 1) {
    const entry = items[index] ?? '';
    if (entry.length < 4) continue;
    const status = entry.slice(0, 2);
    paths.add(entry.slice(3));
    // A rename or copy is followed by its original path as its own NUL-separated item.
    if (status.includes('R') || status.includes('C')) {
      const origin = items[index + 1];
      if (origin !== undefined && origin !== '') paths.add(origin);
      index += 1;
    }
  }
  return { ok: true, value: [...paths].sort() };
}

/**
 * Stages the given paths, deletions included (`add --all -- <paths>`). A path that is not a plain
 * repo-relative path, or an empty list, is refused before git runs: an empty list would stage the
 * whole tree.
 */
export async function stage(root: string, paths: readonly string[]): Promise<GitStatus> {
  if (paths.length === 0 || !paths.every(isRepoPath)) return { ok: false, code: 'failed' };
  const run = await runGit(root, ['add', '--all', '--', ...paths], { literal: true });
  return run.ok ? { ok: true } : run;
}

/** Commits what is staged, with the message as one argument (`commit -m <message>`). */
export async function commit(root: string, message: string): Promise<GitStatus> {
  if (message === '' || message.includes('\0')) return { ok: false, code: 'failed' };
  const run = await runGit(root, ['commit', '-m', message]);
  return run.ok ? { ok: true } : run;
}

/**
 * Pushes the branch to origin and sets its upstream (`push --set-upstream origin <branch>`). A
 * name that is not a valid branch is refused before git runs.
 */
export async function push(root: string, branch: string): Promise<GitStatus> {
  if (!isBranchName(branch)) return { ok: false, code: 'failed' };
  const run = await runGit(root, ['push', '--set-upstream', 'origin', branch], {
    timeoutMs: PUSH_TIMEOUT_MS,
  });
  return run.ok ? { ok: true } : run;
}

/**
 * How many commits the current branch has that its upstream does not, from local refs only (no
 * fetch). `{ upstream: false }` when HEAD is detached or the branch has no upstream.
 */
export async function aheadOfUpstream(
  root: string,
): Promise<GitResult<{ upstream: false } | { upstream: true; ahead: number }>> {
  const head = await currentBranch(root);
  if (!head.ok) return head;
  if (!('branch' in head.value)) return { ok: true, value: { upstream: false } };
  const ref = `refs/heads/${head.value.branch}`;
  // The pattern matches a prefix of other branches too, so the line for this exact ref is taken.
  const refs = await runGit(root, ['for-each-ref', '--format=%(refname)%09%(upstream)', ref]);
  if (!refs.ok) return refs;
  const line = refs.stdout.split('\n').find((text) => text.split('\t')[0] === ref);
  const upstream = line?.split('\t')[1]?.trim() ?? '';
  if (upstream === '') return { ok: true, value: { upstream: false } };
  const count = await runGit(root, ['rev-list', '--count', '@{u}..HEAD']);
  if (!count.ok) return count;
  const ahead = Number.parseInt(count.stdout.trim(), 10);
  if (!Number.isSafeInteger(ahead) || ahead < 0) return { ok: false, code: 'failed' };
  return { ok: true, value: { upstream: true, ahead } };
}

/** The most stdout bytes the ignored-entries query may return. */
const IGNORED_MAX_BYTES = 256 * 1024 * 1024;
/** The timeout of the ignored-entries query, in milliseconds. */
const IGNORED_TIMEOUT_MS = 60_000;

/**
 * The git-ignored entries of a root (D31, moved here from src/main/commands/protect.ts): a read-only
 * `ls-files` query with a fixed argument list, no shell, and the caller's environment as it is given
 * (no variable is added). Each entry is a path, a folder with a trailing slash. Null when git is
 * missing, the root is not a repository, or the query fails. The output is parsed here and never
 * returned as text.
 */
export function ignoredEntries(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Set<string> | null> {
  return new Promise((resolve) => {
    try {
      execFile(
        'git',
        [
          '-C',
          root,
          'ls-files',
          '-z',
          '--others',
          '--ignored',
          '--exclude-standard',
          '--directory',
        ],
        {
          env,
          shell: false,
          windowsHide: true,
          maxBuffer: IGNORED_MAX_BYTES,
          timeout: IGNORED_TIMEOUT_MS,
        },
        (error, stdout) => {
          if (error) {
            resolve(null);
            return;
          }
          const entries = String(stdout)
            .split('\0')
            .filter((entry) => entry.length > 0);
          resolve(new Set(entries));
        },
      );
    } catch {
      resolve(null);
    }
  });
}
