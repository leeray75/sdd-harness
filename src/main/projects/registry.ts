// The project registry (p4-project-store, D40; environments, D41). It joins the project store and the
// dev project (the spike root in an unpackaged run) into one list, makes one environment per project
// from its descriptor, starts one spec-lock watcher per project, and gives the human-only channel one
// handler per action. Each handler looks up the request's project and passes the request to that
// project's own handler, so an approval only ever touches the folder of the project it names (G4).
// Main only; no Electron import. The watcher, the handler makers, the environment maker and the store
// are injected, so tests run on temp folders and a fake watcher.
//
// A request for a project that is not known (not the dev project, not in the store) is refused
// with `refused` and the fixed reason, and changes nothing. A project whose environment cannot be made
// is refused the same way: it gets no watcher and no handlers. The build controllers are looked up by
// project and feature (controllerNode), and buildOptionsFor hands a project's round limit to the
// build controller (G3). No build starts from here yet (D39).

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
  /** Makes a project's environment from its descriptor (environmentFor in the app, D41, D42). */
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
  /** The stored projects, plus the dev project when there is one. */
  projects(): Project[];
  /** One channel handler for the action. It answers for the request's project only. */
  handlerFor(action: ProjectAction): HumanActionHandler;
  /** Adds a project to the store, and starts its watcher when the add worked. */
  addProject(input: AddProjectInput): Promise<ProjectResult>;
  /** Closes the project's watcher, then drops it from the store. The folder is never touched. */
  removeProject(id: string): Promise<ProjectResult>;
  /** The options a build controller takes for a project: its root and round limit (G3). */
  buildOptionsFor(id: string): { root: string; roundLimit: RoundLimit } | null;
  /** The project's environment (D41), or null for an unknown project. */
  environmentOf(projectId: string): Environment | null;
  /** Closes every watcher. Called at quit. */
  close(): void;
}

/** One project's live parts: its environment, its watcher and the handlers built from its root. */
interface Entry {
  project: Project;
  env: Environment;
  watcher: SpecLockWatcher;
  spec: SpecHandlers;
  ship: ShipHandlers;
}

/** The fixed refusal for a project id that is not known. Same text as the store's (G4). */
const NO_PROJECT = 'no project with this id';

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

  if (deps.devProject !== undefined && deps.devProject.id !== DEV_PROJECT_ID) {
    throw new Error('the dev project must have the id dev');
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

  /**
   * Makes a project's environment, starts its watcher, builds its handlers and refreshes the watcher
   * once. Null when the environment cannot be made: the project then has no entry at all.
   */
  function start(project: Project, known?: Environment): Entry | null {
    let env = known;
    if (env === undefined) {
      const made = deps.environmentFor(project.environment);
      if (!made.ok) return null;
      env = made.env;
    }
    const watcher = startLock(env, project.root);
    const handlers = build(project, env, watcher);
    refreshOnce(watcher);
    return { project, env, watcher, ...handlers };
  }

  if (deps.devProject !== undefined) {
    const dev = start(deps.devProject);
    if (dev !== null) entries.set(DEV_PROJECT_ID, dev);
  }
  for (const project of store.list()) {
    const entry = start(project);
    if (entry !== null) entries.set(project.id, entry);
  }

  /**
   * The live entry for an id, or undefined. A stored project whose rules changed in the store gets
   * its handlers rebuilt from the new rules, so the commit format always follows the store.
   */
  function live(id: string): Entry | undefined {
    const entry = entries.get(id);
    if (entry === undefined || id === DEV_PROJECT_ID) return entry;
    const stored = store.get(id);
    if (stored === null) return undefined;
    if (!sameRules(stored.rules, entry.project.rules)) {
      const handlers = build(stored, entry.env, entry.watcher);
      entry.project = stored;
      entry.spec = handlers.spec;
      entry.ship = handlers.ship;
    }
    return entry;
  }

  function pick(entry: Entry, action: ProjectAction): HumanActionHandler {
    switch (action) {
      case 'approve-spec':
        return entry.spec['approve-spec'];
      case 'edit-approved-spec':
        return entry.spec['edit-approved-spec'];
      case 'approve-result':
        return entry.ship['approve-result'];
      case 'mark-done':
        return entry.ship['mark-done'];
    }
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
        if (entry === undefined) return refused(NO_PROJECT);
        return pick(entry, action)(request);
      };
    },

    async addProject(input) {
      // A project whose environment cannot be made is refused before anything is stored.
      const made = deps.environmentFor(input.environment);
      if (!made.ok) return { ok: false, reason: made.reason };
      // The store checks a WSL root through this same environment (D42).
      const result = await store.add(input, made.env);
      if (result.ok) {
        const entry = start(result.project, made.env);
        if (entry !== null) entries.set(result.project.id, entry);
      }
      return result;
    },

    async removeProject(id) {
      const entry = entries.get(id);
      if (entry === undefined || id === DEV_PROJECT_ID) return { ok: false, reason: NO_PROJECT };
      entry.watcher.close();
      entries.delete(id);
      const removed = await store.remove(id);
      if (!removed.ok) {
        // The save failed, so the project is still stored: start its watcher again.
        const again = start(entry.project);
        if (again !== null) entries.set(id, again);
      }
      return removed;
    },

    buildOptionsFor(id) {
      const entry = live(id);
      if (entry === undefined) return null;
      return { root: entry.project.root, roundLimit: entry.project.rules.roundLimit };
    },

    environmentOf(projectId) {
      const entry = live(projectId);
      return entry === undefined ? null : entry.env;
    },

    close() {
      for (const entry of entries.values()) entry.watcher.close();
      entries.clear();
    },
  };
}
