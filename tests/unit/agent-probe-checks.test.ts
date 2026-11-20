import { describe, expect, it } from 'vitest';
import { CHAT_PROMPT, runChatOnce } from '../../src/agent/probes/chat';
import { LOOKUP_TOOL, runToolUseOnce, TOOL_RESULT } from '../../src/agent/probes/tool-use';
import { ProviderError } from '../../src/agent/provider/types';
import {
  chatMissing,
  chatPass,
  codeAnswer,
  events,
  fakeProvider,
  lookupCall,
  makeClock,
  throws,
} from './probe-helpers';

const MODEL = 'model-under-test';
const OPTIONS = { timeoutMs: 1000, maxTokens: 256 };

function chatOptions(now: () => number) {
  return { ...OPTIONS, now };
}

describe('chat probe (AC5)', () => {
  it('sends the fixed prompt with no tools and the token limit', async () => {
    const clock = makeClock();
    const provider = fakeProvider(clock, { chat: [chatPass()] });
    await runChatOnce(provider, MODEL, chatOptions(clock.now));
    expect(provider.requests[0]).toEqual({
      model: MODEL,
      messages: [{ role: 'user', text: CHAT_PROMPT }],
      tools: [],
      maxTokens: 256,
    });
  });

  it('passes when the text contains the token, ignoring case', async () => {
    const clock = makeClock();
    const provider = fakeProvider(clock, {
      chat: [
        events(
          [
            { type: 'text', text: 'probe-' },
            { type: 'text', text: 'ok.' },
          ],
          10,
        ),
      ],
    });
    const attempt = await runChatOnce(provider, MODEL, chatOptions(clock.now));
    expect(attempt).toMatchObject({ passed: true, failure: null });
  });

  it('fails with missing-token when the token is absent', async () => {
    const clock = makeClock();
    const provider = fakeProvider(clock, { chat: [chatMissing()] });
    const attempt = await runChatOnce(provider, MODEL, chatOptions(clock.now));
    expect(attempt).toMatchObject({ passed: false, failure: 'missing-token' });
  });

  it('fails with the kind of a thrown ProviderError', async () => {
    const clock = makeClock();
    const provider = fakeProvider(clock, {
      chat: [throws(new ProviderError('rate-limit', 429))],
    });
    const attempt = await runChatOnce(provider, MODEL, chatOptions(clock.now));
    expect(attempt).toMatchObject({ passed: false, failure: 'rate-limit' });
  });
});

describe('tool-use probe (AC6), step 1', () => {
  async function step1(args: string | null, name = 'lookup_code') {
    const clock = makeClock();
    const script =
      args === null
        ? events([{ type: 'text', text: 'I will not use a tool.' }])
        : events([
            { type: 'tool-call', id: 'call_1', name, arguments: args },
            { type: 'done', stopReason: 'tool-use' },
          ]);
    const provider = fakeProvider(clock, { step1: [script] });
    return runToolUseOnce(provider, MODEL, chatOptions(clock.now));
  }

  it('offers the lookup tool with a required string name and no other properties', async () => {
    const clock = makeClock();
    const provider = fakeProvider(clock, { step1: [lookupCall()] });
    await runToolUseOnce(provider, MODEL, chatOptions(clock.now));
    expect(provider.requests[0]?.tools).toEqual([LOOKUP_TOOL]);
    expect(LOOKUP_TOOL.parameters).toEqual({
      type: 'object',
      properties: { name: { type: 'string', description: 'The name to look up.' } },
      required: ['name'],
      additionalProperties: false,
    });
  });

  it('fails with no-tool-call when the reply has no call', async () => {
    expect(await step1(null)).toMatchObject({ passed: false, failure: 'no-tool-call' });
  });

  it('fails with wrong-tool when the first call has another name', async () => {
    expect(await step1('{"name":"harness"}', 'read_file')).toMatchObject({
      failure: 'wrong-tool',
    });
  });

  it('fails with bad-arguments for unparseable JSON or a non-object', async () => {
    expect(await step1('{"name": ')).toMatchObject({ failure: 'bad-arguments' });
    expect(await step1('["harness"]')).toMatchObject({ failure: 'bad-arguments' });
    expect(await step1('"harness"')).toMatchObject({ failure: 'bad-arguments' });
  });

  it('fails with wrong-arguments for a missing or different name', async () => {
    expect(await step1('{"name":"other"}')).toMatchObject({ failure: 'wrong-arguments' });
    expect(await step1('{}')).toMatchObject({ failure: 'wrong-arguments' });
    expect(await step1('{"name":42}')).toMatchObject({ failure: 'wrong-arguments' });
  });

  it('accepts the name trimmed and lowercased', async () => {
    const clock = makeClock();
    const provider = fakeProvider(clock, {
      step1: [lookupCall(100, '{"name":"  HARNESS "}')],
      step2: [codeAnswer()],
    });
    const attempt = await runToolUseOnce(provider, MODEL, chatOptions(clock.now));
    expect(attempt).toMatchObject({ passed: true, failure: null });
  });

  it('checks only the first call', async () => {
    const clock = makeClock();
    const provider = fakeProvider(clock, {
      step1: [
        events([
          { type: 'tool-call', id: 'a', name: 'read_file', arguments: '{}' },
          { type: 'tool-call', id: 'b', name: 'lookup_code', arguments: '{"name":"harness"}' },
        ]),
      ],
    });
    const attempt = await runToolUseOnce(provider, MODEL, chatOptions(clock.now));
    expect(attempt).toMatchObject({ failure: 'wrong-tool' });
  });
});

describe('tool-use probe (AC6), step 2', () => {
  it('sends the call and the fixed tool result, and still offers the tool', async () => {
    const clock = makeClock();
    const provider = fakeProvider(clock, {
      step1: [lookupCall()],
      step2: [codeAnswer()],
    });
    await runToolUseOnce(provider, MODEL, chatOptions(clock.now));
    const second = provider.requests[1];
    expect(second?.tools).toEqual([LOOKUP_TOOL]);
    expect(second?.messages[1]).toEqual({
      role: 'assistant',
      text: '',
      toolCalls: [{ id: 'call_1', name: 'lookup_code', arguments: '{"name":"harness"}' }],
    });
    expect(second?.messages[2]).toEqual({
      role: 'tool',
      toolCallId: 'call_1',
      content: TOOL_RESULT,
    });
    expect(TOOL_RESULT).toBe('The code for harness is ZEBRA-7341.');
  });

  it('passes when the answer contains the code, ignoring case', async () => {
    const clock = makeClock();
    const provider = fakeProvider(clock, {
      step1: [lookupCall()],
      step2: [events([{ type: 'text', text: 'the code is zebra-7341' }])],
    });
    const attempt = await runToolUseOnce(provider, MODEL, chatOptions(clock.now));
    expect(attempt).toMatchObject({ passed: true, failure: null });
    expect(attempt.requests).toHaveLength(2);
  });

  it('fails with missing-token when the answer lacks the code', async () => {
    const clock = makeClock();
    const provider = fakeProvider(clock, {
      step1: [lookupCall()],
      step2: [events([{ type: 'text', text: 'I could not find it.' }])],
    });
    const attempt = await runToolUseOnce(provider, MODEL, chatOptions(clock.now));
    expect(attempt).toMatchObject({ passed: false, failure: 'missing-token' });
  });

  it('fails with the kind of an error in step 2', async () => {
    const clock = makeClock();
    const provider = fakeProvider(clock, {
      step1: [lookupCall()],
      step2: [throws(new ProviderError('server', 500))],
    });
    const attempt = await runToolUseOnce(provider, MODEL, chatOptions(clock.now));
    expect(attempt).toMatchObject({ passed: false, failure: 'server' });
    expect(attempt.requests).toHaveLength(2);
  });
});

describe('errors in the probes', () => {
  it('fails step 1 with the kind of a ProviderError, and an unknown error as unknown', async () => {
    const clock = makeClock();
    const auth = fakeProvider(clock, { step1: [throws(new ProviderError('auth', 401))] });
    expect(await runToolUseOnce(auth, MODEL, chatOptions(clock.now))).toMatchObject({
      failure: 'auth',
    });
    const other = fakeProvider(clock, { step1: [throws(new Error('not a provider error'))] });
    expect(await runToolUseOnce(other, MODEL, chatOptions(clock.now))).toMatchObject({
      failure: 'unknown',
    });
  });
});
