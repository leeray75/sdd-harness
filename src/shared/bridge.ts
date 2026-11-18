// Contract between the preload bridge and the main process. Shared by both
// sides, so it must not import Node, Electron or DOM APIs.

/** Name of the single global the preload exposes to the renderer. */
export const BRIDGE_GLOBAL_NAME = 'harness' as const;

/** IPC channel names. Each one must also have a handler in src/main. */
export const IPC_CHANNELS = {
  getVersion: 'harness:get-version',
  windowMinimize: 'harness:window-minimize',
  windowToggleMaximize: 'harness:window-toggle-maximize',
  windowClose: 'harness:window-close',
  windowIsMaximized: 'harness:window-is-maximized',
} as const;

/** Event channel names. Main sends these to the renderer; each one must also be sent from src/main. */
export const EVENT_CHANNELS = {
  windowMaximizedChanged: 'harness:window-maximized-changed',
} as const;

/** The operating system the renderer runs on. Anything else is reported as 'win32'. */
export type HarnessPlatform = 'win32' | 'darwin' | 'linux';

/** Maps a raw `process.platform` value to a HarnessPlatform. Any other value becomes 'win32'. */
export function toHarnessPlatform(raw: string): HarnessPlatform {
  return raw === 'darwin' || raw === 'linux' ? raw : 'win32';
}

/** Caption controls for the app's own main window. */
export interface HarnessWindowControls {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  isMaximized(): Promise<boolean>;
  /** Calls `cb` with the new maximized state. Returns a function that removes this listener. */
  onMaximizedChange(cb: (maximized: boolean) => void): () => void;
}

/** Everything the renderer can call. Later subtasks add members here. */
export interface HarnessBridge {
  getVersion(): Promise<string>;
  platform: HarnessPlatform;
  window: HarnessWindowControls;
}
