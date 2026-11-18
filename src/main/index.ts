import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EVENT_CHANNELS, IPC_CHANNELS } from '../shared/bridge';
import { startAgentHost } from './agent/host';
import { applyNavigationGuards, isTrustedSender } from './security';

// electron-vite sets ELECTRON_RENDERER_URL only under `electron-vite dev`.
// Otherwise the app loads the built page from disk.
const appUrl = process.env['ELECTRON_RENDERER_URL']
  ? process.env['ELECTRON_RENDERER_URL']
  : pathToFileURL(join(__dirname, '../renderer/index.html')).href;

let mainWindow: BrowserWindow | null = null;

// macOS keeps its native traffic lights, drawn inside the 40px title bar.
// Windows and Linux get a frameless window and draw their own caption buttons.
const isMac = process.platform === 'darwin';

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    title: 'SDD Harness',
    backgroundColor: '#0B0D10',
    ...(isMac
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 13 } }
      : { frame: false }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  applyNavigationGuards(win.webContents, appUrl);

  // Tell the renderer whenever the maximized state may have changed.
  const sendMaximizedChanged = () => {
    if (!win.isDestroyed()) {
      win.webContents.send(EVENT_CHANNELS.windowMaximizedChanged, win.isMaximized());
    }
  };
  win.on('maximize', sendMaximizedChanged);
  win.on('unmaximize', sendMaximizedChanged);
  win.on('enter-full-screen', sendMaximizedChanged);
  win.on('leave-full-screen', sendMaximizedChanged);

  void win.loadURL(appUrl);
  win.on('closed', () => {
    mainWindow = null;
  });
  return win;
}

/** Throws unless the IPC call came from the app's own window and page. */
function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const trusted = isTrustedSender({
    senderId: event.sender.id,
    expectedId: mainWindow?.webContents.id,
    frameUrl: event.senderFrame?.url,
    appUrl,
  });
  if (!trusted) {
    throw new Error('Rejected IPC call from an untrusted sender');
  }
}

/**
 * Checks the sender, then returns the main window to act on. Window calls never
 * act on a window found from the event: only on `mainWindow`.
 */
function trustedMainWindow(event: IpcMainInvokeEvent): BrowserWindow {
  assertTrustedSender(event);
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('No main window to act on');
  }
  return mainWindow;
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getVersion, (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event);
    return app.getVersion();
  });

  ipcMain.handle(IPC_CHANNELS.windowMinimize, (event: IpcMainInvokeEvent) => {
    trustedMainWindow(event).minimize();
  });

  ipcMain.handle(IPC_CHANNELS.windowToggleMaximize, (event: IpcMainInvokeEvent) => {
    const win = trustedMainWindow(event);
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });

  ipcMain.handle(IPC_CHANNELS.windowClose, (event: IpcMainInvokeEvent) => {
    trustedMainWindow(event).close();
  });

  ipcMain.handle(IPC_CHANNELS.windowIsMaximized, (event: IpcMainInvokeEvent) => {
    return trustedMainWindow(event).isMaximized();
  });
}

void app.whenReady().then(() => {
  registerIpcHandlers();
  mainWindow = createMainWindow();
  startAgentHost();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
