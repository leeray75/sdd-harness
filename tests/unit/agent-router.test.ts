import { describe, expect, it, vi } from 'vitest';
import {
  handleAgentMessage,
  type RouterDeps,
  type ToolRunResult,
} from '../../src/main/agent/router';
import { checkToolCall, type GateDecision } from '../../src/main/policy/gate';

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

const DENY_REASON =
  'not allowed: only the reader job may call tools (policy table arrives in Phase 2)';

function makeDeps(
  gate: RouterDeps['checkToolCall'] = checkToolCall,
  run: () => Promise<ToolRunResult> = () => Promise.resolve({ ok: true, output: 'OUTPUT-TEXT' }),
) {
  const info = vi.fn<(message: string) => void>();
  const error = vi.fn<(message: string) => void>();
  const checkToolCallSpy = vi.fn<RouterDeps['checkToolCall']>(gate);
  const runTool = vi.fn<RouterDeps['runTool']>(run);
  return { checkToolCall: checkToolCallSpy, runTool, logger: { info, error } };
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

  it('logs the job, tool and reason, and never the arguments', async () => {
    const deps = makeDeps();
    await handleAgentMessage(request, deps);
    expect(deps.logger.info).toHaveBeenCalledTimes(1);
    const line = String(deps.logger.info.mock.calls[0]?.[0]);
    expect(line).toContain('tool call denied: job=writer tool=write_file');
    expect(line).toContain('reason=not allowed');
    expect(line).not.toContain('secret-path.txt');
    expect(line).not.toContain('SECRET-BODY');
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
    const deps = makeDeps(() => ({ allow: false, reason: '' }));
    const outcome = await handleAgentMessage(request, deps);
    expect(outcome.reply).toMatchObject({
      ok: false,
      error: { code: 'denied', reason: 'denied by policy' },
    });
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
    const allow = vi.fn((): GateDecision => ({ allow: true }));
    const deps = makeDeps(allow);
    await handleAgentMessage(readRequest, deps);
    expect(allow).toHaveBeenCalledTimes(1);
    expect(deps.runTool).toHaveBeenCalledTimes(1);
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
    const logged = [...deps.logger.info.mock.calls, ...deps.logger.error.mock.calls]
      .map((call) => String(call[0]))
      .join('\n');
    expect(logged).toContain('outcome=failed');
    expect(logged).not.toContain(SENTINEL);
    expect(JSON.stringify(outcome.reply)).not.toContain(SENTINEL);
  });

  it('keeps the sentinel out of the log lines when the runner returns it as a failure reason', async () => {
    const deps = makeDeps(undefined, () =>
      Promise.resolve({ ok: false, reason: `refused with ${SENTINEL}` }),
    );
    await handleAgentMessage(readRequest, deps);
    const logged = [...deps.logger.info.mock.calls, ...deps.logger.error.mock.calls]
      .map((call) => String(call[0]))
      .join('\n');
    expect(logged).not.toContain(SENTINEL);
  });
});
