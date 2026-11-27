// The project checks (p4-project-checks, D45): the shared helpers in src/shared/project-checks.ts and the
// runner in src/main/projects/checks.ts. The file checks run on a real temp folder through the local
// backend; the git part and the connection are fakes. Every environment call is recorded, so a test can
// see which calls ran (and which did not). No network is used.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { localEnvironment } from '../../src/main/env';
import type { ConnectionState, Environment, GitPart } from '../../src/main/env/types';
import { runProjectChecks } from '../../src/main/projects/checks';
import { PROJECT_UNREACHABLE } from '../../src/main/projects/registry';
import {
  CHECK_IDS,
  CHECK_STATUSES,
  codeHostOf,
  inferTracker,
  parseOrigin,
  type ProjectCheck,
  type ProjectChecks,
} from '../../src/shared/project-checks';

let scratch: string;
let root: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'sdd-checks-test-'));
  root = join(scratch, 'project');
  mkdirSync(root);
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** Writes a file under the project root, making its folders. */
function write(relative: string, text: string): void {
  const path = join(root, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** A wrapper that records each call of a method as `label.method` before it runs. */
function recording<T extends object>(target: T, label: string, calls: string[]): T {
  return new Proxy(target, {
    get(obj, prop) {
      const value: unknown = Reflect.get(obj, prop);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        calls.push(`${label}.${String(prop)}`);
        return (value as (...params: unknown[]) => unknown).apply(obj, args);
      };
    },
  });
}

/** The git part of a clean repository on main with an origin on GitHub, overridden by the test. */
function fakeGit(calls: string[], over: Partial<GitPart> = {}): GitPart {
  const defaults: GitPart = {
    currentBranch: async () => ({ ok: true, value: { branch: 'main' } }),
    defaultBranch: async () => ({ ok: true, value: null }),
    changedPaths: async () => ({ ok: true, value: [] }),
    stage: async () => ({ ok: true }),
    commit: async () => ({ ok: true }),
    push: async () => ({ ok: true }),
    aheadOfUpstream: async () => ({ ok: true, value: { upstream: false } }),
    ignoredEntries: async () => null,
    originUrl: async () => ({ ok: true, value: 'https://github.com/acme/app.git' }),
  };
  return recording({ ...defaults, ...over }, 'git', calls);
}

/**
 * The environment under test: the local backend's files and path, recorded, with a fake git part and a
 * connection whose state the test controls. `calls` lists every recorded call in order.
 */
function makeEnv(options: { git?: Partial<GitPart>; state?: () => ConnectionState } = {}): {
  env: Environment;
  calls: string[];
} {
  const calls: string[] = [];
  const base = localEnvironment();
  const env: Environment = {
    path: base.path,
    files: recording(base.files, 'files', calls),
    process: recording(base.process, 'process', calls),
    watch: base.watch,
    git: fakeGit(calls, options.git),
    connection: {
      state: () => options.state?.() ?? 'connected',
      onChange: () => () => undefined,
      reconnect: async () => {
        calls.push('connection.reconnect');
        return { ok: true };
      },
    },
  };
  return { env, calls };
}

/** The check with this id, from a result. */
function checkOf(result: ProjectChecks, id: (typeof CHECK_IDS)[number]): ProjectCheck {
  const found = result.checks.find((check) => check.id === id);
  if (found === undefined) throw new Error(`no check ${id}`);
  return found;
}

describe('shared helpers: parseOrigin (AC1, AC4)', () => {
  it.each([
    ['https://github.com/acme/app.git', 'github.com'],
    ['https://alice:ghp_TOKEN123@GitHub.com:8443/acme/app.git', 'github.com'],
    ['https://ghp_TOKEN123@github.com/acme/app.git', 'github.com'],
    ['http://gitlab.example.com/acme/app.git', 'gitlab.example.com'],
    ['ssh://git@bitbucket.org:2222/acme/app.git', 'bitbucket.org'],
    ['git@dev.azure.com:v3/acme/app/app', 'dev.azure.com'],
    ['git://git.example.org/repo.git', 'git.example.org'],
  ])('reads the host of %s', (url, host) => {
    expect(parseOrigin(url)).toEqual({ host });
  });

  it.each([
    '/srv/repo.git',
    'C:\\repo',
    'C:/repo',
    'file:///srv/repo.git',
    'relative/path',
    '',
    'https://host\nexample.com/x',
    'https://exa\tmple.com/x',
    'https://ex ample.com/x',
    'https://[::1]/x',
  ])('gives null for %j', (url) => {
    expect(parseOrigin(url)).toBeNull();
  });

  it('never throws, even for a value that is not text', () => {
    expect(parseOrigin(undefined as unknown as string)).toBeNull();
  });
});

describe('shared helpers: codeHostOf and inferTracker (AC1, AC5)', () => {
  it('names the four hosts and gives Other for the rest', () => {
    expect(codeHostOf('github.com')).toBe('GitHub');
    expect(codeHostOf('gitlab.com')).toBe('GitLab');
    expect(codeHostOf('bitbucket.org')).toBe('Bitbucket');
    expect(codeHostOf('dev.azure.com')).toBe('Azure DevOps');
    expect(codeHostOf('acme.visualstudio.com')).toBe('Azure DevOps');
    expect(codeHostOf('git.example.org')).toBe('Other: git.example.org');
  });

  it('infers Jira from a ticket id, then the code host, and otherwise nothing', () => {
    expect(inferTracker(['PROJ-12'], 'GitHub')).toBe('Jira');
    expect(inferTracker(['12'], 'GitHub')).toBe('GitHub Issues');
    expect(inferTracker([], 'GitLab')).toBe('GitLab Issues');
    expect(inferTracker([], 'Other: git.example.org')).toBeNull();
    expect(inferTracker([], null)).toBeNull();
    expect(inferTracker(['proj-1'], null)).toBeNull();
  });
});

describe('runProjectChecks: the result (AC1)', () => {
  it('returns five checks in CHECK_IDS order, with known statuses', async () => {
    const { env } = makeEnv();
    const result = await runProjectChecks(env, root);
    expect(result.checks.map((check) => check.id)).toEqual([...CHECK_IDS]);
    for (const check of result.checks) {
      expect(CHECK_STATUSES).toContain(check.status);
    }
  });
});

describe('the git repository check (AC3)', () => {
  it('is ok and clean on a clean tree', async () => {
    const { env } = makeEnv();
    expect(checkOf(await runProjectChecks(env, root), 'git')).toEqual({
      id: 'git',
      status: 'ok',
      title: 'Git repository',
      detail: 'Branch main · clean',
    });
  });

  it('counts the changed files, singular for one', async () => {
    const three = makeEnv({
      git: { changedPaths: async () => ({ ok: true, value: ['a', 'b', 'c'] }) },
    });
    expect(checkOf(await runProjectChecks(three.env, root), 'git').detail).toBe(
      'Branch main · 3 changed files',
    );
    const one = makeEnv({ git: { changedPaths: async () => ({ ok: true, value: ['a'] }) } });
    expect(checkOf(await runProjectChecks(one.env, root), 'git').detail).toBe(
      'Branch main · 1 changed file',
    );
  });

  it('shows a detached head as Detached HEAD', async () => {
    const { env } = makeEnv({
      git: { currentBranch: async () => ({ ok: true, value: { detached: true } }) },
    });
    expect(checkOf(await runProjectChecks(env, root), 'git').detail).toBe('Detached HEAD · clean');
  });

  it('fails outside a repository, with its fix', async () => {
    const { env } = makeEnv({
      git: { currentBranch: async () => ({ ok: false, code: 'not-a-repo' }) },
    });
    expect(checkOf(await runProjectChecks(env, root), 'git')).toEqual({
      id: 'git',
      status: 'fail',
      title: 'Git repository',
      detail: 'Not a git repository',
      fix: "Run git init in this folder, or pick the repository's folder",
    });
  });

  it('fails when git is missing, with its fix', async () => {
    const { env } = makeEnv({
      git: { changedPaths: async () => ({ ok: false, code: 'git-missing' }) },
    });
    expect(checkOf(await runProjectChecks(env, root), 'git')).toEqual({
      id: 'git',
      status: 'fail',
      title: 'Git repository',
      detail: 'Git is not installed in this environment',
      fix: 'Install git in this environment',
    });
  });

  it('fails when git does not answer in time', async () => {
    const { env } = makeEnv({
      git: { currentBranch: async () => ({ ok: false, code: 'timeout' }) },
    });
    expect(checkOf(await runProjectChecks(env, root), 'git')).toEqual({
      id: 'git',
      status: 'fail',
      title: 'Git repository',
      detail: 'Git did not answer',
    });
  });
});

describe('the code host check (AC4)', () => {
  it.each([
    ['https://github.com/acme/app.git', 'Code host: GitHub'],
    ['https://alice:ghp_TOKEN123@github.com/acme/app.git', 'Code host: GitHub'],
    ['https://gitlab.com:443/acme/app.git', 'Code host: GitLab'],
    ['ssh://git@bitbucket.org:22/acme/app.git', 'Code host: Bitbucket'],
    ['git@github.com:acme/app.git', 'Code host: GitHub'],
    ['git@dev.azure.com:v3/acme/app/app', 'Code host: Azure DevOps'],
    ['git://git.example.org/repo.git', 'Code host: Other: git.example.org'],
  ])('names the host of %s', async (origin, title) => {
    const { env } = makeEnv({
      git: { originUrl: async () => ({ ok: true, value: origin }) },
    });
    expect(checkOf(await runProjectChecks(env, root), 'code-host')).toEqual({
      id: 'code-host',
      status: 'ok',
      title,
      detail: 'From the origin remote',
    });
  });

  it('warns that a local path is not a code host', async () => {
    const { env } = makeEnv({
      git: { originUrl: async () => ({ ok: true, value: '/srv/repo.git' }) },
    });
    expect(checkOf(await runProjectChecks(env, root), 'code-host')).toEqual({
      id: 'code-host',
      status: 'warn',
      title: 'Code host',
      detail: 'The origin remote is not a code host',
    });
  });

  it('warns when there is no origin, with its fix', async () => {
    const { env } = makeEnv({ git: { originUrl: async () => ({ ok: true, value: null }) } });
    expect(checkOf(await runProjectChecks(env, root), 'code-host')).toEqual({
      id: 'code-host',
      status: 'warn',
      title: 'Code host',
      detail: 'No origin remote',
      fix: 'Add an origin remote to ship to a code host',
    });
  });

  it('warns when the origin cannot be read', async () => {
    const { env } = makeEnv({ git: { originUrl: async () => ({ ok: false, code: 'failed' }) } });
    expect(checkOf(await runProjectChecks(env, root), 'code-host')).toEqual({
      id: 'code-host',
      status: 'warn',
      title: 'Code host',
      detail: 'The origin remote could not be read',
    });
  });

  it('is not checked when git failed, and reads no origin', async () => {
    const { env, calls } = makeEnv({
      git: { currentBranch: async () => ({ ok: false, code: 'not-a-repo' }) },
    });
    const result = await runProjectChecks(env, root);
    expect(checkOf(result, 'code-host')).toEqual({
      id: 'code-host',
      status: 'not-checked',
      title: 'Code host',
      detail: 'Needs a git repository',
    });
    expect(calls).not.toContain('git.originUrl');
  });

  it.each([
    'https://alice:ghp_TOKEN123@github.com/acme/app.git',
    'https://ghp_TOKEN123@github.com/acme/app.git',
    'ssh://alice@gitlab.example.com:2222/acme/app.git',
  ])('keeps the user, the token and the URL out of every field for %s', async (origin) => {
    write('docs/specs/p4-a/SPECS.md', '---\nstatus: approved\nticket: PROJ-1\n---\n');
    const { env } = makeEnv({ git: { originUrl: async () => ({ ok: true, value: origin }) } });
    const text = JSON.stringify(await runProjectChecks(env, root));
    expect(text).not.toContain('alice');
    expect(text).not.toContain('TOKEN123');
    expect(text).not.toContain('ghp_');
    expect(text).not.toContain(origin);
  });
});

describe('the tracker check (AC5)', () => {
  it('infers Jira from a spec ticket id, and is never connected', async () => {
    write('docs/specs/p4-a/SPECS.md', '---\nstatus: approved\nticket: PROJ-12\n---\n');
    const { env } = makeEnv();
    expect(checkOf(await runProjectChecks(env, root), 'tracker')).toEqual({
      id: 'tracker',
      status: 'warn',
      title: 'Tracker: Jira',
      detail: 'Not connected. Without it, tickets are typed by hand.',
      fix: "Connecting a tracker comes later; you can add it from the project's settings",
    });
  });

  it('infers GitHub Issues from the GitHub host', async () => {
    const { env } = makeEnv();
    expect(checkOf(await runProjectChecks(env, root), 'tracker').title).toBe(
      'Tracker: GitHub Issues',
    );
  });

  it('infers GitLab Issues from the GitLab host', async () => {
    const { env } = makeEnv({
      git: { originUrl: async () => ({ ok: true, value: 'https://gitlab.com/acme/app.git' }) },
    });
    expect(checkOf(await runProjectChecks(env, root), 'tracker').title).toBe(
      'Tracker: GitLab Issues',
    );
  });

  it('gives no tracker name when nothing is inferred, and always warns', async () => {
    const { env } = makeEnv({
      git: { originUrl: async () => ({ ok: true, value: 'git://git.example.org/repo.git' }) },
    });
    const check = checkOf(await runProjectChecks(env, root), 'tracker');
    expect(check.title).toBe('Tracker');
    expect(check.status).toBe('warn');
    expect(check.detail).toBe('Not connected. Without it, tickets are typed by hand.');
  });
});

describe('the test command check (AC6)', () => {
  it('finds a package.json test script, with its form and marker', async () => {
    write('package.json', JSON.stringify({ scripts: { test: 'vitest' } }));
    write('pnpm-lock.yaml', '');
    const { env } = makeEnv();
    const check = checkOf(await runProjectChecks(env, root), 'test-command');
    expect(check.status).toBe('ok');
    expect(check.title).toBe('Test command');
    expect(check.detail).toMatch(/^Found pnpm .+ in package\.json$/);
  });

  it('finds a Go test command, with go.mod as its marker', async () => {
    write('go.mod', 'module example.com/app\n');
    const { env } = makeEnv();
    expect(checkOf(await runProjectChecks(env, root), 'test-command').detail).toBe(
      'Found go test ./... in go.mod',
    );
  });

  it('warns when no test command is found, with its fix', async () => {
    const { env } = makeEnv();
    expect(checkOf(await runProjectChecks(env, root), 'test-command')).toEqual({
      id: 'test-command',
      status: 'warn',
      title: 'Test command',
      detail: 'No test command found',
      fix: 'Add a test script, for example "test" in package.json',
    });
  });

  it('reports earlier specs with a count, singular for one', async () => {
    write('docs/specs/p4-a/SPECS.md', '---\nstatus: approved\n---\n');
    write('docs/specs/p4-b/SPECS.md', '---\nstatus: approved\n---\n');
    const two = makeEnv();
    expect(checkOf(await runProjectChecks(two.env, root), 'earlier-specs')).toEqual({
      id: 'earlier-specs',
      status: 'info',
      title: 'Earlier specs',
      detail: '2 found in docs/specs',
    });
    rmSync(join(root, 'docs/specs/p4-b'), { recursive: true, force: true });
    const one = makeEnv();
    expect(checkOf(await runProjectChecks(one.env, root), 'earlier-specs').detail).toBe(
      '1 found in docs/specs',
    );
  });

  it('says none yet when docs/specs has no feature folder', async () => {
    const { env } = makeEnv();
    expect(checkOf(await runProjectChecks(env, root), 'earlier-specs')).toEqual({
      id: 'earlier-specs',
      status: 'info',
      title: 'Earlier specs',
      detail: 'None yet',
    });
  });
});

describe('robustness and calls (AC7, AC8)', () => {
  it('turns a check whose call throws into a fixed fail, and the others still return', async () => {
    const { env } = makeEnv({
      git: {
        originUrl: async () => {
          throw new Error('C:\\secret\\path and token ghp_X');
        },
      },
    });
    const result = await runProjectChecks(env, root);
    expect(result.checks).toHaveLength(5);
    expect(checkOf(result, 'code-host')).toEqual({
      id: 'code-host',
      status: 'fail',
      title: 'Code host',
      detail: 'The check could not run',
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(checkOf(result, 'git').status).toBe('ok');
    expect(checkOf(result, 'earlier-specs').status).toBe('info');
  });

  it('never rejects, even when the git part throws on every call', async () => {
    const boom = async (): Promise<never> => {
      throw new Error('boom');
    };
    const { env } = makeEnv({
      git: { currentBranch: boom, changedPaths: boom, originUrl: boom },
    });
    const result = await runProjectChecks(env, root);
    expect(result.checks.map((check) => check.id)).toEqual([...CHECK_IDS]);
    expect(checkOf(result, 'git').detail).toBe('The check could not run');
  });

  it('runs nothing and reads no file when the environment is unreachable', async () => {
    const { env, calls } = makeEnv({ state: () => 'unreachable' });
    const result = await runProjectChecks(env, root);
    expect(result.checks.map((check) => check.id)).toEqual([...CHECK_IDS]);
    for (const check of result.checks) {
      expect(check.status).toBe('not-checked');
      expect(check.detail).toBe(PROJECT_UNREACHABLE);
    }
    expect(calls).toEqual([]);
  });

  it('turns the remaining checks not-checked when the state changes mid-run', async () => {
    let unreachable = false;
    const { env, calls } = makeEnv({
      state: () => (unreachable ? 'unreachable' : 'connected'),
      git: {
        currentBranch: async () => {
          unreachable = true;
          return { ok: true, value: { branch: 'main' } };
        },
      },
    });
    const result = await runProjectChecks(env, root);
    expect(checkOf(result, 'git').status).toBe('ok');
    for (const id of CHECK_IDS.slice(1)) {
      expect(checkOf(result, id)).toEqual({
        id,
        status: 'not-checked',
        title: checkOf(result, id).title,
        detail: PROJECT_UNREACHABLE,
      });
    }
    expect(calls).toEqual(['git.currentBranch', 'git.changedPaths']);
  });

  it('makes at most one call per git read, starts no program, and never reconnects', async () => {
    write('package.json', JSON.stringify({ scripts: { test: 'vitest' } }));
    write('docs/specs/p4-a/SPECS.md', '---\nstatus: approved\n---\n');
    const { env, calls } = makeEnv();
    await runProjectChecks(env, root);
    expect(calls.filter((call) => call === 'git.currentBranch')).toHaveLength(1);
    expect(calls.filter((call) => call === 'git.changedPaths')).toHaveLength(1);
    expect(calls.filter((call) => call === 'git.originUrl')).toHaveLength(1);
    expect(calls.filter((call) => call.startsWith('process.'))).toEqual([]);
    expect(calls).not.toContain('connection.reconnect');
  });
});
