// The headless walk (p3-headless-e2e, G1 to G3, AC1 to AC4) on the local backend (p4-env-wsl, AC11). One
// feature goes through the engine on a temp git repo with a local bare remote and no network. The walk body
// is shared with the live WSL walk, in tests/support/headless-walk.ts; this file builds the local repo and
// calls it with the local setup. Git is read with the git CLI in the test only.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';
import {
  closeWalk,
  localGit,
  runHeadlessWalk,
  startWalk,
  storeBesideRepo,
  WALK_TIMEOUT_MS,
} from '../support/headless-walk';

const BRANCH = 'feature/p3-walk';

let scratch: string | null = null;

afterEach(() => {
  closeWalk();
  if (scratch !== null) {
    rmSync(scratch, { recursive: true, force: true });
    scratch = null;
  }
});

/** Runs git with the git CLI. Used by the test to set up the repo only. */
function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
}

/**
 * Builds the temp repo: a bare origin, an initial commit on main pushed with origin/HEAD set, and
 * the feature branch. Git config is set in the work repo, and the hooks folder is empty.
 */
function makeRepo(): { root: string; remote: string } {
  scratch = mkdtempSync(join(tmpdir(), 'sdd-headless-e2e-'));
  const hooks = join(scratch, 'no-hooks');
  mkdirSync(hooks);
  const remote = join(scratch, 'origin.git');
  mkdirSync(remote);
  sh(remote, ['init', '-q', '--bare', '-b', 'main']);
  const root = join(scratch, 'work');
  mkdirSync(root);
  sh(root, ['init', '-q', '-b', 'main']);
  sh(root, ['config', 'user.name', 'Walk Test']);
  sh(root, ['config', 'user.email', 'walk@example.com']);
  sh(root, ['config', 'init.defaultBranch', 'main']);
  sh(root, ['config', 'core.autocrlf', 'false']);
  sh(root, ['config', 'commit.gpgsign', 'false']);
  sh(root, ['config', 'core.hooksPath', hooks]);
  writeFileSync(join(root, 'README.md'), '# Walk\n');
  sh(root, ['add', '--', 'README.md']);
  sh(root, ['commit', '-q', '-m', 'Initial commit']);
  sh(root, ['remote', 'add', 'origin', remote]);
  sh(root, ['push', '-q', '-u', 'origin', 'main']);
  sh(root, ['remote', 'set-head', 'origin', 'main']);
  sh(root, ['checkout', '-q', '-b', BRANCH]);
  return { root, remote };
}

describe('the headless walk, planning to build-done (G1, G2, AC1 to AC4)', () => {
  it(
    'checks the node after each step, denies the spec write, runs the revision and the change round',
    async () => {
      const { root, remote } = makeRepo();
      const walk = await startWalk({
        root,
        remote,
        projectRoot: root,
        git: localGit,
        project: { kind: 'dev' },
        storeFile: storeBesideRepo(root),
      });
      await runHeadlessWalk(walk);
    },
    WALK_TIMEOUT_MS,
  );
});
