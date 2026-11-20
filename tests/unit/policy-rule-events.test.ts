import { describe, expect, it, vi } from 'vitest';
import {
  makeNetworkEvent,
  makeRevertEvent,
  makeRuleEvent,
  formatRuleEvent,
  logRuleEvent,
  REVERT_REASON,
  sanitizeTarget,
  type RuleEvent,
} from '../../src/main/policy/rule-event';

const SENTINEL_CONTENT = 'SENTINEL-CONTENT-7a1';
const SENTINEL_NEW = 'SENTINEL-NEWTEXT-7a2';
const SENTINEL_ARGS = 'SENTINEL-ARGS-7a3';

describe('makeRuleEvent: fields', () => {
  it('uses the path for read_file, write_file and edit_file', () => {
    expect(
      makeRuleEvent(
        { job: 'writer', tool: 'write_file', args: { path: 'src/a.ts', content: 'x' } },
        false,
        'r',
      ),
    ).toEqual({
      kind: 'rule',
      decision: 'deny',
      job: 'writer',
      tool: 'write_file',
      target: 'src/a.ts',
      reason: 'r',
    });
    expect(
      makeRuleEvent({ job: 'reader', tool: 'read_file', args: { path: 'n.txt' } }, true, 'allowed')
        .target,
    ).toBe('n.txt');
    expect(
      makeRuleEvent(
        { job: 'writer', tool: 'edit_file', args: { path: 'e.txt', old_text: 'a', new_text: 'b' } },
        true,
        'allowed',
      ).target,
    ).toBe('e.txt');
  });

  it('uses the path, or ., for list_files and search_text', () => {
    expect(
      makeRuleEvent({ job: 'reader', tool: 'list_files', args: {} }, true, 'allowed').target,
    ).toBe('.');
    expect(
      makeRuleEvent({ job: 'reader', tool: 'list_files', args: { path: 'src' } }, true, 'allowed')
        .target,
    ).toBe('src');
    expect(
      makeRuleEvent({ job: 'reader', tool: 'search_text', args: { pattern: 'x' } }, true, 'allowed')
        .target,
    ).toBe('.');
    expect(
      makeRuleEvent(
        { job: 'reader', tool: 'search_text', args: { pattern: 'x', path: 'docs' } },
        true,
        'allowed',
      ).target,
    ).toBe('docs');
  });

  it('uses the program for run_command and the id for read_ticket', () => {
    expect(
      makeRuleEvent(
        { job: 'writer', tool: 'run_command', args: { program: 'node', args: ['-v'] } },
        false,
        'r',
      ).target,
    ).toBe('node');
    expect(
      makeRuleEvent({ job: 'reader', tool: 'read_ticket', args: { id: 'T-9' } }, true, 'allowed')
        .target,
    ).toBe('T-9');
  });

  it('gives - as the target and tool when the tool is unknown', () => {
    const event = makeRuleEvent(
      { job: 'reader', tool: 'delete_file', args: { path: 'a.txt' } },
      false,
      'r',
    );
    expect(event.tool).toBe('-');
    expect(event.target).toBe('-');
  });

  it('gives - as the target when the arguments fail the guard', () => {
    const event = makeRuleEvent(
      { job: 'writer', tool: 'write_file', args: { path: 'a.txt' } },
      false,
      'r',
    );
    expect(event.tool).toBe('write_file');
    expect(event.target).toBe('-');
  });

  it('sets decision to allow or deny', () => {
    expect(
      makeRuleEvent({ job: 'reader', tool: 'read_file', args: { path: 'a' } }, true, 'allowed')
        .decision,
    ).toBe('allow');
    expect(
      makeRuleEvent({ job: 'reader', tool: 'read_file', args: { path: 'a' } }, false, 'r').decision,
    ).toBe('deny');
  });
});

describe('makeRuleEvent: no argument value other than the target', () => {
  it('keeps sentinel content, new_text and args values out of the event', () => {
    const event = makeRuleEvent(
      {
        job: 'writer',
        tool: 'edit_file',
        args: { path: 'docs/x.md', old_text: SENTINEL_CONTENT, new_text: SENTINEL_NEW },
      },
      false,
      'not allowed: the spec is approved; spec files are read-only',
    );
    const text = JSON.stringify(event) + formatRuleEvent(event);
    expect(text).not.toContain(SENTINEL_CONTENT);
    expect(text).not.toContain(SENTINEL_NEW);
    expect(event.target).toBe('docs/x.md');
  });

  it('keeps an extra argument value out of the event, which then has target -', () => {
    const event = makeRuleEvent(
      { job: 'writer', tool: 'edit_file', args: { path: 'a.txt', extra: SENTINEL_ARGS } },
      false,
      'not allowed: the arguments are not valid for this tool',
    );
    expect(JSON.stringify(event)).not.toContain(SENTINEL_ARGS);
    expect(event.target).toBe('-');
  });

  it('keeps sentinel content out of a write_file event', () => {
    const event = makeRuleEvent(
      {
        job: 'planner',
        tool: 'write_file',
        args: { path: 'docs/specs/f/SPECS.md', content: SENTINEL_CONTENT },
      },
      true,
      'allowed',
    );
    expect(JSON.stringify(event)).not.toContain(SENTINEL_CONTENT);
  });
});

describe('sanitizeTarget', () => {
  it('escapes control characters as \\uXXXX', () => {
    expect(sanitizeTarget('a\u0001b')).toBe('a\\u0001b');
    expect(sanitizeTarget('a\nb')).toBe('a\\u000ab');
    expect(sanitizeTarget('a\tb')).toBe('a\\u0009b');
    expect(sanitizeTarget('a\u007fb')).toBe('a\\u007fb');
  });

  it('leaves ordinary and non-ASCII text alone', () => {
    expect(sanitizeTarget('docs/specs/f/SPECS.md')).toBe('docs/specs/f/SPECS.md');
    expect(sanitizeTarget('café.txt')).toBe('café.txt');
  });

  it('cuts a 500-character target to 200 characters plus an ellipsis', () => {
    const cut = sanitizeTarget('a'.repeat(500));
    expect(cut).toBe('a'.repeat(200) + '…');
  });

  it('keeps a 200-character target whole', () => {
    expect(sanitizeTarget('b'.repeat(200))).toBe('b'.repeat(200));
  });

  it('does not split a character outside the BMP when it cuts', () => {
    const cut = sanitizeTarget('😀'.repeat(300));
    expect(cut).toBe('😀'.repeat(200) + '…');
  });

  it('sanitizes the target inside a rule event', () => {
    const event = makeRuleEvent(
      { job: 'reader', tool: 'read_file', args: { path: 'bad\u0000name\u001b' } },
      true,
      'allowed',
    );
    expect(event.target).toBe('bad\\u0000name\\u001b');
  });

  it('cuts a long target inside a rule event', () => {
    const event = makeRuleEvent(
      { job: 'reader', tool: 'read_file', args: { path: 'p'.repeat(500) } },
      true,
      'allowed',
    );
    expect(event.target).toBe('p'.repeat(200) + '…');
  });
});

describe('formatRuleEvent and logRuleEvent', () => {
  it('formats an allow as rule allowed and a deny as rule blocked', () => {
    const allow = makeRuleEvent(
      { job: 'reader', tool: 'read_file', args: { path: 'n.txt' } },
      true,
      'allowed',
    );
    expect(formatRuleEvent(allow)).toBe(
      'rule allowed: job=reader tool=read_file target=n.txt reason=allowed',
    );
    const deny = makeRuleEvent(
      { job: 'reviewer', tool: 'write_file', args: { path: 'a.txt', content: 'x' } },
      false,
      'not allowed: x',
    );
    expect(formatRuleEvent(deny)).toBe(
      'rule blocked: job=reviewer tool=write_file target=a.txt reason=not allowed: x',
    );
  });

  it('logs an allow with info and a deny with error, in the formatted line', () => {
    const info = vi.fn<(message: string) => void>();
    const error = vi.fn<(message: string) => void>();
    const warn = vi.fn<(message: string) => void>();
    const sink = logRuleEvent({ info, error, warn });
    const allow = makeRuleEvent(
      { job: 'reader', tool: 'read_file', args: { path: 'n.txt' } },
      true,
      'allowed',
    );
    const deny = makeRuleEvent(
      { job: 'reader', tool: 'write_file', args: { path: 'n.txt', content: 'x' } },
      false,
      'not allowed: y',
    );
    sink(allow);
    sink(deny);
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(formatRuleEvent(allow));
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(formatRuleEvent(deny));
  });

  it('logs no argument value through the sink', () => {
    const info = vi.fn<(message: string) => void>();
    const error = vi.fn<(message: string) => void>();
    const warn = vi.fn<(message: string) => void>();
    const sink = logRuleEvent({ info, error, warn });
    sink(
      makeRuleEvent(
        {
          job: 'writer',
          tool: 'edit_file',
          args: { path: 'a.txt', old_text: SENTINEL_CONTENT, new_text: SENTINEL_NEW },
        },
        false,
        'not allowed: spec files are read-only',
      ),
    );
    const logged = String(error.mock.calls[0]?.[0]);
    expect(logged).not.toContain(SENTINEL_CONTENT);
    expect(logged).not.toContain(SENTINEL_NEW);
  });
});

describe('revert events (D31)', () => {
  it('builds the revert event with the job, the path, the action and the fixed reason', () => {
    expect(makeRevertEvent('writer', 'docs/specs/f/SPECS.md', 'restored')).toEqual({
      kind: 'revert',
      job: 'writer',
      tool: 'run_command',
      target: 'docs/specs/f/SPECS.md',
      action: 'restored',
      reason: 'a command changed a protected file',
    });
    expect(REVERT_REASON).toBe('a command changed a protected file');
  });

  it('sanitizes and cuts the path like any other target', () => {
    const event = makeRevertEvent('reviewer', `bad\u0001${'p'.repeat(300)}`, 'deleted');
    expect(event.target).toBe(`bad\\u0001${'p'.repeat(191)}…`);
  });

  it('formats a revert as rule reverted, with the action', () => {
    const event = makeRevertEvent('writer', '.git/HEAD', 're-created');
    expect(formatRuleEvent(event)).toBe(
      'rule reverted: job=writer tool=run_command target=.git/HEAD action=re-created reason=a command changed a protected file',
    );
  });

  it('logs a revert with error', () => {
    const info = vi.fn<(message: string) => void>();
    const error = vi.fn<(message: string) => void>();
    const warn = vi.fn<(message: string) => void>();
    logRuleEvent({ info, error, warn })(makeRevertEvent('writer', 'src/a.ts', 'restored'));
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[0]).toMatch(/^rule reverted: /);
    expect(info).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps the content of a changed file out of the revert event', () => {
    const event = makeRevertEvent('writer', 'docs/specs/f/SPECS.md', 'restored');
    expect(JSON.stringify(event) + formatRuleEvent(event)).not.toContain(SENTINEL_CONTENT);
  });
});

describe('network events (D31)', () => {
  it('builds the network event for a writer command, with the program and the level', () => {
    expect(makeNetworkEvent('node', 'os')).toEqual({
      kind: 'network',
      job: 'writer',
      tool: 'run_command',
      target: 'node',
      level: 'os',
    });
  });

  it('formats a network event as rule network, with the level', () => {
    expect(formatRuleEvent(makeNetworkEvent('pnpm', 'proxy-only'))).toBe(
      'rule network: job=writer tool=run_command target=pnpm level=proxy-only',
    );
  });

  it('logs an OS-level network event with info and a proxy-only one with warn', () => {
    const info = vi.fn<(message: string) => void>();
    const error = vi.fn<(message: string) => void>();
    const warn = vi.fn<(message: string) => void>();
    const sink = logRuleEvent({ info, error, warn });
    sink(makeNetworkEvent('node', 'os'));
    sink(makeNetworkEvent('node', 'proxy-only'));
    expect(info).toHaveBeenCalledWith(
      'rule network: job=writer tool=run_command target=node level=os',
    );
    expect(warn).toHaveBeenCalledWith(
      'rule network: job=writer tool=run_command target=node level=proxy-only',
    );
    expect(error).not.toHaveBeenCalled();
  });

  it('sanitizes the program in a network event', () => {
    expect(makeNetworkEvent('no\nde', 'os').target).toBe('no\\u000ade');
  });
});

describe('RuleEvent union', () => {
  it('keeps the decision events as they were: kind rule, with decision and job', () => {
    const event: RuleEvent = makeRuleEvent(
      { job: 'reader', tool: 'read_file', args: { path: 'a' } },
      true,
      'allowed',
    );
    expect(event.kind).toBe('rule');
    if (event.kind === 'rule') expect(event.decision).toBe('allow');
  });
});
