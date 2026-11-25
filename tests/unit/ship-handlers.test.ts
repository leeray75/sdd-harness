import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHumanActionChannel, type HumanActionSender } from '../../src/main/human/channel';
import type { GestureTracker } from '../../src/main/human/gesture';
import { createShipHandlers } from '../../src/main/human/ship-handlers';
import type { Logger } from '../../src/main/log';
import * as ship from '../../src/main/workflow/ship';
import { SHIP_REASONS } from '../../src/main/workflow/ship';
import type { NodeId } from '../../src/shared/workflow';

// The ship functions are wrapped, not replaced: a call runs the real code unless a test queues a
// result. The success path of the real steps is covered in ship.test.ts (on temp git repos).
vi.mock('../../src/main/workflow/ship', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/main/workflow/ship')>();
  return {
    ...actual,
    approveResult: vi.fn(actual.approveResult),
    markDone: vi.fn(actual.markDone),
  };
});

const TRUSTED: HumanActionSender = { senderId: 1, frameUrl: 'app://page' };
const FEATURE = 'feat';

let root: string;

beforeEach(() => {
  // An empty folder: no docs/specs, so a real call refuses on the folder before any git runs.
  root = mkdtempSync(join(tmpdir(), 'sdd-ship-handlers-'));
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function handlersWith(
  overrides: {
    onLockChanged?: () => unknown;
    controllerNode?: (feature: string) => NodeId | null;
  } = {},
) {
  return createShipHandlers({
    root,
    onLockChanged: overrides.onLockChanged ?? (() => undefined),
    controllerNode: overrides.controllerNode ?? (() => null),
  });
}

describe('ship handlers: refusals', () => {
  it('refuses with code refused and the fixed reason when the feature folder is missing', async () => {
    const handlers = handlersWith();
    const request = { action: 'approve-result' as const, feature: FEATURE };
    expect(await handlers['approve-result'](request)).toEqual({
      ok: false,
      code: 'refused',
      reason: SHIP_REASONS.folder,
    });
    expect(await handlers['mark-done']({ action: 'mark-done', feature: FEATURE })).toEqual({
      ok: false,
      code: 'refused',
      reason: SHIP_REASONS.folder,
    });
  });

  it('turns a thrown error from the controller into a refusal that echoes nothing', async () => {
    const handlers = handlersWith({
      controllerNode: () => {
        throw new Error('SECRET-PATH /home/x');
      },
    });
    const result = await handlers['approve-result']({ action: 'approve-result', feature: FEATURE });
    expect(result).toEqual({ ok: false, code: 'refused', reason: SHIP_REASONS.failed });
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });

  it('turns an unexpected rejection of a ship step into a refusal', async () => {
    vi.mocked(ship.markDone).mockRejectedValueOnce(new Error('boom'));
    const handlers = handlersWith();
    expect(await handlers['mark-done']({ action: 'mark-done', feature: FEATURE })).toEqual({
      ok: false,
      code: 'refused',
      reason: 'the action failed',
    });
  });

  it('refuses while the feature controller is not at build-done, and asks for that feature', async () => {
    const controllerNode = vi.fn((): NodeId => 'implementing');
    const handlers = handlersWith({ controllerNode });
    expect(
      await handlers['approve-result']({ action: 'approve-result', feature: FEATURE }),
    ).toEqual({ ok: false, code: 'refused', reason: SHIP_REASONS.buildRunning });
    expect(controllerNode).toHaveBeenCalledWith(FEATURE);
  });
});

describe('ship handlers: the lock', () => {
  it('calls onLockChanged after a successful change', async () => {
    vi.mocked(ship.approveResult).mockResolvedValueOnce({ ok: true });
    const onLockChanged = vi.fn(() => undefined);
    const handlers = handlersWith({ onLockChanged });
    expect(
      await handlers['approve-result']({ action: 'approve-result', feature: FEATURE }),
    ).toEqual({ ok: true });
    expect(onLockChanged).toHaveBeenCalledTimes(1);
  });

  it('calls onLockChanged after every ship call, refused or not (revision 1)', async () => {
    vi.mocked(ship.approveResult).mockResolvedValueOnce({ ok: true });
    const onLockChanged = vi.fn(() => undefined);
    const handlers = handlersWith({ onLockChanged });
    // A refusal (no feature folder) first, then a success: one call each.
    expect(await handlers['mark-done']({ action: 'mark-done', feature: FEATURE })).toEqual({
      ok: false,
      code: 'refused',
      reason: SHIP_REASONS.folder,
    });
    expect(onLockChanged).toHaveBeenCalledTimes(1);
    expect(
      await handlers['approve-result']({ action: 'approve-result', feature: FEATURE }),
    ).toEqual({ ok: true });
    expect(onLockChanged).toHaveBeenCalledTimes(2);
  });

  it('ignores an error from onLockChanged', async () => {
    const onLockChanged = vi.fn(() => {
      throw new Error('watch failed');
    });
    const handlers = handlersWith({ onLockChanged });
    const result = await handlers['mark-done']({ action: 'mark-done', feature: FEATURE });
    expect(result).toEqual({ ok: false, code: 'refused', reason: SHIP_REASONS.folder });
    expect(onLockChanged).toHaveBeenCalledTimes(1);
  });
});

describe('ship handlers through the human-only channel (AC1)', () => {
  /** A tracker whose next consume answer the test sets; each consume clears the gesture. */
  function gestureTracker() {
    let gesture = false;
    const tracker: GestureTracker = {
      record: () => undefined,
      consume: () => {
        const was = gesture;
        gesture = false;
        return was;
      },
    };
    return { tracker, press: () => (gesture = true) };
  }

  function channelWith(trusted: boolean, tracker: GestureTracker) {
    const info = vi.fn<(message: string) => void>();
    const error = vi.fn<(message: string) => void>();
    const logger: Logger = { info, error };
    const channel = createHumanActionChannel({ isTrustedSender: () => trusted, tracker, logger });
    return { channel, info, error };
  }

  it('reaches approve-result and mark-done with a gesture, and refuses without one', async () => {
    const { tracker, press } = gestureTracker();
    const { channel } = channelWith(true, tracker);
    const handlers = handlersWith({ controllerNode: () => 'implementing' });
    channel.register('approve-result', handlers['approve-result']);
    channel.register('mark-done', handlers['mark-done']);

    const request = { action: 'approve-result', feature: FEATURE };
    expect(await channel.handle(TRUSTED, request)).toEqual({
      ok: false,
      code: 'no-gesture',
      reason: expect.any(String),
    });
    expect(ship.approveResult).not.toHaveBeenCalled();

    press();
    expect(await channel.handle(TRUSTED, request)).toEqual({
      ok: false,
      code: 'refused',
      reason: SHIP_REASONS.buildRunning,
    });
    expect(ship.approveResult).toHaveBeenCalledTimes(1);

    press();
    expect(await channel.handle(TRUSTED, { action: 'mark-done', feature: FEATURE })).toEqual({
      ok: false,
      code: 'refused',
      reason: SHIP_REASONS.buildRunning,
    });
  });

  it('refuses a call from an untrusted sender before any handler runs', async () => {
    const { tracker, press } = gestureTracker();
    const { channel } = channelWith(false, tracker);
    const handlers = handlersWith();
    channel.register('approve-result', handlers['approve-result']);
    press();
    const result = await channel.handle(TRUSTED, { action: 'approve-result', feature: FEATURE });
    expect(result).toMatchObject({ ok: false, code: 'untrusted-sender' });
    expect(ship.approveResult).not.toHaveBeenCalled();
  });

  it('logs one decision line for an accepted approve-result', async () => {
    vi.mocked(ship.approveResult).mockResolvedValueOnce({ ok: true });
    const { tracker, press } = gestureTracker();
    const { channel, info, error } = channelWith(true, tracker);
    const handlers = handlersWith();
    channel.register('approve-result', handlers['approve-result']);
    press();
    expect(await channel.handle(TRUSTED, { action: 'approve-result', feature: FEATURE })).toEqual({
      ok: true,
    });
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(
      `human action approve-result: accepted (ok) feature=${FEATURE}`,
    );
    expect(error).not.toHaveBeenCalled();
  });
});
