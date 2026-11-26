import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EVENT_CHANNELS, IPC_CHANNELS } from '../shared/bridge';
import { DEV_PROJECT_ID } from '../shared/human-actions';
import { DEFAULT_RULES } from '../shared/project-rules';
import { tokens } from '../shared/tokens';
import { startAgentHost, type LiveSupplier } from './agent/host';
import { environmentFor } from './env';
import { createHumanActionChannel } from './human/channel';
import { createGestureTracker } from './human/gesture';
import { createShipHandlers } from './human/ship-handlers';
import { createSpecHandlers } from './human/spec-handlers';
import { log } from './log';
import { createProjectRegistry } from './projects/registry';
import { createProjectStore, type Project } from './projects/store';
import { createServerStore, SERVERS_FILE_NAME } from './projects/servers';
import {
  parseSecretsArgs,
  runSecretsCommand,
  type SecretsCommand,
  type SecretsOutcome,
} from './secrets/dev-mode';
import { createElectronSecretStore } from './secrets/electron';
import { readSecretFromPipe } from './secrets/pipe';
import { applyNavigationGuards, isTrustedSender } from './security';
import { specStateOf } from './policy/context';
import type { BuildController } from './workflow/build-loop';
import { createSpecLockWatcher, type SpecLockWatcher } from './workflow/spec-watch';

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

// The human-only channel (D33). The four handlers are registered by setUpProjects through the
// project registry (D40): each request names its project, and a project that is not known is
// refused. Until the registry is up, a request is answered `not-available`.
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
 * The dev project (D40): the spike root (HARNESS_SPIKE_ROOT) in an unpackaged run only. It is never
 * saved in the store, and a packaged app ignores the variable.
 */
const devProjectRoot = app.isPackaged ? undefined : process.env['HARNESS_SPIKE_ROOT'] || undefined;

/** The build controller of each feature of each project that has a build (D37, D40). */
const buildControllers = new Map<string, BuildController>();

/** The key of a build controller: its project id and its feature. Neither can contain a slash. */
function controllerKey(projectId: string, feature: string): string {
  return `${projectId}/${feature}`;
}

/** The spike agent's live context reads the dev project's watcher (D36), set up with the registry. */
let devWatcher: SpecLockWatcher | null = null;

/**
 * Loads the project store and builds the registry on top of it (D40). The store is in app data;
 * a corrupt file is set aside by the store itself. The four human-only handlers are registered
 * with the registry, so a request for a project that is not known is refused.
 */
async function setUpProjects(): Promise<void> {
  const store = createProjectStore({
    filePath: join(app.getPath('userData'), 'projects.json'),
    newId: () => randomUUID(),
    now: () => new Date(),
    platform: process.platform,
    logger: log,
  });
  await store.load();

  // The saved SSH servers (D43) live in app data beside the projects; their secrets are in the secret store.
  // No IPC reaches them yet (p4-projects-screen).
  const secrets = createElectronSecretStore();
  const servers = createServerStore({
    filePath: join(app.getPath('userData'), SERVERS_FILE_NAME),
    secrets,
    logger: log,
  });
  await servers.load();

  const devProject: Project | undefined =
    devProjectRoot === undefined
      ? undefined
      : {
          id: DEV_PROJECT_ID,
          name: 'dev',
          environment: { kind: 'local' },
          root: devProjectRoot,
          rules: DEFAULT_RULES,
        };

  // The dev project's watcher is the first one started, so it is the first watcher for its root.
  let firstDevStart = devProject !== undefined;
  const createdRegistry = createProjectRegistry({
    store,
    ...(devProject === undefined ? {} : { devProject }),
    environmentFor: (descriptor) =>
      environmentFor(descriptor, { ssh: { servers, secrets, logger: log } }),
    startLock: (env, root) => {
      const lock = createSpecLockWatcher({
        env,
        root,
        onChange: (value) => {
          const feature = value.feature === null ? '' : ` feature=${value.feature}`;
          log.info(`spec lock: ${value.approval}${feature}`);
        },
      });
      if (firstDevStart && devProject !== undefined && root === devProject.root) {
        devWatcher = lock;
        firstDevStart = false;
      }
      return lock;
    },
    makeSpecHandlers: ({ project, env, refresh }) =>
      createSpecHandlers({
        env,
        root: project.root,
        now: () => new Date(),
        onLockChanged: refresh,
        // The build controller of the feature allows or refuses the edit (D37). None exists
        // until a build starts, so an edit is allowed as before.
        onEditRequested: (feature) => {
          const controller = buildControllers.get(controllerKey(project.id, feature));
          return controller ? controller.requestEdit() : { ok: true };
        },
      }),
    makeShipHandlers: ({ project, env, refresh, controllerNode }) =>
      createShipHandlers({
        env,
        root: project.root,
        onLockChanged: refresh,
        controllerNode,
        commitFormat: project.rules.commitFormat,
      }),
    controllerNode: (projectId, feature) =>
      buildControllers.get(controllerKey(projectId, feature))?.node() ?? null,
  });
  humanActions.register('approve-spec', createdRegistry.handlerFor('approve-spec'));
  humanActions.register('edit-approved-spec', createdRegistry.handlerFor('edit-approved-spec'));
  humanActions.register('approve-result', createdRegistry.handlerFor('approve-result'));
  humanActions.register('mark-done', createdRegistry.handlerFor('mark-done'));
  // change-rules has no handler (D40): it is answered not-available.

  app.once('before-quit', () => createdRegistry.close());
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
  void app.whenReady().then(async () => {
    await setUpProjects();
    registerIpcHandlers();
    mainWindow = createMainWindow();
    // Each agent tool call reads the open feature and its spec state from the dev project's
    // watcher (D36, D40). With no dev project there is no lock, so the agent gets the default context.
    let live: LiveSupplier | undefined;
    const lock = devWatcher;
    if (lock !== null) {
      live = () => {
        const value = lock.current();
        return { feature: value.feature, spec: specStateOf(value.approval) };
      };
    }
    // The agent's tools run in the dev project's environment (D41): the local one, as the dev
    // project's descriptor says.
    const devEnvironment = environmentFor({ kind: 'local' });
    if (devEnvironment.ok) {
      startAgentHost(devEnvironment.env, live).catch(() => {
        log.error('the agent host could not be started');
      });
    }

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
