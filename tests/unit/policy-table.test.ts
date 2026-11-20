import { describe, expect, it } from 'vitest';
import { JOB_IDS, type JobId } from '../../src/shared/agent-protocol';
import { TOOL_NAMES, type ToolName } from '../../src/shared/tools';
import { BASE_TOOLS } from '../../src/main/policy/policy-table';
import {
  DEFAULT_POLICY_CONTEXT,
  denyAllCommands,
  effectiveFeature,
} from '../../src/main/policy/context';

const READ_SET: ToolName[] = ['read_file', 'list_files', 'search_text'];

describe('BASE_TOOLS: the design table', () => {
  it('gives the planner the read tools, write and edit, and read_ticket', () => {
    expect([...BASE_TOOLS.planner].sort()).toEqual(
      [...READ_SET, 'write_file', 'edit_file', 'read_ticket'].sort(),
    );
  });

  it('gives the writer the read tools, write and edit, and run_command', () => {
    expect([...BASE_TOOLS.writer].sort()).toEqual(
      [...READ_SET, 'write_file', 'edit_file', 'run_command'].sort(),
    );
  });

  it('gives the reviewer the read tools and run_command only', () => {
    expect([...BASE_TOOLS.reviewer].sort()).toEqual([...READ_SET, 'run_command'].sort());
  });

  it('gives the reader the read tools and read_ticket only', () => {
    expect([...BASE_TOOLS.reader].sort()).toEqual([...READ_SET, 'read_ticket'].sort());
  });

  it('has only registry tool names and no duplicates', () => {
    for (const job of JOB_IDS) {
      const tools = BASE_TOOLS[job];
      expect(new Set(tools).size).toBe(tools.length);
      for (const tool of tools) {
        expect(TOOL_NAMES).toContain(tool);
      }
    }
  });

  it('gives only the planner and the reader read_ticket', () => {
    const holders = JOB_IDS.filter((job) => BASE_TOOLS[job].includes('read_ticket'));
    expect(holders.sort()).toEqual<JobId[]>(['planner', 'reader']);
  });

  it('gives write_file and edit_file only to the planner and the writer', () => {
    for (const tool of ['write_file', 'edit_file'] as const) {
      const holders = JOB_IDS.filter((job) => BASE_TOOLS[job].includes(tool));
      expect(holders.sort()).toEqual<JobId[]>(['planner', 'writer']);
    }
  });

  it('gives run_command only to the writer and the reviewer', () => {
    const holders = JOB_IDS.filter((job) => BASE_TOOLS[job].includes('run_command'));
    expect(holders.sort()).toEqual<JobId[]>(['reviewer', 'writer']);
  });
});

describe('DEFAULT_POLICY_CONTEXT and the command check', () => {
  it('starts with no feature, no spec, no removals and the deny-all command check', () => {
    expect(DEFAULT_POLICY_CONTEXT.feature).toBeNull();
    expect(DEFAULT_POLICY_CONTEXT.spec).toBe('none');
    expect(DEFAULT_POLICY_CONTEXT.tightening).toEqual({ remove: {} });
    expect(DEFAULT_POLICY_CONTEXT.commandCheck).toBe(denyAllCommands);
  });

  it('denies every command with the fixed default reason', () => {
    const result = denyAllCommands({ job: 'writer', program: 'node', args: [] });
    expect(result).toEqual({
      allow: false,
      reason: 'commands are not allowed yet: no allowlist is configured',
    });
  });
});

describe('effectiveFeature: the slug rule', () => {
  it('keeps a valid slug', () => {
    expect(effectiveFeature('p2-policy-engine')).toBe('p2-policy-engine');
    expect(effectiveFeature('a')).toBe('a');
    expect(effectiveFeature('a'.repeat(64))).toBe('a'.repeat(64));
  });

  it('treats anything else as no feature', () => {
    expect(effectiveFeature(null)).toBeNull();
    expect(effectiveFeature('')).toBeNull();
    expect(effectiveFeature('-start')).toBeNull();
    expect(effectiveFeature('Upper')).toBeNull();
    expect(effectiveFeature('a/b')).toBeNull();
    expect(effectiveFeature('a..b')).toBeNull();
    expect(effectiveFeature('a'.repeat(65))).toBeNull();
    expect(effectiveFeature('a b')).toBeNull();
  });
});
