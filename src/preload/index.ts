import { contextBridge, ipcRenderer } from 'electron';
import { BRIDGE_GLOBAL_NAME, IPC_CHANNELS, type HarnessBridge } from '../shared/bridge';

// The only object the renderer can reach. `ipcRenderer` stays inside this
// module: it is used to make the call, never exposed.
const harness: HarnessBridge = {
  getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.getVersion) as Promise<string>,
};

contextBridge.exposeInMainWorld(BRIDGE_GLOBAL_NAME, harness);
