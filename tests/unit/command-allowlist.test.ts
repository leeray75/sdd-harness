import { describe, expect, it } from 'vitest';
import type { DetectedCommands } from '../../src/main/commands/detect';
import {
  makeCommandCheck,
  NOT_A_COMMAND_JOB,
  NOT_FROM_ROOT,
  NOT_LISTED,
  REVIEWER_TESTS_ONLY,
} from '../../src/main/policy/command-allowlist';
import type { CommandCall } from '../../src/main/policy/context';

const DETECTED: DetectedCommands = {
  test: [
    { program: 'npm', args: ['test'] },
    { program: 'npm', args: ['run', 'test'] },
  ],
  build: [
    { program: 'pnpm', args: ['run', 'build'] },
    { program: 'pnpm', args: ['build'] },
  ],
};

const check = makeCommandCheck(DETECTED);

function ask(call: Partial<CommandCall> & Pick<CommandCall, 'job' | 'program'>) {
  return check({ args: [], ...call });
}

function reasonOf(result: ReturnType<typeof check>): string {
  expect(result.allow).toBe(false);
  return result.allow ? '' : result.reason;
}

describe('makeCommandCheck: the six steps and their reasons', () => {
  it('step 1: planner and reader are denied with the job reason', () => {
    for (const job of ['planner', 'reader'] as const) {
      expect(reasonOf(ask({ job, program: 'npm', args: ['test'] }))).toBe(NOT_A_COMMAND_JOB);
    }
  });

  it('step 2: a cwd other than . is denied, and an absent or . cwd is not', () => {
    expect(reasonOf(ask({ job: 'writer', program: 'npm', args: ['test'], cwd: 'app' }))).toBe(
      NOT_FROM_ROOT,
    );
    expect(reasonOf(ask({ job: 'writer', program: 'npm', args: ['test'], cwd: '' }))).toBe(
      NOT_FROM_ROOT,
    );
    expect(ask({ job: 'writer', program: 'npm', args: ['test'], cwd: '.' })).toEqual({
      allow: true,
    });
  });

  it('step 3: an empty program or a program with a separator is not listed', () => {
    for (const program of ['', '/usr/bin/npm', 'bin\\npm', './npm', 'C:\\tools\\npm.exe']) {
      expect(reasonOf(ask({ job: 'writer', program, args: ['test'] }))).toBe(NOT_LISTED);
    }
  });

  it('step 4: the writer may run every detected test and build form', () => {
    expect(ask({ job: 'writer', program: 'npm', args: ['test'] })).toEqual({ allow: true });
    expect(ask({ job: 'writer', program: 'npm', args: ['run', 'test'] })).toEqual({ allow: true });
    expect(ask({ job: 'writer', program: 'pnpm', args: ['run', 'build'] })).toEqual({
      allow: true,
    });
    expect(ask({ job: 'writer', program: 'pnpm', args: ['build'] })).toEqual({ allow: true });
  });

  it('step 5: the reviewer may run test forms only, and gets the tests-only reason for a build', () => {
    expect(ask({ job: 'reviewer', program: 'npm', args: ['run', 'test'] })).toEqual({
      allow: true,
    });
    expect(reasonOf(ask({ job: 'reviewer', program: 'pnpm', args: ['build'] }))).toBe(
      REVIEWER_TESTS_ONLY,
    );
  });

  it('step 6: anything else is not listed', () => {
    expect(reasonOf(ask({ job: 'writer', program: 'curl', args: ['x'] }))).toBe(NOT_LISTED);
    expect(reasonOf(ask({ job: 'reviewer', program: 'curl', args: [] }))).toBe(NOT_LISTED);
  });

  it('an empty check denies every command for both jobs', () => {
    const none = makeCommandCheck({ test: [], build: [] });
    expect(none({ job: 'writer', program: 'npm', args: ['test'] })).toEqual({
      allow: false,
      reason: NOT_LISTED,
    });
  });
});

describe('makeCommandCheck: exact matching', () => {
  it('denies extra arguments, missing arguments and changed arguments', () => {
    for (const args of [
      ['test', '--watch'],
      [],
      ['run'],
      ['run', 'test', 'extra'],
      ['tests'],
      ['run', 'build'],
    ]) {
      expect(reasonOf(ask({ job: 'writer', program: 'npm', args }))).toBe(NOT_LISTED);
    }
  });

  it('is case-sensitive for arguments', () => {
    expect(reasonOf(ask({ job: 'writer', program: 'npm', args: ['Test'] }))).toBe(NOT_LISTED);
  });

  it('ignores case, and a .exe, .cmd or .bat extension, on the program only', () => {
    for (const program of ['NPM', 'npm.exe', 'npm.CMD', 'Npm.Bat', 'NPM.EXE']) {
      expect(ask({ job: 'writer', program, args: ['test'] })).toEqual({ allow: true });
    }
    expect(reasonOf(ask({ job: 'writer', program: 'npm.sh', args: ['test'] }))).toBe(NOT_LISTED);
    expect(reasonOf(ask({ job: 'writer', program: 'npm.cmd.exe', args: ['test'] }))).toBe(
      NOT_LISTED,
    );
    expect(reasonOf(ask({ job: 'writer', program: 'npm', args: ['TEST'] }))).toBe(NOT_LISTED);
  });

  it('never echoes the program or the arguments in a reason', () => {
    const sentinel = 'SENTINEL-CALL-9f3';
    const denials = [
      ask({ job: 'planner', program: sentinel, args: [sentinel] }),
      ask({ job: 'writer', program: sentinel, args: [sentinel], cwd: sentinel }),
      ask({ job: 'writer', program: `/${sentinel}`, args: [] }),
      ask({ job: 'writer', program: sentinel, args: ['x'] }),
      ask({ job: 'reviewer', program: 'pnpm', args: [sentinel] }),
    ];
    for (const denial of denials) {
      expect(denial.allow).toBe(false);
      if (!denial.allow) expect(denial.reason).not.toContain(sentinel);
    }
  });
});
