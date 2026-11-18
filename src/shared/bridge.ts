// Contract between the preload bridge and the main process. Shared by both
// sides, so it must not import Node, Electron or DOM APIs.

/** Name of the single global the preload exposes to the renderer. */
export const BRIDGE_GLOBAL_NAME = 'harness' as const;

/** IPC channel names. Each one must also have a handler in src/main. */
export const IPC_CHANNELS = {
  getVersion: 'harness:get-version',
} as const;

/** Everything the renderer can call. Later subtasks add members here. */
export interface HarnessBridge {
  getVersion(): Promise<string>;
}
