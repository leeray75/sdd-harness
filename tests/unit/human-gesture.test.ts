import { describe, expect, it } from 'vitest';
import {
  createGestureTracker,
  GESTURE_WINDOW_MS,
  type GestureInput,
} from '../../src/main/human/gesture';

/** A tracker with a clock the test moves by hand. */
function clocked(windowMs?: number) {
  let now = 0;
  const tracker = createGestureTracker({
    now: () => now,
    ...(windowMs === undefined ? {} : { windowMs }),
  });
  return {
    tracker,
    at: (time: number) => {
      now = time;
    },
  };
}

const LEFT_DOWN: GestureInput = { type: 'mouseDown', button: 'left' };
const ENTER_DOWN: GestureInput = { type: 'keyDown', key: 'Enter', isAutoRepeat: false };
const SPACE_DOWN: GestureInput = { type: 'keyDown', key: ' ', isAutoRepeat: false };

describe('GESTURE_WINDOW_MS', () => {
  it('is one second', () => {
    expect(GESTURE_WINDOW_MS).toBe(1000);
  });
});

describe('record: accepted inputs', () => {
  it('records a left-button mouseDown', () => {
    const { tracker } = clocked();
    tracker.record(LEFT_DOWN);
    expect(tracker.consume()).toBe(true);
  });

  it('records an Enter keyDown', () => {
    const { tracker } = clocked();
    tracker.record(ENTER_DOWN);
    expect(tracker.consume()).toBe(true);
  });

  it('records a space keyDown', () => {
    const { tracker } = clocked();
    tracker.record(SPACE_DOWN);
    expect(tracker.consume()).toBe(true);
  });

  it('records a keyDown with no isAutoRepeat field', () => {
    const { tracker } = clocked();
    tracker.record({ type: 'keyDown', key: 'Enter' });
    expect(tracker.consume()).toBe(true);
  });
});

describe('record: ignored inputs', () => {
  it.each<[string, GestureInput]>([
    ['a mouseUp', { type: 'mouseUp', button: 'left' }],
    ['a mouseMove', { type: 'mouseMove' }],
    ['a mouseWheel', { type: 'mouseWheel' }],
    ['a right-button mouseDown', { type: 'mouseDown', button: 'right' }],
    ['a middle-button mouseDown', { type: 'mouseDown', button: 'middle' }],
    ['a mouseDown with no button', { type: 'mouseDown' }],
    ['a keyUp of Enter', { type: 'keyUp', key: 'Enter' }],
    ['a keyUp of space', { type: 'keyUp', key: ' ' }],
    ['a char event', { type: 'char', key: 'Enter' }],
    ['a keyDown of another key', { type: 'keyDown', key: 'a', isAutoRepeat: false }],
    ['a keyDown of Escape', { type: 'keyDown', key: 'Escape', isAutoRepeat: false }],
    ['an auto-repeat Enter', { type: 'keyDown', key: 'Enter', isAutoRepeat: true }],
    ['an auto-repeat space', { type: 'keyDown', key: ' ', isAutoRepeat: true }],
    ['an unknown type', { type: 'somethingNew', button: 'left' }],
  ])('ignores %s', (_name, input) => {
    const { tracker } = clocked();
    tracker.record(input);
    expect(tracker.consume()).toBe(false);
  });
});

describe('consume: the window', () => {
  it('accepts a gesture exactly one window old', () => {
    const { tracker, at } = clocked();
    at(100);
    tracker.record(LEFT_DOWN);
    at(100 + GESTURE_WINDOW_MS);
    expect(tracker.consume()).toBe(true);
  });

  it('refuses a gesture one millisecond older than the window', () => {
    const { tracker, at } = clocked();
    at(100);
    tracker.record(LEFT_DOWN);
    at(100 + GESTURE_WINDOW_MS + 1);
    expect(tracker.consume()).toBe(false);
  });

  it('accepts a gesture recorded at the same instant', () => {
    const { tracker, at } = clocked();
    at(5);
    tracker.record(ENTER_DOWN);
    expect(tracker.consume()).toBe(true);
  });

  it('refuses when nothing was recorded', () => {
    const { tracker } = clocked();
    expect(tracker.consume()).toBe(false);
  });

  it('uses a custom window', () => {
    const { tracker, at } = clocked(250);
    at(0);
    tracker.record(LEFT_DOWN);
    at(250);
    expect(tracker.consume()).toBe(true);

    at(1000);
    tracker.record(LEFT_DOWN);
    at(1251);
    expect(tracker.consume()).toBe(false);
  });
});

describe('consume: one use per gesture', () => {
  it('returns true once, then false until a new gesture', () => {
    const { tracker, at } = clocked();
    at(0);
    tracker.record(LEFT_DOWN);
    expect(tracker.consume()).toBe(true);
    expect(tracker.consume()).toBe(false);
    expect(tracker.consume()).toBe(false);
  });

  it('accepts a gesture recorded after a consume', () => {
    const { tracker, at } = clocked();
    at(0);
    tracker.record(LEFT_DOWN);
    expect(tracker.consume()).toBe(true);
    at(300);
    tracker.record(SPACE_DOWN);
    expect(tracker.consume()).toBe(true);
    expect(tracker.consume()).toBe(false);
  });

  it('clears an expired gesture so a later consume is false', () => {
    const { tracker, at } = clocked();
    at(0);
    tracker.record(LEFT_DOWN);
    at(5000);
    expect(tracker.consume()).toBe(false);
    expect(tracker.consume()).toBe(false);
  });

  it('a later gesture replaces an earlier one and restarts the window', () => {
    const { tracker, at } = clocked();
    at(0);
    tracker.record(LEFT_DOWN);
    at(900);
    tracker.record(ENTER_DOWN);
    at(1800);
    expect(tracker.consume()).toBe(true);
  });

  it('an ignored input does not clear or replace a recorded gesture', () => {
    const { tracker, at } = clocked();
    at(0);
    tracker.record(LEFT_DOWN);
    at(100);
    tracker.record({ type: 'mouseMove' });
    tracker.record({ type: 'keyDown', key: 'Enter', isAutoRepeat: true });
    expect(tracker.consume()).toBe(true);
  });
});
