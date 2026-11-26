// The project registry (p4-project-store, D40; environments, D41; connections, D43). It joins the project store and the
// dev project (the spike root in an unpackaged run) into one list, makes one environment per project from its
// descriptor, starts one spec-lock watcher per connected project, and gives the human-only channel one handler per
// action. Each handler looks up the request's project and passes the request to that project's own handler, so an
// approval only ever touches the folder of the project it names (G4). Main only; no Electron import. The watcher, the
// handler makers, the environment maker and the store are injected, so tests run on temp folders and a fake watcher.
//
// Each project has a state, `connected` or `unreachable` (D43). A project whose environment was made but cannot be
// reached (its connect failed, or its connection dropped) is listed, removable and read-only: its actions are refused
// with PROJECT_UNREACHABLE, and it has no watcher. A project whose environment cannot be made (an unknown kind, a bad
// distribution name, an unknown SSH server) is listed as unreachable too, but its actions keep the refusal for an
// unknown project, and reconnect(id) tries to make its environment again. A request for a project that is not known is
// refused with `refused` and the fixed reason, and changes nothing. The build controllers are looked up by project and
// feature (controllerNode), and buildOptionsFor hands a project's round limit to the build controller (G3).

import {
  DEV_PROJECT_ID,
  type HumanActionRequest,
  type HumanActionResult,
} from '../../shared/human-actions';
import type { ProjectRules, RoundLimit } from '../../shared/project-rules';
import type { NodeId } from '../../shared/workflow';
import type { EnvironmentDescriptor, EnvironmentResult } from '../env';
import type { Environment } from '../env/types';
import type { HumanActionHandler } from '../human/channel';
import type { ShipHandlers } from '../human/ship-handlers';
import type { SpecHandlers } from '../human/spec-handlers';
import type { SpecLockWatcher } from '../workflow/spec-watch';
import type { AddProjectInput, Project, ProjectResult, ProjectStore } from './store';

/** The four human-only actions that a project's handlers answer (change-rules has none). */
export type ProjectAction = 'approve-spec' | 'edit-approved-spec' | 'approve-result' | 'mark-done';

/** A project's state (D43): `connected`, or `unreachable` when its environment cannot be used now. */
export type ProjectState = 'connected' | 'unreachable';

/** What a state listener is told: the project and its new state. Never a value from its settings. */
export interface ProjectStateEvent {
  projectId: string;
  state: ProjectState;
}

/** The fixed refusal for a project that was made but cannot be reached (D43, revision 1). */
export const PROJECT_UNREACHABLE =
  "this project's environment is unreachable; reconnect to continue";

/** What a project's spec handlers are built from. */
export interface ProjectHandlersInput {
  project: Project;
  /** The project's environment, made once by the registry (D41). */
  env: Environment;
  /** Refreshes the project's spec-lock watcher. Called after each change. */
  refresh: () => Promise<unknown>;
}

/** What a project's ship handlers are built from: the same, plus the feature's build node. */
export interface ProjectShipInput extends ProjectHandlersInput {
  controllerNode: (feature: string) => NodeId | null;
}

export interface ProjectRegistryDeps {
  store: ProjectStore;
  /** The dev project (id `dev`). Not saved in the store; absent when there is no spike root. */
  devProject?: Project;
  /** Makes a project's environment from its descriptor (environmentFor in the app, D41, D42, D43). */
  environmentFor: (descriptor: EnvironmentDescriptor) => EnvironmentResult;
  /** Starts the spec-lock watcher for one root in an environment (createSpecLockWatcher in the app). */
  startLock: (env: Environment, root: string) => SpecLockWatcher;
  /** Builds a project's spec handlers from its root, rules and environment. */
  makeSpecHandlers: (input: ProjectHandlersInput) => SpecHandlers;
  /** Builds a project's ship handlers from its root, rules, environment and commit format. */
  makeShipHandlers: (input: ProjectShipInput) => ShipHandlers;
  /** The node of a feature's build controller in a project, or null when it has none. */
  controllerNode: (projectId: string, feature: string) => NodeId | null;
}

export interface ProjectRegistry {
  /** The stored projects, plus the dev project when there is one. Unreachable projects are included. */
  projects(): Project[];
  /** One channel handler for the action. It answers for the request's project only. */
  handlerFor(action: ProjectAction): HumanActionHandler;
  /** Adds a project to the store, and starts its watcher when the add worked. An SSH project connects first. */
  addProject(input: AddProjectInput): Promise<ProjectResult>;
  /** Closes the project's watcher, then drops it from the store. The folder is never touched. */
  removeProject(id: string): Promise<ProjectResult>;
  /** The options a build controller takes for a project: its root and round limit (G3). Null when unreachable. */
  buildOptionsFor(id: string): { root: string; roundLimit: RoundLimit } | null;
  /** The project's environment (D41), or null for an unknown or unreachable project. */
  environmentOf(projectId: string): Environment | null;
  /** The project's state (D43), or null for an unknown project. */
  stateOf(id: string): ProjectState | null;
  /** Calls the listener on each state change. Returns the function that stops it. */
  onStateChange(listener: (event: ProjectStateEvent) => void): () => void;
  /**
   * Brings a project back: makes its environment again if it was never made, reconnects it, and on success starts
   * its watcher and handlers. Resolves `{ ok: true }` or a fixed reason; never rejects.
   */
  reconnect(id: string): Promise<{ ok: true } | { ok: false; reason: string }>;
  /** Closes every watcher. Called at quit. */
  close(): void;
}

/** One project's live parts: its environment (null when it cannot be made), its state, and its watcher and handlers. */
interface Entry {
  project: Project;
  env: Environment | null;
  state: ProjectState;
  watcher: SpecLockWatcher | null;
  spec: SpecHandlers | null;
  ship: ShipHandlers | null;
  /** Stops the listener on the environment's connection state. */
  stopListening: () => void;
}

/** The fixed refusal for a project id that is not known, or whose environment cannot be made (G4, revision 1). */
const NO_PROJECT = 'no project with this id';

/** The fixed reason of a reconnect whose environment still cannot be made and is not given here. */
const NOT_MADE = "this project's environment cannot be made; check its settings";

function refused(reason: string): HumanActionResult {
  return { ok: false, code: 'refused', reason };
}

function sameRules(a: ProjectRules, b: ProjectRules): boolean {
  return (
    a.roundLimit === b.roundLimit &&
    a.modelPolicy === b.modelPolicy &&
    a.commitFormat === b.commitFormat
  );
}

/** Asks for one refresh of a watcher. A failed refresh is ignored; the watcher catches up later. */
function refreshOnce(watcher: SpecLockWatcher): void {
  void (async () => {
    try {
      await watcher.refresh();
    } catch {
      // The next event refreshes the watcher again.
    }
  })();
}

export function createProjectRegistry(deps: ProjectRegistryDeps): ProjectRegistry {
  const { store, startLock } = deps;
  const entries = new Map<string, Entry>();
  const stateListeners = new Set<(event: ProjectStateEvent) => void>();

  if (deps.devProject !== undefined && deps.devProject.id !== DEV_PROJECT_ID) {
    throw new Error('the dev project must have the id dev');
  }

  /** Tells the state listeners that a project's state changed. */
  function announce(entry: Entry, previous: ProjectState): void {
    if (previous === entry.state) return;
    const event: ProjectStateEvent = { projectId: entry.project.id, state: entry.state };
    for (const listener of [...stateListeners]) listener(event);
  }

  /** Moves an entry to a state and tells the listeners when it changed. */
  function setState(entry: Entry, next: ProjectState): void {
    const previous = entry.state;
    entry.state = next;
    announce(entry, previous);
  }

  /** The handlers of one project, built from its root, rules, environment and the watcher's refresh. */
  function build(
    project: Project,
    env: Environment,
    watcher: SpecLockWatcher,
  ): Pick<Entry, 'spec' | 'ship'> {
    const refresh = () => watcher.refresh();
    return {
      spec: deps.makeSpecHandlers({ project, env, refresh }),
      ship: deps.makeShipHandlers({
        project,
        env,
        refresh,
        controllerNode: (feature) => deps.controllerNode(project.id, feature),
      }),
    };
  }

  /** Starts the watcher and the handlers of a project whose environment is made and connected. */
  function activate(entry: Entry): void {
    if (entry.env === null) return;
    if (entry.watcher !== null) {
      refreshOnce(entry.watcher);
      return;
    }
    const watcher = startLock(entry.env, entry.project.root);
    const handlers = build(entry.project, entry.env, watcher);
    entry.watcher = watcher;
    entry.spec = handlers.spec;
    entry.ship = handlers.ship;
    setState(entry, 'connected');
    refreshOnce(watcher);
  }

  /** Closes the watcher and drops the handlers: the project is unreachable and read-only (D43). */
  function deactivate(entry: Entry): void {
    entry.watcher?.close();
    entry.watcher = null;
    entry.spec = null;
    entry.ship = null;
    setState(entry, 'unreachable');
  }

  /** Listens to the environment's connection state: a move to unreachable deactivates the project. */
  function listen(entry: Entry): void {
    entry.stopListening();
    entry.stopListening =
      entry.env === null
        ? () => undefined
        : entry.env.connection.onChange((next) => {
            if (next === 'unreachable') deactivate(entry);
          });
  }

  /** A new entry for a project. Its state starts unreachable until it is activated. */
  function entryFor(project: Project, env: Environment | null): Entry {
    const entry: Entry = {
      project,
      env,
      state: 'unreachable',
      watcher: null,
      spec: null,
      ship: null,
      stopListening: () => undefined,
    };
    listen(entry);
    return entry;
  }

  /**
   * Registers a project: its environment is `known` or made now (null when it cannot be made). A connected environment
   * is activated at once. A non-local environment is also reconnected once, in the background, unless the caller
   * already connected it (the add of an SSH project).
   */
  function register(project: Project, known: Environment | null, reconnectNow: boolean): Entry {
    let env = known;
    if (env === null && known === null) {
      const made = deps.environmentFor(project.environment);
      env = made.ok ? made.env : null;
    }
    const entry = entryFor(project, env);
    entries.set(project.id, entry);
    if (env !== null && env.connection.state() === 'connected') activate(entry);
    if (env !== null && reconnectNow && project.environment.kind !== 'local') {
      void reconnectInBackground(entry);
    }
    return entry;
  }

  /** The one reconnect at start: connected brings the watcher up, a failure leaves the project unreachable. */
  async function reconnectInBackground(entry: Entry): Promise<void> {
    const env = entry.env;
    if (env === null) return;
    const result = await env.connection.reconnect();
    if (entries.get(entry.project.id) !== entry) return;
    if (result.ok) activate(entry);
    else deactivate(entry);
  }

  if (deps.devProject !== undefined) {
    register(deps.devProject, null, false);
  }
  for (const project of store.list()) {
    register(project, null, true);
  }

  /**
   * The live entry for an id, or undefined. A stored project's rules and record are taken from the store, and its
   * handlers are rebuilt from the new rules when a watcher is running, so the commit format always follows the store.
   */
  function live(id: string): Entry | undefined {
    const entry = entries.get(id);
    if (entry === undefined || id === DEV_PROJECT_ID) return entry;
    const stored = store.get(id);
    if (stored === null) return undefined;
    if (
      entry.watcher !== null &&
      entry.env !== null &&
      !sameRules(stored.rules, entry.project.rules)
    ) {
      const handlers = build(stored, entry.env, entry.watcher);
      entry.spec = handlers.spec;
      entry.ship = handlers.ship;
    }
    entry.project = stored;
    return entry;
  }

  return {
    projects() {
      const dev = entries.get(DEV_PROJECT_ID);
      const stored = store.list();
      return dev === undefined ? stored : [dev.project, ...stored];
    },

    handlerFor(action) {
      return async (request: HumanActionRequest): Promise<HumanActionResult> => {
        const entry = live(request.project);
        // A project whose environment cannot be made answers as an unknown project (revision 1).
        if (entry === undefined || entry.env === null) return refused(NO_PROJECT);
        if (entry.state !== 'connected' || entry.spec === null || entry.ship === null) {
          return refused(PROJECT_UNREACHABLE);
        }
        switch (action) {
          case 'approve-spec':
            return entry.spec['approve-spec'](request);
          case 'edit-approved-spec':
            return entry.spec['edit-approved-spec'](request);
          case 'approve-result':
            return entry.ship['approve-result'](request);
          case 'mark-done':
            return entry.ship['mark-done'](request);
        }
      };
    },

    async addProject(input) {
      // A project whose environment cannot be made is refused before anything is stored.
      const made = deps.environmentFor(input.environment);
      if (!made.ok) return { ok: false, reason: made.reason };
      // An SSH project connects first, so nothing is stored for a server that cannot be reached (D43).
      if (input.environment.kind === 'ssh') {
        const connected = await made.env.connection.reconnect();
        if (!connected.ok) return { ok: false, reason: connected.reason };
      }
      // The store checks a WSL or SSH root through this same environment (D42, D43).
      const result = await store.add(input, made.env);
      if (result.ok) register(result.project, made.env, false);
      return result;
    },

    async removeProject(id) {
      const entry = entries.get(id);
      if (entry === undefined || id === DEV_PROJECT_ID) return { ok: false, reason: NO_PROJECT };
      entry.stopListening();
      entry.watcher?.close();
      entry.watcher = null;
      entries.delete(id);
      const removed = await store.remove(id);
      if (!removed.ok) {
        // The save failed, so the project is still stored: put it back as it was.
        entries.set(id, entry);
        listen(entry);
        if (entry.env !== null && entry.env.connection.state() === 'connected') activate(entry);
      }
      return removed;
    },

    buildOptionsFor(id) {
      const entry = live(id);
      if (entry === undefined || entry.env === null || entry.state !== 'connected') return null;
      return { root: entry.project.root, roundLimit: entry.project.rules.roundLimit };
    },

    environmentOf(projectId) {
      const entry = live(projectId);
      if (entry === undefined || entry.env === null || entry.state !== 'connected') return null;
      return entry.env;
    },

    stateOf(id) {
      const entry = entries.get(id);
      return entry === undefined ? null : entry.state;
    },

    onStateChange(listener) {
      stateListeners.add(listener);
      return () => {
        stateListeners.delete(listener);
      };
    },

    async reconnect(id) {
      const entry = entries.get(id);
      if (entry === undefined) return { ok: false, reason: NO_PROJECT };
      if (entry.env === null) {
        // The environment was never made: make it now, and refuse with its reason if it still cannot be made.
        const made = deps.environmentFor(entry.project.environment);
        if (!made.ok) return { ok: false, reason: made.reason || NOT_MADE };
        entry.env = made.env;
        listen(entry);
      }
      const env = entry.env;
      const result = await env.connection.reconnect();
      // Removed while the connect ran: nothing to bring back.
      if (entries.get(id) !== entry) return { ok: false, reason: NO_PROJECT };
      if (!result.ok) {
        deactivate(entry);
        return { ok: false, reason: result.reason };
      }
      activate(entry);
      return { ok: true };
    },

    close() {
      for (const entry of entries.values()) {
        entry.stopListening();
        entry.watcher?.close();
      }
      entries.clear();
      stateListeners.clear();
    },
  };
}
