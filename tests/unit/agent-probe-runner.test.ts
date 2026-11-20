import { describe, expect, it } from 'vitest';
import { probeModel, listServerModels, median } from '../../src/agent/probes/run';
import { ProviderError } from '../../src/agent/provider/types';
import {
  caught,
  chatMissing,
  chatPass,
  codeAnswer,
  events,
  fakeProvider,
  HANG,
  lookupCall,
  makeClock,
  throws,
} from './probe-helpers';

const MODEL = 'model-under-test';

describe('median', () => {
  it('takes the middle value for an odd count and the mean of the middle two for an even count', () => {
    expect(median([300, 100, 200])).toBe(200);
    expect(median([400, 100, 300, 200])).toBe(250);
    expect(median([])).toBeNull();
  });
});

describe('probeModel status rules', () => {
  it('is passed when every run passes, with no failures', async () => {
    const clock = makeClock();
    const provider = fakeProvider(clock, {
      chat: [chatPass()],
      step1: [lookupCall()],
      step2: [codeAnswer()],
    });
    const result = await probeModel(provider, MODEL, 32768, {
      now: clock.now,
      timeoutMs: 1000,
    });
    expect(result.model).toBe(MODEL);
    expect(result.contextWindow).toBe(32768);
    expect(result.chat).toMatchObject({ status: 'passed', runs: 3, passes: 3, failures: [] });
    expect(result.toolUse).toMatchObject({ status: 'passed', runs: 3, passes: 3, failures: [] });
  });

  it('is failed when no run passes, with one failure per run in run order', async () => {
    const clock = makeClock();
    const provider = fakeProvider(clock, { chat: [chatMissing()] });
    const result = await probeModel(provider, MODEL, null, { now: clock.now, timeoutMs: 1000 });
    expect(result.chat).toMatchObject({
      status: 'failed',
      passes: 0,
      failures: ['missing-token', 'missing-token', 'missing-token'],
    });
  });

  it('is unreliable for a mix of runs, and lists only the failed runs', async () => {
    const clock = makeClock();
    const provider = fakeProvider(clock, {
      chat: [chatPass(), chatMissing(), chatPass()],
      step1: [lookupCall()],
      step2: [codeAnswer()],
    });
    const result = await probeModel(provider, MODEL, null, {
      now: clock.now,
      timeoutMs: 1000,
    });
    expect(result.chat).toMatchObject({ status: 'unreliable', runs: 3, passes: 2 });
    expect(result.chat.failures).toEqual(['missing-token']);
  });

  it('keeps one failure code per failed run, in run order', async () => {
    const clock = makeClock();
    const provider = fakeProvider(clock, {
      chat: [
        throws(new ProviderError('rate-limit', 429)),
        chatPass(),
        throws(new ProviderError('server', 500)),
      ],
      step1: [lookupCall()],
      step2: [codeAnswer()],
    });
    const result = await probeModel(provider, MODEL, null, { now: clock.now, timeoutMs: 1000 });
    expect(result.chat).toMatchObject({ status: 'unreliable', passes: 1 });
    expect(result.chat.failures).toEqual(['rate-limit', 'server']);
  });

  it('runs the chat probe first and then the tool-use probe, each the given number of times', async () => {
    const clock = makeClock();
    const provider = fakeProvider(clock, {
      chat: [chatPass()],
      step1: [lookupCall()],
      step2: [codeAnswer()],
    });
    const result = await probeModel(provider, MODEL, null, {
      runs: 2,
      now: clock.now,
      timeoutMs: 1000,
    });
    expect(result.chat.runs).toBe(2);
    expect(result.toolUse.runs).toBe(2);
    // Chat requests have no tools; the tool-use runs send one tool request, then a second.
    expect(provider.requests.map((r) => r.tools.length)).toEqual([0, 0, 1, 1, 1, 1]);
  });

  it('rejects a run count below 1', async () => {
    const clock = makeClock();
    const provider = fakeProvider(clock, { chat: [chatPass()] });
    await expect(probeModel(provider, MODEL, null, { runs: 0, now: clock.now })).rejects.toThrow(
      RangeError,
    );
  });
});

describe('probe timing with a fake clock', () => {
  it('takes latency from the first event and speed from usage over the stream time', async () => {
    // Each event arrives 100 ms after the last. The first event is at 100 ms and the last at
    // 300 ms, so the stream time is 200 ms; 10 output tokens give 50 tok/s.
    const clock = makeClock();
    const provider = fakeProvider(clock, { chat: [chatPass(100)] });
    const result = await probeModel(provider, MODEL, null, {
      runs: 1,
      now: clock.now,
      timeoutMs: 1000,
    });
    expect(result.chat.latencyMs).toBe(100);
    expect(result.chat.tokensPerSecond).toBe(50);
    expect(result.tokensPerSecond).toBe(50);
  });

  it('takes the median latency over runs, for odd and even counts', async () => {
    const odd = makeClock();
    const oddProvider = fakeProvider(odd, { chat: [chatPass(100), chatPass(300), chatPass(200)] });
    const oddResult = await probeModel(oddProvider, MODEL, null, {
      now: odd.now,
      timeoutMs: 1000,
    });
    expect(oddResult.chat.latencyMs).toBe(200);
    // Speeds are 50, 16.7 and 25 tok/s: the median is 25.
    expect(oddResult.chat.tokensPerSecond).toBe(25);

    const even = makeClock();
    const evenProvider = fakeProvider(even, {
      chat: [chatPass(100), chatPass(200), chatPass(300), chatPass(400)],
    });
    const evenResult = await probeModel(evenProvider, MODEL, null, {
      runs: 4,
      now: even.now,
      timeoutMs: 1000,
    });
    expect(evenResult.chat.latencyMs).toBe(250);
    // Speeds are 50, 25, 16.67 and 12.5: the mean of the middle two, 20.83, rounds to 20.8.
    expect(evenResult.chat.tokensPerSecond).toBe(20.8);
  });

  it('gives a null speed when a run has no usage event', async () => {
    const clock = makeClock();
    const noUsage = events(
      [
        { type: 'text', text: 'PROBE-OK' },
        { type: 'done', stopReason: 'end' },
      ],
      100,
    );
    const provider = fakeProvider(clock, { chat: [noUsage] });
    const result = await probeModel(provider, MODEL, null, {
      runs: 2,
      now: clock.now,
      timeoutMs: 1000,
    });
    expect(result.chat).toMatchObject({ status: 'passed', latencyMs: 100, tokensPerSecond: null });
    expect(result.tokensPerSecond).toBeNull();
  });

  it('gives a null latency when a run gets no event at all', async () => {
    const clock = makeClock();
    const provider = fakeProvider(clock, { chat: [throws(new ProviderError('network'))] });
    const result = await probeModel(provider, MODEL, null, {
      runs: 1,
      now: clock.now,
      timeoutMs: 1000,
    });
    expect(result.chat).toMatchObject({ latencyMs: null, tokensPerSecond: null });
    expect(result.chat.failures).toEqual(['network']);
  });
});

describe('probe timeouts and caller abort', () => {
  it('counts a run that outlives the request timeout as a timeout failure', async () => {
    const clock = makeClock();
    const provider = fakeProvider(clock, { chat: [HANG], step1: [HANG] });
    const result = await probeModel(provider, MODEL, null, {
      runs: 2,
      now: clock.now,
      timeoutMs: 20,
    });
    expect(result.chat).toMatchObject({ status: 'failed', failures: ['timeout', 'timeout'] });
    expect(result.toolUse).toMatchObject({ status: 'failed', failures: ['timeout', 'timeout'] });
  });

  it('rethrows a caller abort as ProviderError aborted and returns no partial result', async () => {
    const clock = makeClock();
    const provider = fakeProvider(clock, { chat: [HANG] });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5);
    const error = await caught(() =>
      probeModel(provider, MODEL, null, {
        runs: 3,
        now: clock.now,
        timeoutMs: 5000,
        signal: controller.signal,
      }),
    );
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ kind: 'aborted' });
  });

  it('throws aborted at once when the caller signal is already aborted', async () => {
    const clock = makeClock();
    const provider = fakeProvider(clock, { chat: [chatPass()] });
    const controller = new AbortController();
    controller.abort();
    const error = await caught(() =>
      probeModel(provider, MODEL, null, { now: clock.now, signal: controller.signal }),
    );
    expect(error).toMatchObject({ kind: 'aborted' });
    expect(provider.requests).toHaveLength(0);
  });
});

describe('listServerModels', () => {
  it('returns the models and the round trip in whole ms', async () => {
    const clock = makeClock();
    const provider = fakeProvider(
      clock,
      {},
      {
        kind: 'models',
        models: [{ id: 'a', contextWindow: 8192 }],
        gapMs: 42.4,
      },
    );
    const listing = await listServerModels(provider, { now: clock.now, timeoutMs: 1000 });
    expect(listing).toEqual({
      ok: true,
      latencyMs: 42,
      models: [{ id: 'a', contextWindow: 8192 }],
    });
  });

  it('gives ok false with the kind of a ProviderError', async () => {
    const clock = makeClock();
    const provider = fakeProvider(
      clock,
      {},
      { kind: 'throw', error: new ProviderError('auth', 401) },
    );
    const listing = await listServerModels(provider, { now: clock.now, timeoutMs: 1000 });
    expect(listing).toEqual({ ok: false, latencyMs: 0, failure: 'auth' });
  });

  it('gives ok false with timeout when the listing outlives the timeout', async () => {
    const clock = makeClock();
    const provider = fakeProvider(clock, {}, { kind: 'hang' });
    const listing = await listServerModels(provider, { now: clock.now, timeoutMs: 20 });
    expect(listing).toMatchObject({ ok: false, failure: 'timeout' });
  });

  it('rethrows a caller abort as ProviderError aborted', async () => {
    const clock = makeClock();
    const provider = fakeProvider(clock, {}, { kind: 'hang' });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5);
    const error = await caught(() =>
      listServerModels(provider, { now: clock.now, timeoutMs: 5000, signal: controller.signal }),
    );
    expect(error).toMatchObject({ kind: 'aborted' });
  });
});

describe('results are plain data', () => {
  it('survives a JSON round trip unchanged', async () => {
    const clock = makeClock();
    const provider = fakeProvider(clock, {
      chat: [chatPass(), chatMissing()],
      step1: [lookupCall(), events([{ type: 'text', text: 'no tool' }])],
      step2: [codeAnswer()],
    });
    const result = await probeModel(provider, MODEL, 4096, { now: clock.now, timeoutMs: 1000 });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});
