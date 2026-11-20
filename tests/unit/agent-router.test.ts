import { describe, expect, it, vi } from 'vitest';
import {
  handleAgentMessage,
  type RouterDeps,
  type ToolRunResult,
} from '../../src/main/agent/router';
import {
  checkToolCall,
  type PolicyDecision,
  type ToolCallRequest,
} from '../../src/main/policy/gate';
import { DEFAULT_POLICY_CONTEXT, type PolicyContext } from '../../src/main/policy/context';
import { makeRuleEvent, type RuleEvent } from '../../src/main/policy/rule-event';

const request = {
  type: 'tool-call-request',
  id: 'req-42',
  job: 'writer',
  tool: 'write_file',
  args: { path: 'secret-path.txt', content: 'SECRET-BODY' },
};

const readRequest = {
  type: 'tool-call-request',
  id: 'read-7',
  job: 'reader',
  tool: 'read_file',
  args: { path: 'notes.txt' },
};

/** The gate as the host uses it: the default policy context bound in. */
const defaultGate = (r: ToolCallRequest): PolicyDecision =>
  checkToolCall(r, DEFAULT_POLICY_CONTEXT);

const DENY_REASON = 'not allowed: source files can be edited only after the spec is approved';

function makeDeps(
  gate: RouterDeps['checkToolCall'] = defaultGate,
  run: () => Promise<ToolRunResult> = () => Promise.resolve({ ok: true, output: 'OUTPUT-TEXT' }),
) {
  const info = vi.fn<(message: string) => void>();
  const error = vi.fn<(message: string) => void>();
  const checkToolCallSpy = vi.fn<RouterDeps['checkToolCall']>(gate);
  const runTool = vi.fn<RouterDeps['runTool']>(run);
  const onRuleEvent = vi.fn<(event: RuleEvent) => void>();
  return { checkToolCall: checkToolCallSpy, runTool, onRuleEvent, logger: { info, error } };
}

/** Logged text from both streams, for checks that must not find a value in any line. */
function loggedText(deps: ReturnType<typeof makeDeps>): string {
  return [...deps.logger.info.mock.calls, ...deps.logger.error.mock.calls]
    .map((call) => String(call[0]))
    .join('\n');
}

describe('handleAgentMessage: denied tool calls', () => {
  it('sends the request to the gate exactly once', async () => {
    const deps = makeDeps();
    await handleAgentMessage(request, deps);
    expect(deps.checkToolCall).toHaveBeenCalledTimes(1);
    expect(deps.checkToolCall).toHaveBeenCalledWith({
      job: 'writer',
      tool: 'write_file',
      args: { path: 'secret-path.txt', content: 'SECRET-BODY' },
    });
  });

  it('replies with a denied result carrying the same id and the gate reason', async () => {
    const deps = makeDeps();
    const outcome = await handleAgentMessage(request, deps);
    expect(outcome.ready).toBe(false);
    expect(outcome.reply).toEqual({
      type: 'tool-call-result',
      id: 'req-42',
      ok: false,
      error: { code: 'denied', reason: DENY_REASON },
    });
  });

  it('emits one deny rule event and no longer logs a separate denied line', async () => {
    const deps = makeDeps();
    await handleAgentMessage(request, deps);
    expect(deps.onRuleEvent).toHaveBeenCalledTimes(1);
    expect(deps.onRuleEvent.mock.calls[0]?.[0]).toEqual({
      kind: 'rule',
      decision: 'deny',
      job: 'writer',
      tool: 'write_file',
      target: 'secret-path.txt',
      reason: DENY_REASON,
    });
    expect(deps.logger.info).not.toHaveBeenCalled();
    expect(deps.logger.error).not.toHaveBeenCalled();
  });

  it('never reaches the tool runner when the gate denies, with a spy runner', async () => {
    const deps = makeDeps();
    const outcome = await handleAgentMessage(request, deps);
    expect(deps.runTool).not.toHaveBeenCalled();
    expect(outcome.reply).toMatchObject({ ok: false, error: { code: 'denied' } });
  });

  it('never reaches the tool runner for reader calls to other tools or bad args', async () => {
    const deps = makeDeps();
    await handleAgentMessage({ ...readRequest, tool: 'write_file' }, deps);
    await handleAgentMessage({ ...readRequest, args: { path: 'a', extra: 1 } }, deps);
    expect(deps.runTool).not.toHaveBeenCalled();
  });

  it('uses a non-empty fallback when the gate gives an empty reason', async () => {
    const deps = makeDeps(() => ({
      allow: false,
      reason: '',
      event: makeRuleEvent({ job: 'writer', tool: 'write_file', args: {} }, false, ''),
    }));
    const outcome = await handleAgentMessage(request, deps);
    expect(outcome.reply).toMatchObject({
      ok: false,
      error: { code: 'denied', reason: 'denied by policy' },
    });
  });
});

describe('handleAgentMessage: AC8 each gate step denies and the runner is never called', () => {
  const RESTRICTED: PolicyContext = {
    ...DEFAULT_POLICY_CONTEXT,
    feature: 'f',
    spec: 'approved',
    tightening: { remove: { reviewer: ['run_command'] } },
    commandCheck: () => ({ allow: true }),
  };
  const CASES: Array<{ name: string; message: Record<string, unknown>; ctx: PolicyContext }> = [
    {
      name: 'step 1: a name that is not a registry tool',
      message: { ...readRequest, tool: 'SECRET-TOOL' },
      ctx: DEFAULT_POLICY_CONTEXT,
    },
    {
      name: 'step 2: a tool outside the job base set',
      message: { ...request, job: 'reviewer', tool: 'write_file' },
      ctx: DEFAULT_POLICY_CONTEXT,
    },
    {
      name: 'step 3: a tool the project removed',
      message: {
        ...request,
        job: 'reviewer',
        tool: 'run_command',
        args: { program: 'node', args: [] },
      },
      ctx: RESTRICTED,
    },
    {
      name: 'step 4: arguments that fail the guard',
      message: { ...readRequest, args: { path: 'a.txt', extra: 'x' } },
      ctx: DEFAULT_POLICY_CONTEXT,
    },
    {
      name: 'step 5: an approved spec file written by the writer',
      message: {
        ...request,
        tool: 'edit_file',
        args: { path: 'docs/specs/f/SPECS.md', old_text: 'a', new_text: 'b' },
      },
      ctx: RESTRICTED,
    },
    {
      name: 'step 6: a command under the default check',
      message: { ...request, tool: 'run_command', args: { program: 'git', args: ['push'] } },
      ctx: DEFAULT_POLICY_CONTEXT,
    },
  ];

  it.each(CASES)('$name', async ({ message, ctx }) => {
    const deps = makeDeps((r) => checkToolCall(r, ctx));
    const outcome = await handleAgentMessage(message, deps);
    expect(outcome.reply).toMatchObject({
      type: 'tool-call-result',
      ok: false,
      error: { code: 'denied' },
    });
    expect(deps.runTool).not.toHaveBeenCalled();
    expect(deps.onRuleEvent).toHaveBeenCalledTimes(1);
    expect(deps.onRuleEvent.mock.calls[0]?.[0]).toMatchObject({ decision: 'deny' });
  });
});

describe('handleAgentMessage: allowed tool calls', () => {
  it('runs the allowed call once, with the tool name and args, and returns the output', async () => {
    const deps = makeDeps();
    const outcome = await handleAgentMessage(readRequest, deps);
    expect(deps.runTool).toHaveBeenCalledTimes(1);
    expect(deps.runTool).toHaveBeenCalledWith({ tool: 'read_file', args: { path: 'notes.txt' } });
    expect(outcome).toEqual({
      reply: { type: 'tool-call-result', id: 'read-7', ok: true, output: 'OUTPUT-TEXT' },
      ready: false,
    });
  });

  it('emits one allow rule event before the runner is called', async () => {
    const deps = makeDeps();
    await handleAgentMessage(readRequest, deps);
    expect(deps.onRuleEvent).toHaveBeenCalledTimes(1);
    expect(deps.onRuleEvent.mock.calls[0]?.[0]).toEqual({
      kind: 'rule',
      decision: 'allow',
      job: 'reader',
      tool: 'read_file',
      target: 'notes.txt',
      reason: 'allowed',
    });
    expect(deps.onRuleEvent.mock.invocationCallOrder[0]).toBeLessThan(
      deps.runTool.mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it('returns a failed result with the runner reason and the same id', async () => {
    const deps = makeDeps(undefined, () =>
      Promise.resolve({ ok: false, reason: 'the file does not exist' }),
    );
    const outcome = await handleAgentMessage(readRequest, deps);
    expect(outcome.reply).toEqual({
      type: 'tool-call-result',
      id: 'read-7',
      ok: false,
      error: { code: 'failed', reason: 'the file does not exist' },
    });
  });

  it('returns a failed result when the runner throws, without its message', async () => {
    const deps = makeDeps(undefined, () => Promise.reject(new Error('leaked notes.txt')));
    const outcome = await handleAgentMessage(readRequest, deps);
    expect(outcome.reply).toMatchObject({
      ok: false,
      id: 'read-7',
      error: { code: 'failed', reason: 'the tool could not run' },
    });
    expect(JSON.stringify(outcome.reply)).not.toContain('leaked');
  });

  it('returns a failed result when the output is over the protocol cap', async () => {
    const deps = makeDeps(undefined, () =>
      Promise.resolve({ ok: true, output: 'a'.repeat(65_537) }),
    );
    const outcome = await handleAgentMessage(readRequest, deps);
    expect(outcome.reply).toMatchObject({ ok: false, error: { code: 'failed' } });
  });

  it('logs job, tool and outcome only, never args or output', async () => {
    const deps = makeDeps(undefined, () => Promise.resolve({ ok: true, output: 'OUTPUT-TEXT' }));
    await handleAgentMessage({ ...readRequest, args: { path: 'SECRET-PATH' } }, deps);
    expect(deps.logger.info).toHaveBeenCalledTimes(1);
    const line = String(deps.logger.info.mock.calls[0]?.[0]);
    expect(line).toContain('job=reader');
    expect(line).toContain('tool=read_file');
    expect(line).toContain('outcome=ok');
    expect(line).not.toContain('SECRET-PATH');
    expect(line).not.toContain('OUTPUT-TEXT');
  });

  it('logs a failed call with its outcome and no reason text', async () => {
    const deps = makeDeps(undefined, () =>
      Promise.resolve({ ok: false, reason: 'the file does not exist' }),
    );
    await handleAgentMessage(readRequest, deps);
    const line = String(deps.logger.info.mock.calls[0]?.[0]);
    expect(line).toContain('outcome=failed');
    expect(line).not.toContain('does not exist');
  });

  it('calls the gate with the request before running it', async () => {
    const allow = vi.fn((r: ToolCallRequest): PolicyDecision => ({
      allow: true,
      reason: 'allowed',
      event: makeRuleEvent(r, true, 'allowed'),
    }));
    const deps = makeDeps(allow);
    await handleAgentMessage(readRequest, deps);
    expect(allow).toHaveBeenCalledTimes(1);
    expect(deps.runTool).toHaveBeenCalledTimes(1);
  });
});

describe('handleAgentMessage: AC7 rule events', () => {
  it('emits exactly one event for each validated call, allowed or denied', async () => {
    const deps = makeDeps();
    await handleAgentMessage(readRequest, deps);
    await handleAgentMessage(request, deps);
    expect(deps.onRuleEvent).toHaveBeenCalledTimes(2);
    expect(deps.onRuleEvent.mock.calls.map((call) => call[0]?.decision)).toEqual(['allow', 'deny']);
  });

  it('emits no event for a message that fails protocol validation', async () => {
    const deps = makeDeps();
    await handleAgentMessage({ type: 'approve-spec', id: 'x' }, deps);
    await handleAgentMessage({ ...request, job: 'approver' }, deps);
    await handleAgentMessage({ ...request, tool: '' }, deps);
    expect(deps.onRuleEvent).not.toHaveBeenCalled();
  });

  it('keeps sentinel content, new_text and args values out of the events and the log', async () => {
    const CONTENT = 'SENTINEL-CONTENT-R7';
    const NEW_TEXT = 'SENTINEL-NEWTEXT-R7';
    const ARGS = 'SENTINEL-ARGS-R7';
    const deps = makeDeps();
    await handleAgentMessage(
      {
        ...request,
        tool: 'edit_file',
        args: { path: 'src/a.ts', old_text: CONTENT, new_text: NEW_TEXT },
      },
      deps,
    );
    await handleAgentMessage({ ...readRequest, args: { path: 'a.txt', extra: ARGS } }, deps);
    await handleAgentMessage({ ...request, args: { path: 'src/a.ts', content: CONTENT } }, deps);
    const events = JSON.stringify(deps.onRuleEvent.mock.calls);
    expect(events).not.toContain(CONTENT);
    expect(events).not.toContain(NEW_TEXT);
    expect(events).not.toContain(ARGS);
    expect(loggedText(deps)).not.toContain(CONTENT);
    expect(loggedText(deps)).not.toContain(NEW_TEXT);
    expect(loggedText(deps)).not.toContain(ARGS);
  });

  it('escapes control characters and cuts a 500-character target in the event', async () => {
    const deps = makeDeps();
    await handleAgentMessage(
      { ...readRequest, args: { path: `bad\u0001${'p'.repeat(500)}` } },
      deps,
    );
    const event = deps.onRuleEvent.mock.calls[0]?.[0];
    expect(event?.target).toBe('bad\\u0001' + 'p'.repeat(200 - 'bad\\u0001'.length) + '…');
  });
});

describe('handleAgentMessage: invalid and other messages', () => {
  it('logs an invalid message as rejected, with the reason, and gives no reply', async () => {
    const deps = makeDeps();
    const outcome = await handleAgentMessage({ type: 'approve-spec', id: 'x' }, deps);
    expect(outcome).toEqual({ reply: null, ready: false });
    expect(deps.logger.error).toHaveBeenCalledWith('rejected agent message: unknown message type');
    expect(deps.checkToolCall).not.toHaveBeenCalled();
    expect(deps.runTool).not.toHaveBeenCalled();
  });

  it('rejects a tool call request with an unknown job and does not reach the gate', async () => {
    const deps = makeDeps();
    const outcome = await handleAgentMessage({ ...request, job: 'approver' }, deps);
    expect(outcome.reply).toBeNull();
    expect(deps.logger.error).toHaveBeenCalledTimes(1);
    expect(deps.checkToolCall).not.toHaveBeenCalled();
    expect(deps.runTool).not.toHaveBeenCalled();
  });

  it('gives no reply to non-object input', async () => {
    const deps = makeDeps();
    expect((await handleAgentMessage('ready', deps)).reply).toBeNull();
    expect((await handleAgentMessage(null, deps)).reply).toBeNull();
    expect(deps.logger.error).toHaveBeenCalledTimes(2);
  });

  it('logs ready and asks the host to ping, with no reply', async () => {
    const deps = makeDeps();
    const outcome = await handleAgentMessage({ type: 'ready', pid: 99 }, deps);
    expect(outcome).toEqual({ reply: null, ready: true });
    expect(deps.logger.info).toHaveBeenCalledWith('agent ready pid=99');
  });

  it('logs pong with no reply', async () => {
    const deps = makeDeps();
    expect(await handleAgentMessage({ type: 'pong' }, deps)).toEqual({
      reply: null,
      ready: false,
    });
    expect(deps.logger.info).toHaveBeenCalledWith('agent pong');
  });
});

describe('handleAgentMessage: a sentinel key through a failing tool (AC11)', () => {
  const SENTINEL = 'SENTINEL-ROUTER-KEY-2026';

  it('keeps the sentinel out of the log lines when the runner throws with it in the message', async () => {
    const deps = makeDeps(undefined, () =>
      Promise.reject(new Error(`request for ${SENTINEL} failed: Bearer ${SENTINEL}`)),
    );
    const outcome = await handleAgentMessage(readRequest, deps);
    const logged = loggedText(deps);
    expect(logged).toContain('outcome=failed');
    expect(logged).not.toContain(SENTINEL);
    expect(JSON.stringify(outcome.reply)).not.toContain(SENTINEL);
  });

  it('keeps the sentinel out of the log lines when the runner returns it as a failure reason', async () => {
    const deps = makeDeps(undefined, () =>
      Promise.resolve({ ok: false, reason: `refused with ${SENTINEL}` }),
    );
    await handleAgentMessage(readRequest, deps);
    expect(loggedText(deps)).not.toContain(SENTINEL);
  });
});
