import { describe, expect, it } from 'vitest';
import { jobToolDefinitions } from '../../src/agent/jobs/tools';
import { JOB_IDS, type JobId } from '../../src/shared/agent-protocol';
import { BASE_TOOLS } from '../../src/shared/jobs';
import { TOOL_NAMES, TOOL_SPECS } from '../../src/shared/tools';

describe('jobToolDefinitions: the advertised tools (AC2)', () => {
  it('advertises the planner base set, in table order', () => {
    expect(jobToolDefinitions('planner').map((tool) => tool.name)).toEqual([
      'read_file',
      'list_files',
      'search_text',
      'write_file',
      'edit_file',
      'read_ticket',
    ]);
  });

  it('advertises the writer base set, in table order', () => {
    expect(jobToolDefinitions('writer').map((tool) => tool.name)).toEqual([
      'read_file',
      'list_files',
      'search_text',
      'write_file',
      'edit_file',
      'run_command',
    ]);
  });

  it('advertises the reviewer base set, in table order', () => {
    expect(jobToolDefinitions('reviewer').map((tool) => tool.name)).toEqual([
      'read_file',
      'list_files',
      'search_text',
      'run_command',
    ]);
  });

  it('advertises the reader base set, in table order', () => {
    expect(jobToolDefinitions('reader').map((tool) => tool.name)).toEqual([
      'read_file',
      'list_files',
      'search_text',
      'read_ticket',
    ]);
  });

  it('gives each tool the registry name, description and parameters', () => {
    for (const job of JOB_IDS) {
      const definitions = jobToolDefinitions(job);
      expect(definitions).toHaveLength(BASE_TOOLS[job].length);
      for (const definition of definitions) {
        const spec = TOOL_SPECS[definition.name as keyof typeof TOOL_SPECS];
        expect(definition.name).toBe(spec.name);
        expect(definition.description).toBe(spec.description);
        expect(definition.parameters).toEqual(spec.parameters);
      }
    }
  });

  it('gives the reviewer and the reader no write or edit tool', () => {
    for (const job of ['reviewer', 'reader'] as const) {
      const names = jobToolDefinitions(job).map((tool) => tool.name);
      expect(names).not.toContain('write_file');
      expect(names).not.toContain('edit_file');
    }
  });

  it('never advertises a tool outside the registry', () => {
    for (const job of JOB_IDS) {
      for (const definition of jobToolDefinitions(job)) {
        expect(TOOL_NAMES).toContain(definition.name);
      }
    }
  });

  it('builds fresh definitions on each call, so a caller cannot change the registry', () => {
    const first = jobToolDefinitions('reader');
    const firstTool = first[0];
    if (firstTool === undefined) {
      throw new Error('the reader advertises no tools');
    }
    (firstTool.parameters as { required: string[] }).required.push('extra');
    expect(TOOL_SPECS.read_file.parameters.required).toEqual(['path']);
    expect(jobToolDefinitions('reader')[0]?.parameters.required).toEqual(['path']);
  });

  it('advertises nothing for an unknown job id', () => {
    expect(() => jobToolDefinitions('unknown' as JobId)).toThrow();
  });
});
