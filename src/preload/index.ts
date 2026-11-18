import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  BRIDGE_GLOBAL_NAME,
  EVENT_CHANNELS,
  IPC_CHANNELS,
  toHarnessPlatform,
  type HarnessBridge,
} from '../shared/bridge';

// The only object the renderer can reach. `ipcRenderer` stays inside this
// module: it is used to make the call, never exposed.
const harness: HarnessBridge = {
  getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.getVersion) as Promise<string>,
  platform: toHarnessPlatform(process.platform),
  window: {
    minimize: () => ipcRenderer.invoke(IPC_CHANNELS.windowMinimize) as Promise<void>,
    toggleMaximize: () => ipcRenderer.invoke(IPC_CHANNELS.windowToggleMaximize) as Promise<void>,
    close: () => ipcRenderer.invoke(IPC_CHANNELS.windowClose) as Promise<void>,
    isMaximized: () => ipcRenderer.invoke(IPC_CHANNELS.windowIsMaximized) as Promise<boolean>,
    onMaximizedChange: (cb: (maximized: boolean) => void) => {
      // The callback gets the boolean only, never the IPC event object.
      const listener = (_event: IpcRendererEvent, maximized: unknown) => {
        cb(maximized === true);
      };
      ipcRenderer.on(EVENT_CHANNELS.windowMaximizedChanged, listener);
      return () => {
        ipcRenderer.removeListener(EVENT_CHANNELS.windowMaximizedChanged, listener);
      };
    },
  },
};

contextBridge.exposeInMainWorld(BRIDGE_GLOBAL_NAME, harness);
