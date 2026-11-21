import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { JOB_IDS } from '../../src/shared/agent-protocol';
import { BASE_TOOLS, JOBS } from '../../src/shared/jobs';
import { BASE_TOOLS as POLICY_BASE_TOOLS } from '../../src/main/policy/policy-table';

describe('JOBS: the plain-language names (AC1)', () => {
  it('has one entry per job id, with the plain name from the design', () => {
    expect(Object.keys(JOBS).sort()).toEqual([...JOB_IDS].sort());
    expect(JOBS.planner.name).toBe('plans and chats');
    expect(JOBS.writer.name).toBe('writes code');
    expect(JOBS.reviewer.name).toBe('reviews code');
    expect(JOBS.reader.name).toBe('reads big files');
  });
});

describe('BASE_TOOLS: the shared table (AC1)', () => {
  it('keeps the contents and order of the design table', () => {
    expect(BASE_TOOLS).toEqual({
      planner: ['read_file', 'list_files', 'search_text', 'write_file', 'edit_file', 'read_ticket'],
      writer: ['read_file', 'list_files', 'search_text', 'write_file', 'edit_file', 'run_command'],
      reviewer: ['read_file', 'list_files', 'search_text', 'run_command'],
      reader: ['read_file', 'list_files', 'search_text', 'read_ticket'],
    });
  });

  it('is the same object that the policy table re-exports', () => {
    expect(POLICY_BASE_TOOLS).toBe(BASE_TOOLS);
  });

  it('imports nothing outside src/shared (no Node, Electron or DOM API)', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../src/shared/jobs.ts', import.meta.url)),
      'utf8',
    );
    const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(specifier?.startsWith('./')).toBe(true);
    }
  });
});
