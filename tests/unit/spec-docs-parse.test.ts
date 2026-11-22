import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseLedger, parsePlan, parseSpecs, parseTasks } from '../../src/shared/spec-docs';

function fixture(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/${path}`, import.meta.url)), 'utf8');
}

describe('parsePlan (AC3)', () => {
  it('reads the Status value of a present PLAN.md', () => {
    expect(parsePlan('# Plan: x\nStatus: approved\nDate: 2026-11-22\n')).toEqual({
      present: true,
      status: 'approved',
      problems: [],
    });
  });

  it('reports a missing file as absent, with no problems', () => {
    expect(parsePlan(null)).toEqual({ present: false, status: '', problems: [] });
  });

  it('reports a malformed file: no Status line, or an empty one', () => {
    expect(parsePlan('# Plan: x\n').problems).toEqual(['no Status line']);
    const empty = parsePlan('Status:\n');
    expect(empty.present).toBe(true);
    expect(empty.problems).toEqual(['the Status line is empty']);
  });

  it('reads CRLF text and a byte order mark', () => {
    expect(parsePlan('# Plan: x\r\nStatus: draft\r\n').status).toBe('draft');
    expect(parsePlan(String.fromCharCode(0xfeff) + 'Status: approved\n').status).toBe('approved');
  });

  it('takes the first Status line', () => {
    expect(parsePlan('Status: draft\nStatus: approved\n').status).toBe('draft');
  });

  it('reads the plugin template as draft', () => {
    const template = fixture('sdd-plugin/templates/PLAN.md');
    expect(parsePlan(template)).toEqual({ present: true, status: 'draft', problems: [] });
  });
});

describe('parseSpecs (AC3)', () => {
  it('reads status and ticket from the frontmatter', () => {
    expect(parseSpecs('---\nstatus: done\nticket: ABC-1\n---\n\n# x\n')).toEqual({
      present: true,
      status: 'done',
      ticket: 'ABC-1',
      problems: [],
    });
  });

  it('gives an empty ticket when the line is empty, which is not a problem', () => {
    const parsed = parseSpecs('---\nstatus: draft\nticket:\n---\n');
    expect(parsed.ticket).toBe('');
    expect(parsed.problems).toEqual([]);
  });

  it('reports a missing file as absent', () => {
    expect(parseSpecs(null)).toEqual({ present: false, status: '', ticket: '', problems: [] });
  });

  it('reports a file with no frontmatter', () => {
    expect(parseSpecs('# x\n').problems).toEqual(['no frontmatter']);
  });

  it('reports unterminated frontmatter', () => {
    expect(parseSpecs('---\nstatus: draft\n# x\n').problems).toEqual(['unterminated frontmatter']);
  });

  it('reports a frontmatter with no status line', () => {
    expect(parseSpecs('---\nticket: x\n---\n').problems).toEqual(['no status in the frontmatter']);
  });

  it('reads CRLF text', () => {
    const parsed = parseSpecs('---\r\nstatus: done\r\nticket: T-2\r\n---\r\n# x\r\n');
    expect(parsed.status).toBe('done');
    expect(parsed.ticket).toBe('T-2');
    expect(parsed.problems).toEqual([]);
  });

  it('reads the plugin template as draft with no ticket', () => {
    expect(parseSpecs(fixture('sdd-plugin/templates/SPECS.md'))).toEqual({
      present: true,
      status: 'draft',
      ticket: '',
      problems: [],
    });
  });
});

describe('parseTasks (AC3)', () => {
  it('counts checked and open boxes the plugin way', () => {
    const text = '- [x] one\n- [ ] two\n  - [X] three\n- [ ] four\n';
    expect(parseTasks(text)).toEqual({ present: true, checked: 2, open: 2, problems: [] });
  });

  it('reports a missing file as absent', () => {
    expect(parseTasks(null)).toEqual({ present: false, checked: 0, open: 0, problems: [] });
  });

  it('reports a file with no checkbox lines', () => {
    expect(parseTasks('# Tasks\n\nnone yet\n').problems).toEqual(['no checkbox lines']);
  });

  it('counts CRLF text', () => {
    expect(parseTasks('- [x] a\r\n- [ ] b\r\n').checked).toBe(1);
  });
});

describe('parseLedger (AC3)', () => {
  it('reads every field of a finished ledger', () => {
    const ledger = `state: running
revision: 2
resume on approve: yes
current round: 3 of 3, in revision 2
phase: reviewing
`;
    expect(parseLedger(ledger)).toEqual({
      present: true,
      state: 'running',
      revision: 2,
      resumeOnApprove: true,
      currentRound: 3,
      phase: 'reviewing',
      problems: [],
    });
  });

  it('reads the vendored p3-state-machine ledger with no problems', () => {
    const parsed = parseLedger(fixture('sdd-plugin/specs/p3-state-machine/build-ledger.md'));
    expect(parsed.state).toBe('done');
    expect(parsed.revision).toBe(1);
    expect(parsed.currentRound).toBe(1);
    expect(parsed.phase).toBe('reviewing');
    expect(parsed.resumeOnApprove).toBe(false);
    expect(parsed.problems).toEqual([]);
  });

  it('reads an empty phase as the empty string, with no problem', () => {
    const parsed = parseLedger('state: running\nphase:\n');
    expect(parsed.phase).toBe('');
    expect(parsed.problems).toEqual([]);
  });

  it('reports a missing file as absent', () => {
    expect(parseLedger(null)).toEqual({
      present: false,
      state: '',
      revision: null,
      resumeOnApprove: false,
      currentRound: null,
      phase: '',
      problems: [],
    });
  });

  it('reports a non-numeric revision and reads it as null', () => {
    const parsed = parseLedger('state: done\nrevision: x\n');
    expect(parsed.revision).toBeNull();
    expect(parsed.problems).toEqual(['the revision is not a number']);
  });

  it('reports an unknown phase word and reads it as empty', () => {
    const parsed = parseLedger('state: running\nphase: testing\n');
    expect(parsed.phase).toBe('');
    expect(parsed.problems).toEqual(['the phase is not implementing or reviewing']);
  });

  it('reports a resume value that is not yes or no', () => {
    const parsed = parseLedger('state: done\nresume on approve: maybe\n');
    expect(parsed.resumeOnApprove).toBe(false);
    expect(parsed.problems).toEqual(['resume on approve is not yes or no']);
  });

  it('reports a missing state line', () => {
    const parsed = parseLedger('revision: 1\n');
    expect(parsed.state).toBe('');
    expect(parsed.problems).toEqual(['no state line']);
  });

  it('reads CRLF text', () => {
    const parsed = parseLedger('state: paused-for-revision\r\nphase: implementing\r\n');
    expect(parsed.state).toBe('paused-for-revision');
    expect(parsed.phase).toBe('implementing');
    expect(parsed.problems).toEqual([]);
  });
});

describe('the parsers never throw (AC3)', () => {
  const odd = [
    '',
    '\n',
    '---',
    '---\n---\n',
    'Status:',
    '- [',
    'state:',
    'revision:\n',
    String.fromCharCode(0xfeff),
    '\r\r\n',
  ];

  it('accept odd text and null without throwing', () => {
    for (const text of [...odd, null]) {
      expect(() => parsePlan(text)).not.toThrow();
      expect(() => parseSpecs(text)).not.toThrow();
      expect(() => parseTasks(text)).not.toThrow();
      expect(() => parseLedger(text)).not.toThrow();
    }
  });
});
