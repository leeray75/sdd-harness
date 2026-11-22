import { describe, expect, it, vi } from 'vitest';
import { JOB_IDS, type JobId } from '../../src/shared/agent-protocol';
import { TOOL_NAMES, type ToolName } from '../../src/shared/tools';
import { checkToolCall, type PolicyDecision } from '../../src/main/policy/gate';
import {
  DEFAULT_POLICY_CONTEXT,
  denyAllCommands,
  type CommandCall,
  type CommandCheck,
  type PolicyContext,
  type SpecState,
  effectiveFeature,
  specStateOf,
} from '../../src/main/policy/context';
import { BASE_TOOLS } from '../../src/main/policy/policy-table';
import { makeCommandCheck } from '../../src/main/policy/command-allowlist';

const SPEC_STATES: SpecState[] = ['none', 'draft', 'approved'];
const FEATURES: Array<string | null> = [null, 'f'];

/** Valid arguments for each registry tool. */
const SAMPLE_ARGS: Record<ToolName, Record<string, unknown>> = {
  read_file: { path: 'a.txt' },
  list_files: {},
  search_text: { pattern: 'x' },
  write_file: { path: 'src/a.ts', content: 'x' },
  edit_file: { path: 'src/a.ts', old_text: 'a', new_text: 'b' },
  run_command: { program: 'node', args: ['-v'] },
  read_ticket: { id: 'T-1' },
};

const allowAll: CommandCheck = () => ({ allow: true });

function context(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return { ...DEFAULT_POLICY_CONTEXT, ...overrides };
}

function call(
  job: JobId,
  tool: string,
  args: Record<string, unknown>,
  ctx: PolicyContext = DEFAULT_POLICY_CONTEXT,
): PolicyDecision {
  return checkToolCall({ job, tool, args }, ctx);
}

function reasonOf(decision: PolicyDecision): string {
  expect(decision.allow).toBe(false);
  return decision.reason;
}

function expectAllowed(decision: PolicyDecision): void {
  expect(decision.allow).toBe(true);
  expect(decision.reason).toBe('allowed');
}

const PLANNER_SCOPE =
  "not allowed: the planner can write only PLAN.md, SPECS.md, tasks.md and SUBTASK.md in the current feature's spec folder";

describe('checkToolCall: step 1 and step 2 (name and base set)', () => {
  it('denies a name that is not in the registry, with the fixed reason', () => {
    const decision = call('reader', 'SECRET-TOOL', { path: 'a.txt' });
    expect(reasonOf(decision)).toBe('not allowed: no such tool');
    expect(decision.event.tool).toBe('-');
  });

  it('denies a tool outside the job base set with the job and tool names', () => {
    expect(reasonOf(call('reviewer', 'write_file', SAMPLE_ARGS.write_file))).toBe(
      'not allowed: the reviewer job has no write_file tool',
    );
    expect(reasonOf(call('reader', 'run_command', SAMPLE_ARGS.run_command))).toBe(
      'not allowed: the reader job has no run_command tool',
    );
  });
});

describe('checkToolCall: AC1 the table holds under every context', () => {
  const contexts: PolicyContext[] = [];
  for (const spec of SPEC_STATES) {
    for (const feature of FEATURES) {
      contexts.push(context({ spec, feature }));
      contexts.push(context({ spec, feature, commandCheck: allowAll }));
      contexts.push(
        context({ spec, feature, tightening: { remove: { writer: ['run_command'] } } }),
      );
    }
  }

  it('denies the reviewer and the reader write_file and edit_file at step 2, in every context', () => {
    for (const ctx of contexts) {
      for (const job of ['reviewer', 'reader'] as const) {
        for (const tool of ['write_file', 'edit_file'] as const) {
          expect(reasonOf(call(job, tool, SAMPLE_ARGS[tool], ctx))).toBe(
            `not allowed: the ${job} job has no ${tool} tool`,
          );
        }
      }
    }
  });

  it('gives read_ticket only to the planner and the reader', () => {
    for (const ctx of contexts) {
      for (const job of ['writer', 'reviewer'] as const) {
        expect(reasonOf(call(job, 'read_ticket', SAMPLE_ARGS.read_ticket, ctx))).toBe(
          `not allowed: the ${job} job has no read_ticket tool`,
        );
      }
      expect(call('planner', 'read_ticket', SAMPLE_ARGS.read_ticket, ctx).reason).not.toMatch(
        /has no read_ticket/,
      );
      expect(call('reader', 'read_ticket', SAMPLE_ARGS.read_ticket, ctx).reason).not.toMatch(
        /has no read_ticket/,
      );
    }
  });

  it('sends only the writer and the reviewer to the command check', () => {
    for (const ctx of contexts) {
      for (const job of JOB_IDS) {
        const check = vi.fn<CommandCheck>(() => ({ allow: true }));
        const decision = call(job, 'run_command', SAMPLE_ARGS.run_command, {
          ...ctx,
          commandCheck: check,
        });
        if (job === 'writer' || job === 'reviewer') {
          if (ctx.tightening.remove[job]?.includes('run_command')) {
            expect(reasonOf(decision)).toBe(
              `not allowed: this project removed run_command from the ${job} job`,
            );
            expect(check).not.toHaveBeenCalled();
          } else {
            expect(check).toHaveBeenCalledTimes(1);
          }
        } else {
          expect(check).not.toHaveBeenCalled();
          expect(reasonOf(decision)).toBe(`not allowed: the ${job} job has no run_command tool`);
        }
      }
    }
  });
});

describe('checkToolCall: AC3 the planner', () => {
  const ctx = (spec: SpecState, feature: string | null = 'f') => context({ spec, feature });
  const PLANNING_DOCS = [
    'docs/specs/f/PLAN.md',
    'docs/specs/f/SPECS.md',
    'Docs/Specs/F/tasks.md',
    'docs/specs/f/SUBTASK.md',
  ];

  it('allows write_file and edit_file of the four planning docs while the spec is none or draft', () => {
    for (const spec of ['none', 'draft'] as const) {
      for (const path of PLANNING_DOCS) {
        expectAllowed(call('planner', 'write_file', { path, content: 'x' }, ctx(spec)));
        expectAllowed(
          call('planner', 'edit_file', { path, old_text: 'a', new_text: 'b' }, ctx(spec)),
        );
      }
    }
  });

  it('denies the same files once the spec is approved, with the approved reason', () => {
    for (const path of PLANNING_DOCS) {
      expect(reasonOf(call('planner', 'write_file', { path, content: 'x' }, ctx('approved')))).toBe(
        'not allowed: the spec is approved; spec files are read-only',
      );
    }
  });

  it('denies the files of another feature', () => {
    expect(
      reasonOf(
        call(
          'planner',
          'write_file',
          { path: 'docs/specs/g/SPECS.md', content: 'x' },
          ctx('draft'),
        ),
      ),
    ).toBe(PLANNER_SCOPE);
  });

  it('denies state.json, build-ledger.md and SUMMARY.md in the feature folder', () => {
    for (const path of [
      'docs/specs/f/state.json',
      'docs/specs/f/build-ledger.md',
      'docs/specs/f/SUMMARY.md',
    ]) {
      expect(reasonOf(call('planner', 'write_file', { path, content: 'x' }, ctx('draft')))).toBe(
        PLANNER_SCOPE,
      );
    }
  });

  it('denies any source path', () => {
    expect(
      reasonOf(call('planner', 'write_file', { path: 'src/a.ts', content: 'x' }, ctx('draft'))),
    ).toBe(PLANNER_SCOPE);
  });

  it('denies every write when there is no feature, with the no-feature reason', () => {
    for (const path of ['docs/specs/f/SPECS.md', 'src/a.ts']) {
      expect(
        reasonOf(call('planner', 'write_file', { path, content: 'x' }, ctx('none', null))),
      ).toBe("not allowed: no feature is open, so the planner can't write");
    }
  });

  it('treats an invalid feature slug as no feature', () => {
    expect(
      reasonOf(
        call(
          'planner',
          'write_file',
          { path: 'docs/specs/F/SPECS.md', content: 'x' },
          ctx('draft', 'F'),
        ),
      ),
    ).toBe("not allowed: no feature is open, so the planner can't write");
  });
});

describe('checkToolCall: AC4 the writer', () => {
  const ctx = (spec: SpecState) => context({ spec, feature: 'f' });

  it('allows write_file and edit_file of source paths once the spec is approved', () => {
    expectAllowed(
      call('writer', 'write_file', { path: 'src/a.ts', content: 'x' }, ctx('approved')),
    );
    expectAllowed(
      call(
        'writer',
        'edit_file',
        { path: 'src/a.ts', old_text: 'a', new_text: 'b' },
        ctx('approved'),
      ),
    );
  });

  it('denies every source path while the spec is none or draft', () => {
    for (const spec of ['none', 'draft'] as const) {
      expect(
        reasonOf(call('writer', 'write_file', { path: 'src/a.ts', content: 'x' }, ctx(spec))),
      ).toBe('not allowed: source files can be edited only after the spec is approved');
    }
  });

  it('denies every spec-doc and spec-other path in every state', () => {
    const paths = ['docs/specs/f/SPECS.md', 'docs/specs/f/state.json', 'docs/specs/f/SUMMARY.md'];
    for (const spec of SPEC_STATES) {
      for (const path of paths) {
        const reason = reasonOf(call('writer', 'write_file', { path, content: 'x' }, ctx(spec)));
        expect(reason).toBe(
          spec === 'approved'
            ? 'not allowed: the spec is approved; spec files are read-only'
            : "not allowed: spec files can't be written by the code writer",
        );
      }
    }
  });

  it('denies edit_file of an approved SPECS.md with the approved reason and a deny event', () => {
    const decision = call(
      'writer',
      'edit_file',
      { path: 'docs/specs/f/SPECS.md', old_text: 'a', new_text: 'b' },
      ctx('approved'),
    );
    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe('not allowed: the spec is approved; spec files are read-only');
    expect(decision.event).toEqual({
      kind: 'rule',
      decision: 'deny',
      job: 'writer',
      tool: 'edit_file',
      target: 'docs/specs/f/SPECS.md',
      reason: 'not allowed: the spec is approved; spec files are read-only',
    });
  });

  it('denies a write to .git and to a path outside the root, before the job rules', () => {
    expect(
      reasonOf(
        call('writer', 'write_file', { path: '.git/config', content: 'x' }, ctx('approved')),
      ),
    ).toBe('not allowed: paths inside .git are not allowed');
    expect(
      reasonOf(call('writer', 'write_file', { path: '../x', content: 'x' }, ctx('approved'))),
    ).toBe("not allowed: this path can't be written");
  });
});

describe('checkToolCall: AC5 commands under the default check', () => {
  it('denies run_command for the writer and the reviewer with the default-check reason', () => {
    for (const job of ['writer', 'reviewer'] as const) {
      expect(reasonOf(call(job, 'run_command', SAMPLE_ARGS.run_command))).toBe(
        'commands are not allowed yet: no allowlist is configured',
      );
    }
  });

  it('denies run_command for the planner and the reader at step 2', () => {
    expect(reasonOf(call('planner', 'run_command', SAMPLE_ARGS.run_command))).toBe(
      'not allowed: the planner job has no run_command tool',
    );
    expect(reasonOf(call('reader', 'run_command', SAMPLE_ARGS.run_command))).toBe(
      'not allowed: the reader job has no run_command tool',
    );
  });

  it('gives the default check the denial, with its reason', () => {
    expect(denyAllCommands({ job: 'writer', program: 'node', args: [] })).toEqual({
      allow: false,
      reason: 'commands are not allowed yet: no allowlist is configured',
    });
  });
});

describe('checkToolCall: AC5 commands under an allowing check', () => {
  it('allows the writer and the reviewer, and the check receives the job and the checked arguments', () => {
    const seen: CommandCall[] = [];
    const ctx = context({
      commandCheck: (command) => {
        seen.push(command);
        return { allow: true };
      },
    });
    expectAllowed(call('writer', 'run_command', { program: 'node', args: ['-v'] }, ctx));
    expectAllowed(
      call('reviewer', 'run_command', { program: 'npm', args: ['test'], cwd: 'app' }, ctx),
    );
    expect(seen).toEqual([
      { job: 'writer', program: 'node', args: ['-v'] },
      { job: 'reviewer', program: 'npm', args: ['test'], cwd: 'app' },
    ]);
  });

  it('gives back the check reason when the check denies', () => {
    const ctx = context({
      commandCheck: () => ({ allow: false, reason: 'program is not listed' }),
    });
    expect(reasonOf(call('writer', 'run_command', { program: 'curl', args: [] }, ctx))).toBe(
      'program is not listed',
    );
  });
});

describe('checkToolCall: AC6 tightening', () => {
  it('denies a removed tool with the step 3 reason, for that job only', () => {
    const ctx = context({
      tightening: { remove: { writer: ['run_command'] } },
      commandCheck: allowAll,
    });
    expect(reasonOf(call('writer', 'run_command', SAMPLE_ARGS.run_command, ctx))).toBe(
      'not allowed: this project removed run_command from the writer job',
    );
    expectAllowed(call('reviewer', 'run_command', SAMPLE_ARGS.run_command, ctx));
  });

  it('never allows a tool that BASE_TOOLS denies, even with hostile tightening keys, for every job and tool', () => {
    const hostile = {
      remove: { reader: ['write_file'], planner: ['run_command'] },
      add: { reviewer: ['write_file'], reader: ['run_command'] },
      allow: { reviewer: ['write_file', 'run_command'], reader: ['write_file', 'run_command'] },
    } as unknown as PolicyContext['tightening'];
    for (const spec of SPEC_STATES) {
      for (const feature of FEATURES) {
        const ctx = context({ spec, feature, tightening: hostile, commandCheck: allowAll });
        for (const job of JOB_IDS) {
          for (const tool of TOOL_NAMES) {
            const decision = call(job, tool, SAMPLE_ARGS[tool], ctx);
            if (decision.allow) {
              expect(BASE_TOOLS[job]).toContain(tool);
            }
          }
        }
      }
    }
  });
});

describe('checkToolCall: step 4 arguments', () => {
  it('denies a call whose arguments fail the registry guard, with the fixed reason', () => {
    expect(
      reasonOf(call('writer', 'write_file', { path: 'src/a.ts' }, context({ spec: 'approved' }))),
    ).toBe('not allowed: the arguments are not valid for this tool');
  });

  it('allows the reader to read_file with the guard-valid arguments', () => {
    expectAllowed(call('reader', 'read_file', { path: 'notes.txt' }));
  });
});

describe('checkToolCall: AC8 no reason echoes a target or an argument value', () => {
  const SENTINEL = 'SENTINEL-GATE-PATH-4c2';
  const CONTENT = 'SENTINEL-GATE-CONTENT-4c2';

  it('keeps the sentinel path, content and tool name out of every denial reason', () => {
    const cases: Array<[JobId, string, Record<string, unknown>, PolicyContext]> = [
      ['writer', 'write_file', { path: SENTINEL, content: CONTENT }, context({ spec: 'draft' })],
      [
        'writer',
        'edit_file',
        { path: `docs/specs/f/${SENTINEL}`, old_text: CONTENT, new_text: CONTENT },
        context({ spec: 'approved' }),
      ],
      [
        'planner',
        'write_file',
        { path: SENTINEL, content: CONTENT },
        context({ feature: 'f', spec: 'draft' }),
      ],
      ['reviewer', 'write_file', { path: SENTINEL, content: CONTENT }, DEFAULT_POLICY_CONTEXT],
      ['writer', 'run_command', { program: SENTINEL, args: [CONTENT] }, DEFAULT_POLICY_CONTEXT],
      ['reader', 'read_file', { path: SENTINEL, extra: CONTENT }, DEFAULT_POLICY_CONTEXT],
      ['reader', `SECRET-${SENTINEL}`, { path: CONTENT }, DEFAULT_POLICY_CONTEXT],
    ];
    for (const [job, tool, args, ctx] of cases) {
      const decision = call(job, tool, args, ctx);
      expect(decision.allow).toBe(false);
      expect(decision.reason).not.toContain(SENTINEL);
      expect(decision.reason).not.toContain(CONTENT);
      expect(JSON.stringify(decision.event)).not.toContain(CONTENT);
    }
  });
});

describe('checkToolCall: rule events', () => {
  it('gives an allow event with the reason allowed and the target', () => {
    const decision = call('reader', 'read_file', { path: 'notes.txt' });
    expect(decision.event).toEqual({
      kind: 'rule',
      decision: 'allow',
      job: 'reader',
      tool: 'read_file',
      target: 'notes.txt',
      reason: 'allowed',
    });
  });
});

describe('checkToolCall: AC3 gate with a detected allowlist', () => {
  const detectedCheck = makeCommandCheck({
    test: [{ program: 'npm', args: ['test'] }],
    build: [{ program: 'pnpm', args: ['build'] }],
  });
  const detectedContext = context({ commandCheck: detectedCheck });

  it('gives an allow event for an allowed run_command', () => {
    const decision = call(
      'writer',
      'run_command',
      { program: 'npm', args: ['test'] },
      detectedContext,
    );
    expect(decision.allow).toBe(true);
    expect(decision.event).toEqual({
      kind: 'rule',
      decision: 'allow',
      job: 'writer',
      tool: 'run_command',
      target: 'npm',
      reason: 'allowed',
    });
  });

  it('gives a deny event with the check reason for a denied run_command', () => {
    const decision = call(
      'writer',
      'run_command',
      { program: 'curl', args: ['x'] },
      detectedContext,
    );
    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe("this command is not on the project's allowlist");
    expect(decision.event).toEqual({
      kind: 'rule',
      decision: 'deny',
      job: 'writer',
      tool: 'run_command',
      target: 'curl',
      reason: "this command is not on the project's allowlist",
    });
  });

  it('gives the reviewer the tests-only reason for a detected build form', () => {
    const decision = call(
      'reviewer',
      'run_command',
      { program: 'pnpm', args: ['build'] },
      detectedContext,
    );
    expect(decision.reason).toBe('the reviewer may run tests only');
    expect(decision.event.decision).toBe('deny');
  });

  it('keeps the deny-all default when no allowlist is set', () => {
    const decision = call('writer', 'run_command', { program: 'npm', args: ['test'] });
    expect(decision.reason).toBe('commands are not allowed yet: no allowlist is configured');
  });
});

// AC6 (p3-spec-lock, D36): the live spec state from the approval lock.
describe('checkToolCall: AC6 the live spec state (D36)', () => {
  const SPEC_PATH = 'docs/specs/f/SPECS.md';
  const STATE_PATH = 'docs/specs/.sdd-state.json';
  const APPROVED_REASON = 'not allowed: the spec is approved; spec files are read-only';
  const LOCKED_REASON =
    "not allowed: the spec's approval can't be checked, so nothing can be written";

  it('maps each approval value to a spec state', () => {
    expect(specStateOf('approved')).toBe('approved');
    expect(specStateOf('changed')).toBe('draft');
    expect(specStateOf('unchecked')).toBe('locked');
    expect(specStateOf('none')).toBe('none');
  });

  it('denies the planner and the writer a write to the approved spec, with the approved reason', () => {
    const approved = context({ feature: 'f', spec: 'approved' });
    expect(
      reasonOf(call('planner', 'write_file', { path: SPEC_PATH, content: 'x' }, approved)),
    ).toBe(APPROVED_REASON);
    expect(
      reasonOf(call('writer', 'write_file', { path: SPEC_PATH, content: 'x' }, approved)),
    ).toBe(APPROVED_REASON);
  });

  it('denies the writer source writes while the spec is changed (draft)', () => {
    const draft = context({ feature: 'f', spec: specStateOf('changed') });
    expect(reasonOf(call('writer', 'write_file', { path: 'src/a.ts', content: 'x' }, draft))).toBe(
      'not allowed: source files can be edited only after the spec is approved',
    );
  });

  it('denies every job a spec or source write when the approval is unchecked (locked)', () => {
    const locked = context({ feature: 'f', spec: 'locked' });
    for (const job of ['planner', 'writer'] as const) {
      for (const path of [SPEC_PATH, 'docs/specs/f/notes.md', 'src/a.ts']) {
        expect(
          reasonOf(call(job, 'write_file', { path, content: 'x' }, locked)),
          `${job} ${path}`,
        ).toBe(LOCKED_REASON);
        expect(
          reasonOf(call(job, 'edit_file', { path, old_text: 'a', new_text: 'b' }, locked)),
          `${job} edit ${path}`,
        ).toBe(LOCKED_REASON);
      }
    }
    for (const job of JOB_IDS) {
      expect(call(job, 'write_file', { path: 'src/a.ts', content: 'x' }, locked).allow).toBe(false);
    }
  });

  it('denies the state file to every job, under every spec state', () => {
    for (const spec of ['none', 'draft', 'approved', 'locked'] as const) {
      const ctx = context({ feature: 'f', spec });
      for (const job of ['planner', 'writer'] as const) {
        expect(
          call(job, 'write_file', { path: STATE_PATH, content: '{}' }, ctx).allow,
          `${job} ${spec}`,
        ).toBe(false);
      }
    }
  });

  it('refuses slugs the shared rules reject, and keeps valid ones', () => {
    expect(effectiveFeature('a--b')).toBeNull();
    expect(effectiveFeature('-a')).toBeNull();
    expect(effectiveFeature('a-')).toBeNull();
    expect(effectiveFeature('x'.repeat(65))).toBeNull();
    expect(effectiveFeature('x'.repeat(64))).toBe('x'.repeat(64));
    expect(effectiveFeature('p3-spec-lock')).toBe('p3-spec-lock');
    expect(effectiveFeature(null)).toBeNull();
  });
});
