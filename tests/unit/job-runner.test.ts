import { describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../../src/agent/provider/types';
import type { Message, Provider, StreamEvent } from '../../src/agent/provider/types';
import { createInProcessJobRunner, type JobRunner } from '../../src/main/workflow/job-runner';
import { DEFAULT_POLICY_CONTEXT, type PolicyContext } from '../../src/main/policy/context';
import type { ToolRunner } from '../../src/main/agent/router';
import { TURN_CAPS } from '../../src/shared/build-docs';
import { createScriptedProvider, type ScriptedTurn } from '../support/scripted-provider';

const ROOT = '/project-root';
const MODEL = 'test-model';

const approved: PolicyContext = { ...DEFAULT_POLICY_CONTEXT, feature: 'f', spec: 'approved' };
const beforeApproval: PolicyContext = { ...DEFAULT_POLICY_CONTEXT, feature: 'f', spec: 'none' };

const READ = (path: string): ScriptedTurn => ({
  toolCalls: [{ name: 'read_file', args: { path } }],
});

function runnerWith(
  provider: Provider,
  options: {
    contextNow?: () => PolicyContext;
    toolRunner?: ToolRunner;
    maxTurns?: number;
  } = {},
): JobRunner {
  return createInProcessJobRunner({
    root: ROOT,
    provider,
    model: MODEL,
    contextNow: options.contextNow ?? (() => approved),
    ...(options.toolRunner === undefined ? {} : { toolRunner: options.toolRunner }),
    ...(options.maxTurns === undefined ? {} : { maxTurns: options.maxTurns }),
  });
}

const okTool = (): ToolRunner =>
  vi.fn<ToolRunner>(async () => ({ ok: true as const, output: 'file text' }));

describe('createInProcessJobRunner: tool calls', () => {
  it('sends an allowed call to the tool runner and returns its output to the model', async () => {
    const provider = createScriptedProvider({
      writer: [READ('notes.txt'), { text: 'Done.' }],
      reviewer: [],
    });
    const toolRunner = okTool();
    const result = await runnerWith(provider, { toolRunner })({
      job: 'writer',
      task: 'Implement.',
      history: [],
    });
    expect(toolRunner).toHaveBeenCalledTimes(1);
    expect(toolRunner).toHaveBeenCalledWith({
      job: 'writer',
      tool: 'read_file',
      args: { path: 'notes.txt' },
    });
    expect(provider.requests[1]?.messages.at(-1)).toEqual({
      role: 'tool',
      toolCallId: 'call_1',
      content: 'file text',
    });
    expect(result).toMatchObject({ ok: true, text: 'Done.', stopped: 'answered' });
  });

  it('denies a gated call before the tool runner, and returns the gate reason to the model', async () => {
    const provider = createScriptedProvider({
      writer: [
        { toolCalls: [{ name: 'write_file', args: { path: 'src/a.ts', content: 'x' } }] },
        { text: 'Stopped.' },
      ],
      reviewer: [],
    });
    const toolRunner = okTool();
    await runnerWith(provider, { toolRunner, contextNow: () => beforeApproval })({
      job: 'writer',
      task: 'Implement.',
      history: [],
    });
    expect(toolRunner).not.toHaveBeenCalled();
    expect(provider.requests[1]?.messages.at(-1)).toEqual({
      role: 'tool',
      toolCallId: 'call_1',
      content:
        'tool error: not allowed: source files can be edited only after the spec is approved',
    });
  });

  it('denies a run_command of git commit, and nothing runs', async () => {
    const provider = createScriptedProvider({
      writer: [
        {
          toolCalls: [
            { name: 'run_command', args: { program: 'git', args: ['commit', '-m', 'x'] } },
          ],
        },
        { text: 'Stopped.' },
      ],
      reviewer: [],
    });
    const toolRunner = okTool();
    await runnerWith(provider, { toolRunner })({ job: 'writer', task: 'Implement.', history: [] });
    expect(toolRunner).not.toHaveBeenCalled();
    const tool = provider.requests[1]?.messages.at(-1);
    expect(tool).toMatchObject({ role: 'tool', toolCallId: 'call_1' });
    expect(tool && 'content' in tool ? tool.content : '').toMatch(/^tool error: /);
  });

  it('does not run the tool when the call is denied by the default command check', async () => {
    const provider = createScriptedProvider({
      writer: [
        { toolCalls: [{ name: 'run_command', args: { program: 'git', args: ['push'] } }] },
        { text: 'Stopped.' },
      ],
      reviewer: [],
    });
    const runCommand = vi.fn<ToolRunner>(async () => ({ ok: true as const, output: '' }));
    await runnerWith(provider, { toolRunner: runCommand })({
      job: 'writer',
      task: 'Implement.',
      history: [],
    });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('gives the reviewer no write tools', async () => {
    const provider = createScriptedProvider({
      writer: [],
      reviewer: [
        { toolCalls: [{ name: 'write_file', args: { path: 'src/a.ts', content: 'x' } }] },
        { text: 'Reviewed.' },
      ],
    });
    const toolRunner = okTool();
    await runnerWith(provider, { toolRunner })({
      job: 'reviewer',
      task: 'Review.',
      history: [],
    });
    expect(toolRunner).not.toHaveBeenCalled();
  });
});

describe('createInProcessJobRunner: history and results', () => {
  it('sends the history before the task and returns the messages for the next round', async () => {
    const history: Message[] = [
      { role: 'user', text: 'Round one.' },
      { role: 'assistant', text: 'Reply one.', toolCalls: [] },
    ];
    const provider = createScriptedProvider({ writer: [{ text: 'Reply two.' }], reviewer: [] });
    const result = await runnerWith(provider)({ job: 'writer', task: 'Round two.', history });
    expect(provider.requests[0]?.messages).toEqual([
      ...history,
      { role: 'user', text: 'Round two.' },
    ]);
    expect(result).toMatchObject({
      ok: true,
      messages: [
        ...history,
        { role: 'user', text: 'Round two.' },
        { role: 'assistant', text: 'Reply two.', toolCalls: [] },
      ],
    });
  });

  it('uses the writer and reviewer turn caps by default (40 and 20)', async () => {
    expect(TURN_CAPS).toEqual({ writer: 40, reviewer: 20 });
    const toolRunner = okTool();
    const writerTurns = Array.from({ length: 40 }, () => READ('a.txt'));
    const writerProvider = createScriptedProvider({ writer: writerTurns, reviewer: [] });
    const writer = await runnerWith(writerProvider, { toolRunner })({
      job: 'writer',
      task: 'Implement.',
      history: [],
    });
    expect(writerProvider.requests).toHaveLength(40);
    expect(writer).toEqual({
      ok: false,
      reason: 'the writer did not finish within its turn limit',
    });

    const reviewerTurns = Array.from({ length: 20 }, () => READ('a.txt'));
    const reviewerProvider = createScriptedProvider({ writer: [], reviewer: reviewerTurns });
    const reviewer = await runnerWith(reviewerProvider, { toolRunner })({
      job: 'reviewer',
      task: 'Review.',
      history: [],
    });
    expect(reviewerProvider.requests).toHaveLength(20);
    expect(reviewer).toEqual({
      ok: false,
      reason: 'the reviewer did not finish within its turn limit',
    });
  });
});

describe('createInProcessJobRunner: failures', () => {
  it('returns a turn-limit failure when the reply at the cap still asks for a tool', async () => {
    const provider = createScriptedProvider({
      writer: [READ('a.txt'), READ('a.txt'), READ('a.txt')],
      reviewer: [],
    });
    const toolRunner = okTool();
    const result = await runnerWith(provider, { toolRunner, maxTurns: 2 })({
      job: 'writer',
      task: 'Implement.',
      history: [],
    });
    expect(result).toEqual({
      ok: false,
      reason: 'the writer did not finish within its turn limit',
    });
    expect(provider.requests).toHaveLength(2);
  });

  it('returns the provider error message, and the message holds no key', async () => {
    const error = new ProviderError('server', 500);
    const failing: Provider = {
      listModels: () => Promise.resolve([]),
      stream(): AsyncIterable<StreamEvent> {
        throw error;
      },
    };
    const result = await runnerWith(failing)({ job: 'writer', task: 'Implement.', history: [] });
    expect(result).toEqual({ ok: false, reason: error.message });
    expect(JSON.stringify(result)).not.toMatch(/sk-|key|authorization/i);
  });

  it('returns a failure, not a throw, when the script is exhausted', async () => {
    const provider = createScriptedProvider({ writer: [], reviewer: [] });
    const result = await runnerWith(provider)({ job: 'writer', task: 'Implement.', history: [] });
    expect(result.ok).toBe(false);
    expect(provider.requests).toHaveLength(0);
  });
});
