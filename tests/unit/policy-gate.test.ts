import { describe, expect, it } from 'vitest';
import type { JobId } from '../../src/shared/agent-protocol';
import { checkToolCall } from '../../src/main/policy/gate';

const JOBS: JobId[] = ['planner', 'writer', 'reviewer', 'reader'];
const TOOLS = ['write_file', 'read_file', 'run_command', 'list_dir', 'delete_file', 'x'];

describe('checkToolCall', () => {
  it('denies every job with a non-empty reason', () => {
    for (const job of JOBS) {
      const decision = checkToolCall({ job, tool: 'write_file', args: {} });
      expect(decision.allow).toBe(false);
      if (!decision.allow) {
        expect(decision.reason.length).toBeGreaterThan(0);
      }
    }
  });

  it('denies several tool names for every job', () => {
    for (const job of JOBS) {
      for (const tool of TOOLS) {
        const decision = checkToolCall({ job, tool, args: { path: 'a.txt' } });
        expect(decision).toEqual({
          allow: false,
          reason: 'no tools are allowed yet (policy table arrives in Phase 2)',
        });
      }
    }
  });

  it('denies regardless of the arguments', () => {
    expect(checkToolCall({ job: 'writer', tool: 'write_file', args: {} }).allow).toBe(false);
    expect(
      checkToolCall({ job: 'writer', tool: 'write_file', args: { content: 'x'.repeat(10_000) } })
        .allow,
    ).toBe(false);
  });
});
