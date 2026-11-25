import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  allowedFromChanges,
  approveResult,
  closeMessage,
  commitMessage,
  commitSummary,
  firstHeading,
  gitStateOf,
  markDone,
  SHIP_REASONS,
  withGitState,
  type ShipOptions,
} from '../../src/main/workflow/ship';
import { readSpecFolder } from '../../src/main/workflow/spec-folders';
import { approvalOf, hashText } from '../../src/main/workflow/spec-lock';
import { SPEC_STATE_VERSION, serializeSpecState } from '../../src/shared/spec-state';
import type { NodeId } from '../../src/shared/workflow';

// Each test drives its own temp repo: a work repo on a feature branch, a bare remote as a local
// folder, and an empty hooks folder. No network is used. The fixture is a feature folder at
// build-done with an approved lock, so the ship steps run on real files.

const SLOW = 20_000;
const FEATURE = 'feat-one';
const BRANCH = 'feature/feat-one';
const SPECS_REL = `docs/specs/${FEATURE}/SPECS.md`;
const SUMMARY_REL = `docs/specs/${FEATURE}/SUMMARY.md`;
const STATE_REL = 'docs/specs/.sdd-state.json';
const UNCOMMITTED = 'uncommitted; the app commits after the result is approved';
const APPROVED_LINE = `Branch ${BRANCH}; approved; committed and pushed in the commit that adds this report.`;

let scratch: string;
let work: string;
let remote: string;

/** Runs git in a test repo and returns its stdout. Test setup only; the module under test is ship.ts. */
function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
}

function head(): string {
  return sh(work, ['rev-parse', 'HEAD']).trim();
}

function subject(): string {
  return sh(work, ['log', '-1', '--format=%s']).trim();
}

/** The porcelain status of the work repo: empty when the tree and the index are clean. */
function status(): string {
  return sh(work, ['status', '--porcelain=v1', '--untracked-files=all']);
}

function write(relative: string, text: string): void {
  const path = join(work, relative);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

function read(relative: string): string {
  return readFileSync(join(work, relative), 'utf8');
}

interface FixtureOptions {
  ticket?: string;
  /** The SUBTASK.md title, or null for no SUBTASK.md. */
  subtask?: string | null;
  /** The SPECS.md title, or null for no heading. */
  specsTitle?: string | null;
}

function specsText(options: FixtureOptions): string {
  const lines = ['---', 'status: approved', `ticket: ${options.ticket ?? ''}`, '---', ''];
  if (options.specsTitle !== null) {
    lines.push(`# ${options.specsTitle ?? 'Spec title'}`, '');
  }
  lines.push('## Goals', '', '- **G1:** x', '', '## Acceptance criteria', '', '- **AC1:** y', '');
  return lines.join('\n');
}

const SUMMARY_TEXT = [
  `# Build summary: ${FEATURE}`,
  '',
  '## Files changed',
  '',
  '- src/app.ts',
  '',
  '## Git state',
  '',
  UNCOMMITTED,
  '',
  '## Next steps',
  '',
  '- none',
  '',
].join('\n');

const CHANGES_TEXT = [
  `# Changes: ${FEATURE}`,
  '',
  '| File | Action | What and why | Task |',
  '| --- | --- | --- | --- |',
  '| `src/app.ts` | edited | the value | T1 |',
  '',
].join('\n');

/** Builds the fixture: a repo on the feature branch with an approved, build-done feature. */
function build(options: FixtureOptions = {}): void {
  scratch = mkdtempSync(join(tmpdir(), 'sdd-ship-test-'));
  const hooks = join(scratch, 'no-hooks');
  mkdirSync(hooks);
  remote = join(scratch, 'remote.git');
  mkdirSync(remote);
  sh(remote, ['init', '-q', '--bare', '-b', 'main']);
  work = join(scratch, 'work');
  mkdirSync(work);
  sh(work, ['init', '-q', '-b', 'main']);
  sh(work, ['config', 'user.name', 'Test User']);
  sh(work, ['config', 'user.email', 'test@example.com']);
  sh(work, ['config', 'core.autocrlf', 'false']);
  sh(work, ['config', 'commit.gpgsign', 'false']);
  sh(work, ['config', 'core.hooksPath', hooks]);
  write('README.md', 'readme\n');
  write('src/app.ts', 'export const v = 1;\n');
  sh(work, ['add', 'README.md', 'src/app.ts']);
  sh(work, ['commit', '-q', '-m', 'init']);
  sh(work, ['remote', 'add', 'origin', remote]);
  sh(work, ['push', '-q', '--set-upstream', 'origin', 'main']);
  sh(work, ['checkout', '-q', '-b', BRANCH]);

  const subtask = options.subtask === undefined ? 'Add the ship step' : options.subtask;
  const specs = specsText(options);
  write(SPECS_REL, specs);
  if (subtask !== null) write(`docs/specs/${FEATURE}/SUBTASK.md`, `# ${subtask}\n\nBody.\n`);
  write(SUMMARY_REL, SUMMARY_TEXT);
  write(`docs/specs/${FEATURE}/changes.md`, CHANGES_TEXT);
  writeLock(specs);
  // The implementation change, which is in the changes table.
  write('src/app.ts', 'export const v = 2;\n');
}

/** Writes the lock for a SPECS text: approved, hash of the text. */
function writeLock(specs: string, feature = FEATURE): void {
  writeFileSync(
    join(work, STATE_REL),
    serializeSpecState({
      version: SPEC_STATE_VERSION,
      feature,
      sha256: hashText(specs),
      approvedAt: '2026-11-22T10:00:00.000Z',
      editing: false,
    }),
  );
}

function breakOrigin(): void {
  sh(work, ['remote', 'set-url', 'origin', join(scratch, 'nowhere.git')]);
}

function mendOrigin(): void {
  sh(work, ['remote', 'set-url', 'origin', remote]);
}

function breakCommits(): void {
  sh(work, ['config', 'commit.gpgsign', 'true']);
  sh(work, ['config', 'gpg.program', join(scratch, 'no-such-gpg')]);
}

function mendCommits(): void {
  sh(work, ['config', 'commit.gpgsign', 'false']);
  sh(work, ['config', '--unset', 'gpg.program']);
}

/** Approves the result with the optional controller node. */
function approve(options: ShipOptions = {}) {
  return approveResult(work, FEATURE, options);
}

function close(options: ShipOptions = {}) {
  return markDone(work, FEATURE, options);
}

afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------

describe('commit message helpers', () => {
  it('flattens a heading to one line and caps it at 72 characters', () => {
    expect(firstHeading('# A   b\n\tc\n')).toBe('A b');
    expect(firstHeading('no heading here')).toBeNull();
    expect(firstHeading('#  \n')).toBeNull();
    expect(firstHeading('# ' + 'x'.repeat(100) + '\n')).toBe('x'.repeat(72));
  });

  it('takes the summary from SUBTASK, then SPECS, then the slug', () => {
    expect(commitSummary('f', '# Sub\n', '# Specs\n')).toBe('Sub');
    expect(commitSummary('f', null, '# Specs\n')).toBe('Specs');
    expect(commitSummary('f', null, null)).toBe('f');
  });

  it('puts the ticket in front when there is one', () => {
    expect(commitMessage('T-42', 'Add it')).toBe('T-42: Add it');
    expect(commitMessage('', 'Add it')).toBe('Add it');
    expect(closeMessage('f')).toBe('Close f spec');
  });

  it('reads the allowed set from the File column, without headers or separators', () => {
    const text = [
      '| File | Action | What and why | Task |',
      '| --- | --- | --- | --- |',
      '| `src/a.ts` | edited | x | T1 |',
      '| docs\\specs\\f\\b.md | created | y | T2 |',
      '| ../escape.ts | edited | z | T3 |',
      'not a row',
    ].join('\n');
    expect([...allowedFromChanges(text)].sort()).toEqual(['docs/specs/f/b.md', 'src/a.ts']);
    expect(allowedFromChanges(null).size).toBe(0);
  });

  it('reads and rewrites the line after the Git state heading', () => {
    expect(gitStateOf(SUMMARY_TEXT)).toBe(UNCOMMITTED);
    const rewritten = withGitState(SUMMARY_TEXT, 'new state');
    expect(rewritten).not.toBeNull();
    expect(gitStateOf(rewritten ?? '')).toBe('new state');
    expect(withGitState('# no git state\n', 'x')).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// approve-result: refusals (AC1)
// ---------------------------------------------------------------------------------------------

describe('approve-result refusals (AC1)', () => {
  function expectRefusedUnchanged(result: unknown, reason: string): void {
    expect(result).toEqual({ ok: false, reason });
    expect(head()).toBe(headBefore);
    expect(readOptional(SUMMARY_REL)).toBe(summaryBefore);
  }

  let headBefore = '';
  let summaryBefore: string | null = null;

  /** The text of a file, or null when it is absent. */
  function readOptional(relative: string): string | null {
    return existsSync(join(work, relative)) ? read(relative) : null;
  }

  function snapshot(): void {
    headBefore = head();
    summaryBefore = readOptional(SUMMARY_REL);
  }

  it(
    'refuses when the folder is not at build-done (spec-approved with no SUMMARY)',
    async () => {
      build();
      unlinkSync(join(work, SUMMARY_REL));
      snapshot();
      expectRefusedUnchanged(await approve(), SHIP_REASONS.notBuildDone);
    },
    SLOW,
  );

  it(
    'refuses when the build is paused',
    async () => {
      build();
      write(`docs/specs/${FEATURE}/build-ledger.md`, 'state: paused-for-revision\n');
      snapshot();
      expectRefusedUnchanged(await approve(), SHIP_REASONS.notBuildDone);
    },
    SLOW,
  );

  it(
    'refuses when the build is implementing',
    async () => {
      build();
      write(
        `docs/specs/${FEATURE}/build-ledger.md`,
        'state: running\nphase: implementing\ncurrent round: 1 of 3\n',
      );
      snapshot();
      expectRefusedUnchanged(await approve(), SHIP_REASONS.notBuildDone);
    },
    SLOW,
  );

  it(
    'refuses when the feature is closed (no lock, SUMMARY present)',
    async () => {
      build();
      unlinkSync(join(work, STATE_REL));
      snapshot();
      expectRefusedUnchanged(await approve(), SHIP_REASONS.notBuildDone);
    },
    SLOW,
  );

  it(
    'refuses when the lock cannot be read, so the approval is not approved',
    async () => {
      build();
      write(STATE_REL, 'not a state file');
      snapshot();
      expectRefusedUnchanged(await approve(), SHIP_REASONS.notApproved);
    },
    SLOW,
  );

  it(
    'refuses while the feature controller is not at build-done',
    async () => {
      build();
      snapshot();
      const controllerNode = (): NodeId => 'implementing';
      expectRefusedUnchanged(await approve({ controllerNode }), SHIP_REASONS.buildRunning);
    },
    SLOW,
  );

  it(
    'refuses on a detached HEAD',
    async () => {
      build();
      sh(work, ['checkout', '-q', '--detach']);
      snapshot();
      expectRefusedUnchanged(await approve(), SHIP_REASONS.detached);
    },
    SLOW,
  );

  it(
    'refuses on the default branch when origin/HEAD is unset',
    async () => {
      build();
      sh(work, ['checkout', '-q', 'main']);
      snapshot();
      expectRefusedUnchanged(await approve(), SHIP_REASONS.defaultBranch);
    },
    SLOW,
  );

  it(
    'refuses when the tree has a change outside the allowed set, and writes nothing',
    async () => {
      build();
      write('src/other.ts', 'export const other = 1;\n');
      snapshot();
      expectRefusedUnchanged(await approve(), SHIP_REASONS.outside);
      expect(existsSync(join(work, 'src/other.ts'))).toBe(true);
      expect(status()).toContain('src/other.ts');
    },
    SLOW,
  );
});

// ---------------------------------------------------------------------------------------------
// approve-result: commit and push (AC2)
// ---------------------------------------------------------------------------------------------

describe('approve-result commit and push (AC2)', () => {
  it(
    'commits the allowed changes with the ticket and pushes with upstream set',
    async () => {
      build({ ticket: 'T-42' });
      expect(await approve()).toEqual({ ok: true });
      expect(subject()).toBe('T-42: Add the ship step');
      const names = sh(work, ['show', '--name-only', '--format=', 'HEAD'])
        .trim()
        .split('\n')
        .sort();
      expect(names).toEqual(
        [
          STATE_REL,
          SPECS_REL,
          `docs/specs/${FEATURE}/SUBTASK.md`,
          SUMMARY_REL,
          `docs/specs/${FEATURE}/changes.md`,
          'src/app.ts',
        ].sort(),
      );
      expect(status()).toBe('');
      expect(sh(work, ['rev-parse', '--abbrev-ref', '@{u}']).trim()).toBe(`origin/${BRANCH}`);
      expect(sh(remote, ['rev-parse', BRANCH]).trim()).toBe(head());
    },
    SLOW,
  );

  it(
    'writes the approved Git state line into the committed SUMMARY',
    async () => {
      build();
      expect(await approve()).toEqual({ ok: true });
      expect(sh(work, ['show', `HEAD:${SUMMARY_REL}`])).toContain(APPROVED_LINE);
      expect(read(SUMMARY_REL)).toContain(APPROVED_LINE);
    },
    SLOW,
  );

  it(
    'uses the message without a ticket',
    async () => {
      build();
      expect(await approve()).toEqual({ ok: true });
      expect(subject()).toBe('Add the ship step');
    },
    SLOW,
  );

  it(
    'falls back to the SPECS heading when there is no SUBTASK',
    async () => {
      build({ subtask: null, specsTitle: 'Spec title here' });
      expect(await approve()).toEqual({ ok: true });
      expect(subject()).toBe('Spec title here');
    },
    SLOW,
  );

  it(
    'falls back to the slug when there is no heading at all',
    async () => {
      build({ subtask: null, specsTitle: null });
      expect(await approve()).toEqual({ ok: true });
      expect(subject()).toBe(FEATURE);
    },
    SLOW,
  );

  it(
    'caps a long summary at 72 characters',
    async () => {
      build({ subtask: 'x'.repeat(100) });
      expect(await approve()).toEqual({ ok: true });
      expect(subject()).toBe('x'.repeat(72));
    },
    SLOW,
  );
});

// ---------------------------------------------------------------------------------------------
// approve-result: push failure, retry, and the refusals after approval (AC4)
// ---------------------------------------------------------------------------------------------

describe('SUMMARY.md must hold a Git state line (revision 1)', () => {
  it(
    'refuses both actions when SUMMARY.md is missing, even with the ledger at done',
    async () => {
      build();
      write(`docs/specs/${FEATURE}/build-ledger.md`, 'state: done\n');
      unlinkSync(join(work, SUMMARY_REL));
      const before = head();
      expect(await approve()).toEqual({ ok: false, reason: SHIP_REASONS.summary });
      expect(await close()).toEqual({ ok: false, reason: SHIP_REASONS.summary });
      expect(head()).toBe(before);
    },
    SLOW,
  );

  it(
    'refuses both actions when SUMMARY.md has no Git state line',
    async () => {
      build();
      write(SUMMARY_REL, '# Build summary\n\n## Files changed\n\n- src/app.ts\n');
      const before = head();
      expect(await approve()).toEqual({ ok: false, reason: SHIP_REASONS.summary });
      expect(await close()).toEqual({ ok: false, reason: SHIP_REASONS.summary });
      expect(head()).toBe(before);
      expect(read(SUMMARY_REL)).not.toContain(APPROVED_LINE);
    },
    SLOW,
  );
});

describe('approve-result push failure and retry (AC4)', () => {
  it(
    'keeps the commit and gives the fixed push reason, with nothing private in it',
    async () => {
      build();
      breakOrigin();
      const result = await approve();
      expect(result).toEqual({ ok: false, reason: SHIP_REASONS.pushKept });
      expect(subject()).toBe('Add the ship step');
      const text = JSON.stringify(result);
      expect(text).not.toContain(BRANCH);
      expect(text).not.toContain('nowhere.git');
      expect(text).not.toContain('Add the ship step');
    },
    SLOW,
  );

  it(
    'a second approve-result pushes only, with no new commit',
    async () => {
      build();
      breakOrigin();
      await approve();
      const committed = head();
      mendOrigin();
      expect(await approve()).toEqual({ ok: true });
      expect(head()).toBe(committed);
      expect(sh(remote, ['rev-parse', BRANCH]).trim()).toBe(committed);
    },
    SLOW,
  );

  it(
    'refuses an approved work that is already committed and pushed',
    async () => {
      build();
      expect(await approve()).toEqual({ ok: true });
      const committed = head();
      expect(await approve()).toEqual({ ok: false, reason: SHIP_REASONS.alreadyPushed });
      expect(head()).toBe(committed);
    },
    SLOW,
  );

  it(
    'refuses an approved work whose tree has changes',
    async () => {
      build();
      expect(await approve()).toEqual({ ok: true });
      write('src/app.ts', 'export const v = 3;\n');
      expect(await approve()).toEqual({ ok: false, reason: SHIP_REASONS.approvedDirty });
    },
    SLOW,
  );

  it(
    'a failed commit puts the Git state line back, and a retry then commits',
    async () => {
      build();
      const original = read(SUMMARY_REL);
      breakCommits();
      const before = head();
      expect(await approve()).toEqual({ ok: false, reason: SHIP_REASONS.commitFailed });
      expect(head()).toBe(before);
      expect(read(SUMMARY_REL)).toBe(original);
      // The index matches the restored files: nothing differs between the index and the tree.
      expect(sh(work, ['diff', '--name-only']).trim()).toBe('');
      mendCommits();
      expect(await approve()).toEqual({ ok: true });
      expect(head()).not.toBe(before);
      expect(subject()).toBe('Add the ship step');
    },
    SLOW,
  );
});

// ---------------------------------------------------------------------------------------------
// mark-done (AC5, AC7)
// ---------------------------------------------------------------------------------------------

describe('mark-done (AC5)', () => {
  it(
    'is refused before the result is approved',
    async () => {
      build();
      const before = head();
      expect(await close()).toEqual({ ok: false, reason: SHIP_REASONS.approveFirst });
      expect(head()).toBe(before);
      expect(read(SPECS_REL)).toContain('status: approved');
      expect(existsSync(join(work, STATE_REL))).toBe(true);
    },
    SLOW,
  );

  it(
    'is refused while the approved work is unpushed',
    async () => {
      build();
      breakOrigin();
      expect(await approve()).toEqual({ ok: false, reason: SHIP_REASONS.pushKept });
      expect(await close()).toEqual({ ok: false, reason: SHIP_REASONS.pushFirst });
      expect(read(SPECS_REL)).toContain('status: approved');
    },
    SLOW,
  );

  it(
    'after a pushed approval, closes the feature and pushes the close',
    async () => {
      build();
      expect(await approve()).toEqual({ ok: true });
      expect(await close()).toEqual({ ok: true });
      expect(read(SPECS_REL)).toContain('status: done');
      expect(existsSync(join(work, STATE_REL))).toBe(false);
      expect(subject()).toBe(`Close ${FEATURE} spec`);
      const names = sh(work, ['show', '--name-only', '--format=', 'HEAD'])
        .trim()
        .split('\n')
        .sort();
      expect(names).toEqual([SPECS_REL, STATE_REL].sort());
      expect(sh(remote, ['rev-parse', BRANCH]).trim()).toBe(head());
      expect(status()).toBe('');
    },
    SLOW,
  );

  it(
    'leaves the folder detected as closed',
    async () => {
      build();
      await approve();
      await close();
      const folder = await readSpecFolder(work, FEATURE, await approvalOf(work, FEATURE));
      expect(folder?.detection.node).toBe('closed');
    },
    SLOW,
  );

  it(
    'leaves a state file that names another feature alone, and commits nothing',
    async () => {
      build();
      expect(await approve()).toEqual({ ok: true });
      // A lock for another feature, committed by someone else; the feature is then closed.
      writeLock('other', 'other-feat');
      sh(work, ['add', STATE_REL]);
      sh(work, ['commit', '-q', '-m', 'lock another feature']);
      const before = head();
      expect(await close()).toEqual({ ok: true });
      // The close is only a push here: no commit is made, and the other lock is untouched.
      expect(head()).toBe(before);
      expect(read(STATE_REL)).toContain('"feature": "other-feat"');
      expect(sh(remote, ['rev-parse', BRANCH]).trim()).toBe(before);
    },
    SLOW,
  );

  it(
    'a failed close commit puts SPECS.md and the state file back, and a retry then closes',
    async () => {
      build();
      expect(await approve()).toEqual({ ok: true });
      const specs = read(SPECS_REL);
      const state = read(STATE_REL);
      const before = head();
      breakCommits();
      expect(await close()).toEqual({ ok: false, reason: SHIP_REASONS.commitFailed });
      expect(head()).toBe(before);
      expect(read(SPECS_REL)).toBe(specs);
      expect(read(STATE_REL)).toBe(state);
      // Both files are staged again to their restored text, so the index equals HEAD for them.
      expect(sh(work, ['diff', '--name-only']).trim()).toBe('');
      expect(sh(work, ['diff', '--cached', '--name-only']).trim()).toBe('');
      mendCommits();
      expect(await close()).toEqual({ ok: true });
      expect(subject()).toBe(`Close ${FEATURE} spec`);
    },
    SLOW,
  );

  it(
    'a failed close push keeps the close commit, and a second mark-done pushes only',
    async () => {
      build();
      expect(await approve()).toEqual({ ok: true });
      breakOrigin();
      expect(await close()).toEqual({ ok: false, reason: SHIP_REASONS.pushKeptClose });
      expect(subject()).toBe(`Close ${FEATURE} spec`);
      const committed = head();
      mendOrigin();
      expect(await close()).toEqual({ ok: true });
      expect(head()).toBe(committed);
      expect(sh(remote, ['rev-parse', BRANCH]).trim()).toBe(committed);
    },
    SLOW,
  );

  it(
    'refuses a second close on a closed and pushed feature',
    async () => {
      build();
      await approve();
      await close();
      const before = head();
      expect(await close()).toEqual({ ok: false, reason: SHIP_REASONS.closedAlready });
      expect(head()).toBe(before);
    },
    SLOW,
  );
});
