import { describe, expect, it, vi } from 'vitest';
import {
  createHumanActionChannel,
  type HumanActionChannelDeps,
  type HumanActionHandler,
  type HumanActionSender,
} from '../../src/main/human/channel';
import { createGestureTracker, type GestureTracker } from '../../src/main/human/gesture';
import { HUMAN_ACTION_IDS, type HumanActionResult } from '../../src/shared/human-actions';

const TRUSTED: HumanActionSender = { senderId: 1, frameUrl: 'app://page' };
const REQUEST = { action: 'approve-spec', project: 'dev', feature: 'demo' };
const SECRET = 'SECRET-VALUE-987';

/** A tracker whose consume answer the test sets. Records how often it was consumed. */
function fakeTracker(answer: boolean) {
  const consume = vi.fn<() => boolean>(() => answer);
  const tracker: GestureTracker = { record: vi.fn(), consume };
  return { tracker, consume };
}

/** A tracker with a clock that stays at 0, so a recorded gesture is always fresh. */
function realTracker(): GestureTracker {
  return createGestureTracker({ now: () => 0 });
}

function makeChannel(overrides: Partial<HumanActionChannelDeps> = {}) {
  const info = vi.fn<(message: string) => void>();
  const error = vi.fn<(message: string) => void>();
  const { tracker, consume } = fakeTracker(true);
  const deps: HumanActionChannelDeps = {
    isTrustedSender: () => true,
    tracker,
    logger: { info, error },
    ...overrides,
  };
  return { channel: createHumanActionChannel(deps), info, error, consume };
}

/** Every line logged, from both streams, in order. */
function lines(info: { mock: { calls: unknown[][] } }, error: { mock: { calls: unknown[][] } }) {
  return [
    ...info.mock.calls.map((call) => ({ level: 'info', text: String(call[0]) })),
    ...error.mock.calls.map((call) => ({ level: 'error', text: String(call[0]) })),
  ];
}

describe('the refusal codes', () => {
  it('refuses a call from an untrusted sender', async () => {
    const { channel } = makeChannel({ isTrustedSender: () => false });
    expect(await channel.handle(TRUSTED, REQUEST)).toEqual({
      ok: false,
      code: 'untrusted-sender',
      reason: 'the call did not come from the app window',
    });
  });

  it('refuses an invalid request with the guard reason', async () => {
    const { channel } = makeChannel();
    const result = await channel.handle(TRUSTED, { action: 'approve-spec' });
    expect(result).toEqual({
      ok: false,
      code: 'invalid',
      reason: 'the request must have exactly the fields action, project and feature',
    });
  });

  it('refuses a valid request with no gesture', async () => {
    const { channel, consume } = makeChannel();
    consume.mockReturnValueOnce(false);
    expect(await channel.handle(TRUSTED, REQUEST)).toEqual({
      ok: false,
      code: 'no-gesture',
      reason: 'no user gesture in the app window just before the call',
    });
  });

  it('refuses a request with a gesture and no handler as not-available', async () => {
    const { channel } = makeChannel();
    expect(await channel.handle(TRUSTED, REQUEST)).toEqual({
      ok: false,
      code: 'not-available',
      reason: 'no handler is registered for this action',
    });
  });
});

describe('the order of the checks', () => {
  it('checks the sender before the guard', async () => {
    const { channel, consume } = makeChannel({ isTrustedSender: () => false });
    const result = await channel.handle(TRUSTED, { action: 'nope' });
    expect(result).toMatchObject({ code: 'untrusted-sender' });
    expect(consume).not.toHaveBeenCalled();
  });

  it('checks the guard before the gesture', async () => {
    const { channel, consume } = makeChannel();
    const result = await channel.handle(TRUSTED, {
      action: 'nope',
      project: 'dev',
      feature: 'demo',
    });
    expect(result).toMatchObject({ code: 'invalid' });
    expect(consume).not.toHaveBeenCalled();
  });

  it('checks the gesture before the registry', async () => {
    const { channel, consume } = makeChannel();
    consume.mockReturnValueOnce(false);
    const handler = vi.fn<HumanActionHandler>(() => ({ ok: true }));
    channel.register('approve-spec', handler);
    expect(await channel.handle(TRUSTED, REQUEST)).toMatchObject({ code: 'no-gesture' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('an untrusted call does not consume a gesture', async () => {
    const tracker = realTracker();
    tracker.record({ type: 'mouseDown', button: 'left' });
    const handler = vi.fn<HumanActionHandler>(() => ({ ok: true }));
    const { channel } = makeChannel({ isTrustedSender: (s) => s.senderId === 1, tracker });
    channel.register('approve-spec', handler);

    const refused = await channel.handle({ senderId: 2, frameUrl: 'app://page' }, REQUEST);
    expect(refused).toMatchObject({ code: 'untrusted-sender' });
    expect(await channel.handle(TRUSTED, REQUEST)).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('an invalid call does not consume a gesture', async () => {
    const tracker = realTracker();
    tracker.record({ type: 'mouseDown', button: 'left' });
    const handler = vi.fn<HumanActionHandler>(() => ({ ok: true }));
    const { channel } = makeChannel({ tracker });
    channel.register('approve-spec', handler);

    expect(
      await channel.handle(TRUSTED, {
        action: 'approve-spec',
        project: 'dev',
        feature: 'Bad Slug',
      }),
    ).toMatchObject({
      code: 'invalid',
    });
    expect(await channel.handle(TRUSTED, REQUEST)).toEqual({ ok: true });
  });

  it('a request with no handler still uses the gesture', async () => {
    const tracker = realTracker();
    tracker.record({ type: 'mouseDown', button: 'left' });
    const { channel } = makeChannel({ tracker });
    expect(await channel.handle(TRUSTED, REQUEST)).toMatchObject({ code: 'not-available' });
    expect(await channel.handle(TRUSTED, REQUEST)).toMatchObject({ code: 'no-gesture' });
  });
});

describe('a registered handler', () => {
  it('is called with the request and its result is returned', async () => {
    const { channel } = makeChannel();
    const handler = vi.fn<HumanActionHandler>(() => ({ ok: true }));
    channel.register('approve-spec', handler);
    expect(await channel.handle(TRUSTED, REQUEST)).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledWith({
      action: 'approve-spec',
      project: 'dev',
      feature: 'demo',
    });
  });

  it('may answer asynchronously and its refusal is returned as it is', async () => {
    const { channel } = makeChannel();
    const refusal: HumanActionResult = { ok: false, code: 'not-available', reason: 'later' };
    channel.register('approve-spec', async () => refusal);
    expect(await channel.handle(TRUSTED, REQUEST)).toEqual(refusal);
  });

  it('is only called for its own action', async () => {
    const { channel } = makeChannel();
    const other = vi.fn<HumanActionHandler>(() => ({ ok: true }));
    channel.register('mark-done', other);
    expect(await channel.handle(TRUSTED, REQUEST)).toMatchObject({ code: 'not-available' });
    expect(other).not.toHaveBeenCalled();
  });

  it('turns a throw into not-available with the fixed reason, and logs no message', async () => {
    const { channel, info, error } = makeChannel();
    channel.register('approve-spec', () => {
      throw new Error(`failed with ${SECRET}`);
    });
    expect(await channel.handle(TRUSTED, REQUEST)).toEqual({
      ok: false,
      code: 'not-available',
      reason: 'the action failed',
    });
    const logged = lines(info, error);
    expect(logged.map((line) => line.text)).toEqual([
      'human action approve-spec: handler threw (Error)',
      'human action approve-spec: refused (not-available) feature=demo project=dev',
    ]);
    expect(logged.map((line) => line.text).join('\n')).not.toContain(SECRET);
  });

  it('turns a non-Error throw into not-available too', async () => {
    const { channel, error } = makeChannel();
    channel.register('approve-spec', () => {
      throw SECRET;
    });
    expect(await channel.handle(TRUSTED, REQUEST)).toMatchObject({ code: 'not-available' });
    expect(error.mock.calls.map((call) => String(call[0])).join('\n')).not.toContain(SECRET);
  });

  it('refuses a second registration for the same action', () => {
    const { channel } = makeChannel();
    channel.register('approve-spec', () => ({ ok: true }));
    expect(() => channel.register('approve-spec', () => ({ ok: true }))).toThrow(
      'a handler is already registered for approve-spec',
    );
  });

  it('allows a registration for each different action', () => {
    const { channel } = makeChannel();
    for (const action of HUMAN_ACTION_IDS) {
      expect(() => channel.register(action, () => ({ ok: true }))).not.toThrow();
    }
  });
});

describe('the log: one line per call', () => {
  it('logs the exact accepted line with the feature', async () => {
    const { channel, info, error } = makeChannel();
    channel.register('approve-spec', () => ({ ok: true }));
    await channel.handle(TRUSTED, REQUEST);
    expect(lines(info, error)).toEqual([
      { level: 'info', text: 'human action approve-spec: accepted (ok) feature=demo project=dev' },
    ]);
  });

  it('logs the exact no-gesture line', async () => {
    const { channel, info, error, consume } = makeChannel();
    consume.mockReturnValueOnce(false);
    await channel.handle(TRUSTED, REQUEST);
    expect(lines(info, error)).toEqual([
      {
        level: 'error',
        text: 'human action approve-spec: refused (no-gesture) feature=demo project=dev',
      },
    ]);
  });

  it('logs the exact not-available line', async () => {
    const { channel, info, error } = makeChannel();
    await channel.handle(TRUSTED, { action: 'mark-done', project: 'dev', feature: 'p2-x' });
    expect(lines(info, error)).toEqual([
      {
        level: 'error',
        text: 'human action mark-done: refused (not-available) feature=p2-x project=dev',
      },
    ]);
  });

  it('logs the exact invalid line with no feature and no raw value', async () => {
    const { channel, info, error } = makeChannel();
    await channel.handle(TRUSTED, { action: SECRET, project: 'dev', feature: 'demo' });
    expect(lines(info, error)).toEqual([
      { level: 'error', text: 'human action invalid: refused (invalid)' },
    ]);
  });

  it('logs the exact untrusted-sender line and never reads the request', async () => {
    const { channel, info, error, consume } = makeChannel({ isTrustedSender: () => false });
    await channel.handle(TRUSTED, { action: 'approve-spec', project: 'dev', feature: SECRET });
    expect(lines(info, error)).toEqual([
      { level: 'error', text: 'human action invalid: refused (untrusted-sender)' },
    ]);
    expect(consume).not.toHaveBeenCalled();
  });

  it('never logs a raw value from a refused request', async () => {
    const { channel, info, error } = makeChannel();
    await channel.handle(TRUSTED, {
      action: 'approve-spec',
      project: 'dev',
      feature: `${SECRET}/../x`,
    });
    await channel.handle(TRUSTED, { [SECRET]: 1 });
    const text = lines(info, error)
      .map((line) => line.text)
      .join('\n');
    expect(text).not.toContain(SECRET);
  });

  it('logs one line for each call, however it ends', async () => {
    const { channel, info, error, consume } = makeChannel();
    channel.register('approve-spec', () => ({ ok: true }));
    await channel.handle(TRUSTED, REQUEST);
    consume.mockReturnValueOnce(false);
    await channel.handle(TRUSTED, REQUEST);
    await channel.handle(TRUSTED, 'bad');
    await channel.handle(TRUSTED, { action: 'mark-done', project: 'dev', feature: 'demo' });
    expect(info.mock.calls.length + error.mock.calls.length).toBe(4);
  });
});
