import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { IPC_CHANNELS } from '../shared/bridge';
import { isAllowedAppUrl, isTrustedSender } from './security';

// electron-vite sets ELECTRON_RENDERER_URL only under `electron-vite dev`.
// Otherwise the app loads the built page from disk.
const appUrl = process.env['ELECTRON_RENDERER_URL']
  ? process.env['ELECTRON_RENDERER_URL']
  : pathToFileURL(join(__dirname, '../renderer/index.html')).href;

let mainWindow: BrowserWindow | null = null;

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    title: 'SDD Harness',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  // No new windows, popups or webviews.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Only the app's own page may be navigated to.
  const blockForeignNavigation = (event: { preventDefault: () => void }, url: string) => {
    if (!isAllowedAppUrl(url, appUrl)) {
      event.preventDefault();
    }
  };
  win.webContents.on('will-navigate', blockForeignNavigation);
  win.webContents.on('will-redirect', blockForeignNavigation);

  void win.loadURL(appUrl);
  win.on('closed', () => {
    mainWindow = null;
  });
  return win;
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getVersion, (event: IpcMainInvokeEvent) => {
    const trusted = isTrustedSender({
      senderId: event.sender.id,
      expectedId: mainWindow?.webContents.id,
      frameUrl: event.senderFrame?.url,
      appUrl,
    });
    if (!trusted) {
      throw new Error('Rejected IPC call from an untrusted sender');
    }
    return app.getVersion();
  });
}

void app.whenReady().then(() => {
  registerIpcHandlers();
  mainWindow = createMainWindow();

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
