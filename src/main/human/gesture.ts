// Gesture tracker for the human-only channel (D33). Pure: no Electron import, and the clock is
// injected, so tests can drive it. Main feeds it the input events of the main window. A request
// is accepted only if a gesture was recorded within the window and no request has used it yet.
//
// Only real input reaches this tracker. An event made in page script (dispatchEvent, click())
// never goes through the window's input pipeline, so it is never recorded.

/** How long after a gesture a human-only request may still use it, in milliseconds. */
export const GESTURE_WINDOW_MS = 1000;

/** The fields of an `input-event` that the tracker reads. Electron's event satisfies it. */
export interface GestureInput {
  type: string;
  button?: string;
  key?: string;
  isAutoRepeat?: boolean;
}

export interface GestureTracker {
  /** Records the input if it is a gesture. Other inputs are ignored. */
  record(input: GestureInput): void;
  /** True only if a recorded gesture is at most the window old. Clears the gesture either way. */
  consume(): boolean;
}

export interface GestureTrackerOptions {
  /** The clock, in milliseconds. Must not run backwards. */
  now: () => number;
  /** The window, in milliseconds. Defaults to GESTURE_WINDOW_MS. */
  windowMs?: number;
}

/** A left-button press, or an Enter or Space key press that is not an auto-repeat. */
function isGesture(input: GestureInput): boolean {
  if (input.type === 'mouseDown') {
    return input.button === 'left';
  }
  if (input.type === 'keyDown') {
    return (input.key === 'Enter' || input.key === ' ') && input.isAutoRepeat !== true;
  }
  return false;
}

export function createGestureTracker(options: GestureTrackerOptions): GestureTracker {
  const windowMs = options.windowMs ?? GESTURE_WINDOW_MS;
  // The time of the latest unused gesture, or null when there is none.
  let recordedAt: number | null = null;

  return {
    record(input) {
      if (isGesture(input)) {
        recordedAt = options.now();
      }
    },
    consume() {
      if (recordedAt === null) {
        return false;
      }
      const at = recordedAt;
      recordedAt = null;
      return options.now() - at <= windowMs;
    },
  };
}
