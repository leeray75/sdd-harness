import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EVENT_CHANNELS, IPC_CHANNELS } from '../shared/bridge';
import { tokens } from '../shared/tokens';
import { startAgentHost } from './agent/host';
import { createHumanActionChannel } from './human/channel';
import { createGestureTracker } from './human/gesture';
import { log } from './log';
import {
  parseSecretsArgs,
  runSecretsCommand,
  type SecretsCommand,
  type SecretsOutcome,
} from './secrets/dev-mode';
import { createElectronSecretStore } from './secrets/electron';
import { readSecretFromPipe } from './secrets/pipe';
import { applyNavigationGuards, isTrustedSender } from './security';

// electron-vite sets ELECTRON_RENDERER_URL only under `electron-vite dev`.
// Otherwise the app loads the built page from disk.
const pageUrl = process.env['ELECTRON_RENDERER_URL']
  ? process.env['ELECTRON_RENDERER_URL']
  : pathToFileURL(join(__dirname, '../renderer/index.html')).href;

// The design gallery loads under `pnpm dev` or with HARNESS_GALLERY=1 (D21). The fragment is
// ignored by the navigation guards, so the app page stays the same page.
const showGallery =
  Boolean(process.env['ELECTRON_RENDERER_URL']) || process.env['HARNESS_GALLERY'] === '1';
const appUrl = showGallery ? `${pageUrl}#gallery` : pageUrl;

let mainWindow: BrowserWindow | null = null;

// One gesture tracker for the app (D33). The main window's input events feed it, and the
// human-only channel asks it whether a real click or key press came just before a request.
const gestureTracker = createGestureTracker({ now: () => performance.now() });

// The human-only channel (D33). No action handler is registered yet: Phase 3 adds them, so
// every request that passes the checks is answered `not-available` for now.
const humanActions = createHumanActionChannel({
  isTrustedSender: (sender) =>
    isTrustedSender({
      senderId: sender.senderId,
      expectedId: mainWindow?.webContents.id,
      frameUrl: sender.frameUrl,
      appUrl,
    }),
  tracker: gestureTracker,
  logger: log,
});

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
    backgroundColor: tokens.color['bg/titlebar'],
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

  // Real input to this window counts as a user gesture (D33). Page script cannot produce it.
  win.webContents.on('input-event', (_event, input) => {
    gestureTracker.record(input);
  });

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

  // The channel checks the sender, the request and the gesture itself, and logs each call (D33).
  ipcMain.handle(IPC_CHANNELS.humanAction, (event: IpcMainInvokeEvent, raw: unknown) => {
    return humanActions.handle(
      { senderId: event.sender.id, frameUrl: event.senderFrame?.url },
      raw,
    );
  });
}

/**
 * The dev-only secrets command (D25, AC12). Set only for an unpackaged run with the switches;
 * a packaged app ignores them.
 */
const secretsCommand: SecretsCommand | null = app.isPackaged
  ? null
  : parseSecretsArgs(process.argv);

/** Quits with the code once pending writes to stdout and stderr have gone out. */
function quitSecretsMode(code: number): void {
  process.stdout.write('', () => {
    process.stderr.write('', () => app.exit(code));
  });
}

/** Runs one secrets command, prints only its lines through the redacting log, and quits. */
async function runSecretsMode(command: SecretsCommand): Promise<void> {
  let outcome: SecretsOutcome;
  try {
    // For `set` the value comes over the one-shot socket; it is never logged or echoed.
    const value = command.op === 'set' ? await readSecretFromPipe(command.address) : null;
    outcome = runSecretsCommand(createElectronSecretStore(), command, value);
  } catch (error) {
    // The reasons from the pipe read and the store name no value.
    const reason = error instanceof Error ? error.message : 'unknown error';
    const prefix =
      command.op === 'invalid'
        ? 'secrets'
        : command.op === 'list'
          ? 'secrets list'
          : `secrets ${command.op} ${command.name}`;
    outcome = { ok: false, lines: [`${prefix} failed: ${reason}`] };
  }
  for (const line of outcome.lines) {
    if (outcome.ok) {
      log.info(line);
    } else {
      log.error(line);
    }
  }
  quitSecretsMode(outcome.ok ? 0 : 1);
}

if (secretsCommand) {
  void app.whenReady().then(() => runSecretsMode(secretsCommand));
} else {
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
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
