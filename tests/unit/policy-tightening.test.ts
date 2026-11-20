import { describe, expect, it } from 'vitest';
import { JOB_IDS, type JobId } from '../../src/shared/agent-protocol';
import { TOOL_NAMES, type ToolName } from '../../src/shared/tools';
import { BASE_TOOLS } from '../../src/main/policy/policy-table';
import { effectiveTools, parseTightening, type Tightening } from '../../src/main/policy/tightening';

const SENTINEL = 'SENTINEL-TIGHTENING-9f3a';

describe('parseTightening: accepted shapes', () => {
  it('accepts an empty object, which removes nothing', () => {
    expect(parseTightening({})).toEqual({ ok: true, tightening: { remove: {} } });
  });

  it('accepts a removal of a tool from a job', () => {
    expect(parseTightening({ remove: { writer: ['run_command'] } })).toEqual({
      ok: true,
      tightening: { remove: { writer: ['run_command'] } },
    });
  });

  it('accepts an empty removal list for a job', () => {
    expect(parseTightening({ remove: { reviewer: [] } })).toEqual({
      ok: true,
      tightening: { remove: { reviewer: [] } },
    });
  });
});

describe('parseTightening: refused shapes', () => {
  const refusedInputs: Array<[string, unknown]> = [
    ['an add key', { add: { reviewer: ['write_file'] } }],
    ['an allow key', { allow: { reviewer: ['write_file'] } }],
    ['a remove plus another key', { remove: { writer: ['run_command'] }, add: {} }],
    ['a remove that is a string', { remove: { reviewer: 'write_file' } }],
    ['a remove that is null', { remove: null }],
    ['a remove that is an array', { remove: [] }],
    ['an unknown job', { remove: { approver: ['run_command'] } }],
    ['an unknown tool', { remove: { writer: ['delete_file'] } }],
    ['a non-string tool', { remove: { writer: [7] } }],
    ['a non-array job value', { remove: { writer: { 0: 'run_command' } } }],
    ['a non-object', 'write_file'],
    ['null', null],
    ['an array', ['remove']],
    ['a number', 42],
  ];

  it.each(refusedInputs)('refuses %s', (_name, input) => {
    expect(parseTightening(input).ok).toBe(false);
  });

  it('refuses with one fixed reason that contains none of the input values', () => {
    const inputs: unknown[] = [
      { add: { [SENTINEL]: ['write_file'] } },
      { allow: SENTINEL },
      { remove: { reviewer: SENTINEL } },
      { remove: { [SENTINEL]: ['run_command'] } },
      { remove: { writer: [SENTINEL] } },
      SENTINEL,
    ];
    const reasons = new Set<string>();
    for (const input of inputs) {
      const result = parseTightening(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        reasons.add(result.reason);
        expect(result.reason).not.toContain(SENTINEL);
        expect(result.reason).not.toContain('write_file');
        expect(result.reason).not.toContain('reviewer');
      }
    }
    expect(reasons.size).toBe(1);
  });
});

describe('effectiveTools', () => {
  it('returns the base set when nothing is removed', () => {
    for (const job of JOB_IDS) {
      expect([...effectiveTools(job, { remove: {} })]).toEqual([...BASE_TOOLS[job]]);
    }
  });

  it('drops a removed tool for that job only', () => {
    const tightening: Tightening = { remove: { writer: ['run_command'] } };
    expect(effectiveTools('writer', tightening)).not.toContain('run_command');
    expect(effectiveTools('reviewer', tightening)).toContain('run_command');
  });

  it('never returns a tool outside the base set, for every job and tool', () => {
    for (const job of JOB_IDS) {
      for (const tool of TOOL_NAMES) {
        const tightening: Tightening = { remove: { [job]: [tool] } };
        const tools = effectiveTools(job, tightening);
        for (const allowed of tools) {
          expect(BASE_TOOLS[job]).toContain(allowed);
        }
      }
    }
  });

  it('never adds a tool, even when the object carries add or allow keys or removes tools a job lacks', () => {
    const hostile = {
      remove: { reader: ['write_file' as ToolName], planner: ['run_command' as ToolName] },
      add: { reviewer: ['write_file'] },
      allow: { reviewer: ['write_file'], reader: ['run_command'] },
    } as unknown as Tightening;
    for (const job of JOB_IDS) {
      const tools = effectiveTools(job, hostile);
      for (const tool of TOOL_NAMES) {
        if (tools.includes(tool)) {
          expect(BASE_TOOLS[job]).toContain(tool);
        }
      }
    }
    expect(effectiveTools('reviewer', hostile)).not.toContain('write_file');
    expect(effectiveTools('reader', hostile)).not.toContain('run_command');
  });

  it('gives each job the same set through every removal, for every job and tool pair', () => {
    for (const job of JOB_IDS as readonly JobId[]) {
      for (const tool of TOOL_NAMES) {
        const tools = effectiveTools(job, { remove: { [job]: [tool] } });
        expect(tools).toEqual(BASE_TOOLS[job].filter((name) => name !== tool));
      }
    }
  });
});
