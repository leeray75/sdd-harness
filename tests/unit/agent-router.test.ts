import { describe, expect, it, vi } from 'vitest';
import { handleAgentMessage, type RouterDeps } from '../../src/main/agent/router';
import { checkToolCall, type GateDecision } from '../../src/main/policy/gate';

const request = {
  type: 'tool-call-request',
  id: 'req-42',
  job: 'writer',
  tool: 'write_file',
  args: { path: 'secret-path.txt', content: 'SECRET-BODY' },
};

function makeDeps(gate: RouterDeps['checkToolCall'] = checkToolCall) {
  const info = vi.fn<(message: string) => void>();
  const error = vi.fn<(message: string) => void>();
  const checkToolCallSpy = vi.fn<RouterDeps['checkToolCall']>(gate);
  return { checkToolCall: checkToolCallSpy, logger: { info, error } };
}

describe('handleAgentMessage: tool call requests', () => {
  it('sends the request to the gate exactly once', () => {
    const deps = makeDeps();
    handleAgentMessage(request, deps);
    expect(deps.checkToolCall).toHaveBeenCalledTimes(1);
    expect(deps.checkToolCall).toHaveBeenCalledWith({
      job: 'writer',
      tool: 'write_file',
      args: { path: 'secret-path.txt', content: 'SECRET-BODY' },
    });
  });

  it('replies with a denied result carrying the same id and the gate reason', () => {
    const deps = makeDeps();
    const outcome = handleAgentMessage(request, deps);
    expect(outcome.ready).toBe(false);
    expect(outcome.reply).toEqual({
      type: 'tool-call-result',
      id: 'req-42',
      ok: false,
      error: {
        code: 'denied',
        reason: 'no tools are allowed yet (policy table arrives in Phase 2)',
      },
    });
  });

  it('logs the job, tool and reason, and never the arguments', () => {
    const deps = makeDeps();
    handleAgentMessage(request, deps);
    expect(deps.logger.info).toHaveBeenCalledTimes(1);
    const line = String(deps.logger.info.mock.calls[0]?.[0]);
    expect(line).toContain('job=writer');
    expect(line).toContain('tool=write_file');
    expect(line).toContain('reason=no tools are allowed yet');
    expect(line).not.toContain('secret-path.txt');
    expect(line).not.toContain('SECRET-BODY');
  });

  it('never calls an injected executor spy, even when the gate allows', () => {
    // The router takes no executor, so a spy passed in alongside the deps must stay unused.
    const executor = vi.fn();
    const deps = { ...makeDeps(), executor } as RouterDeps;
    handleAgentMessage(request, deps);
    expect(executor).not.toHaveBeenCalled();

    const allowDeps = { ...makeDeps(() => ({ allow: true })), executor } as RouterDeps;
    handleAgentMessage(request, allowDeps);
    expect(executor).not.toHaveBeenCalled();
  });

  it('refuses an allow decision too, because execution does not exist yet', () => {
    const allow = vi.fn((): GateDecision => ({ allow: true }));
    const deps = makeDeps(allow);
    const outcome = handleAgentMessage(request, deps);
    expect(allow).toHaveBeenCalledTimes(1);
    expect(outcome.reply).toMatchObject({ ok: false, id: 'req-42' });
  });

  it('uses a non-empty fallback when the gate gives an empty reason', () => {
    const deps = makeDeps(() => ({ allow: false, reason: '' }));
    const outcome = handleAgentMessage(request, deps);
    expect(outcome.reply).toMatchObject({
      ok: false,
      error: { code: 'denied', reason: 'denied by policy' },
    });
  });
});

describe('handleAgentMessage: invalid and other messages', () => {
  it('logs an invalid message as rejected, with the reason, and gives no reply', () => {
    const deps = makeDeps();
    const outcome = handleAgentMessage({ type: 'approve-spec', id: 'x' }, deps);
    expect(outcome).toEqual({ reply: null, ready: false });
    expect(deps.logger.error).toHaveBeenCalledWith('rejected agent message: unknown message type');
    expect(deps.checkToolCall).not.toHaveBeenCalled();
  });

  it('rejects a tool call request with an unknown job and does not reach the gate', () => {
    const deps = makeDeps();
    const outcome = handleAgentMessage({ ...request, job: 'approver' }, deps);
    expect(outcome.reply).toBeNull();
    expect(deps.logger.error).toHaveBeenCalledTimes(1);
    expect(deps.checkToolCall).not.toHaveBeenCalled();
  });

  it('gives no reply to non-object input', () => {
    const deps = makeDeps();
    expect(handleAgentMessage('ready', deps).reply).toBeNull();
    expect(handleAgentMessage(null, deps).reply).toBeNull();
    expect(deps.logger.error).toHaveBeenCalledTimes(2);
  });

  it('logs ready and asks the host to ping, with no reply', () => {
    const deps = makeDeps();
    const outcome = handleAgentMessage({ type: 'ready', pid: 99 }, deps);
    expect(outcome).toEqual({ reply: null, ready: true });
    expect(deps.logger.info).toHaveBeenCalledWith('agent ready pid=99');
  });

  it('logs pong with no reply', () => {
    const deps = makeDeps();
    expect(handleAgentMessage({ type: 'pong' }, deps)).toEqual({ reply: null, ready: false });
    expect(deps.logger.info).toHaveBeenCalledWith('agent pong');
  });
});
