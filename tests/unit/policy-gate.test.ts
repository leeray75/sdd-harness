import { describe, expect, it } from 'vitest';
import type { JobId } from '../../src/shared/agent-protocol';
import { checkToolCall } from '../../src/main/policy/gate';

const JOBS: JobId[] = ['planner', 'writer', 'reviewer', 'reader'];
const OTHER_JOBS: JobId[] = ['planner', 'writer', 'reviewer'];
const TOOLS = ['write_file', 'run_command', 'list_dir', 'delete_file', 'read_file_x', 'x'];

function expectDenied(decision: ReturnType<typeof checkToolCall>): void {
  expect(decision.allow).toBe(false);
  if (!decision.allow) {
    expect(decision.reason.length).toBeGreaterThan(0);
  }
}

describe('checkToolCall: the allow case', () => {
  it('allows reader calling read_file with args exactly { path: string }', () => {
    expect(
      checkToolCall({ job: 'reader', tool: 'read_file', args: { path: 'notes.txt' } }),
    ).toEqual({ allow: true });
    expect(checkToolCall({ job: 'reader', tool: 'read_file', args: { path: '' } })).toEqual({
      allow: true,
    });
  });
});

describe('checkToolCall: other jobs', () => {
  it('denies read_file for every job except reader, with a non-empty reason', () => {
    for (const job of OTHER_JOBS) {
      expectDenied(checkToolCall({ job, tool: 'read_file', args: { path: 'a.txt' } }));
    }
  });

  it('denies every job and tool pair except reader with read_file', () => {
    for (const job of JOBS) {
      for (const tool of TOOLS) {
        expectDenied(checkToolCall({ job, tool, args: { path: 'a.txt' } }));
      }
    }
  });
});

describe('checkToolCall: other tools and argument shapes', () => {
  it('denies reader calling any tool other than read_file', () => {
    for (const tool of TOOLS) {
      expectDenied(checkToolCall({ job: 'reader', tool, args: { path: 'a.txt' } }));
    }
  });

  it('denies read_file with extra args', () => {
    expectDenied(
      checkToolCall({ job: 'reader', tool: 'read_file', args: { path: 'a.txt', mode: 'raw' } }),
    );
  });

  it('denies read_file with missing args', () => {
    expectDenied(checkToolCall({ job: 'reader', tool: 'read_file', args: {} }));
  });

  it('denies read_file when path is not a string', () => {
    expectDenied(checkToolCall({ job: 'reader', tool: 'read_file', args: { path: 7 } }));
    expectDenied(checkToolCall({ job: 'reader', tool: 'read_file', args: { path: null } }));
    expectDenied(checkToolCall({ job: 'reader', tool: 'read_file', args: { path: ['a.txt'] } }));
  });

  it('denies read_file args with a different key name', () => {
    expectDenied(checkToolCall({ job: 'reader', tool: 'read_file', args: { file: 'a.txt' } }));
  });
});

describe('checkToolCall: reasons', () => {
  it('gives a reason that does not echo the tool name or the arguments', () => {
    const decision = checkToolCall({
      job: 'reader',
      tool: 'SECRET-TOOL',
      args: { path: 'SECRET-PATH' },
    });
    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      expect(decision.reason).not.toContain('SECRET-TOOL');
      expect(decision.reason).not.toContain('SECRET-PATH');
    }
  });
});
