// The project store (p4-project-store, D40). It keeps the projects in one JSON file in app data
// and answers add, list, get, rename, set rules and remove. Main only. No Electron import: the
// file path, the id maker, the clock, the platform and the logger are all injected, so tests use a
// temp folder.
//
// The file is `{ "version": 1, "projects": [...] }`, saved whole through writeFileAtomic after each
// write. A file that cannot be read, is not JSON, has another version or holds an invalid project
// is renamed aside (`projects.json.corrupt-<timestamp>`) and the store starts empty (G5). Nothing
// here touches a project's folder beyond a stat when a project is added (AC2).
//
// Every write runs one at a time, so two writes never read the same base. A failed save leaves the
// list as it was before the call. Refusals are fixed text and never echo the input.

import { promises as fs } from 'node:fs';
import { isAbsolute, dirname, resolve } from 'node:path';
import {
  DEFAULT_RULES,
  hasLineBreak,
  parseRules,
  type ProjectRules,
} from '../../shared/project-rules';
import type { Logger } from '../log';
import { localEnvironment } from '../env';
import { writeFileAtomic } from '../tools/atomic-write';

/** Where a project's folder is. Only `local` exists now; later subtasks add wsl, ssh and container. */
export type ProjectEnvironment = { kind: 'local' };

/** One project: a repo folder with its own rules (D40). */
export interface Project {
  id: string;
  name: string;
  environment: ProjectEnvironment;
  root: string;
  rules: ProjectRules;
}

/** The result of a write: the project it touched, or the fixed reason it was refused. */
export type ProjectResult = { ok: true; project: Project } | { ok: false; reason: string };

export interface AddProjectInput {
  name: string;
  environment: ProjectEnvironment;
  root: string;
  /** Rules as a caller gave them. Undefined takes DEFAULT_RULES; anything else goes through parseRules. */
  rules?: unknown;
}

export interface ProjectStoreOptions {
  /** The store file, for example `<userData>/projects.json`. */
  filePath: string;
  /** Makes a new project id: a lowercase UUID in the app. */
  newId: () => string;
  /** The clock, for the timestamp of a set-aside file. */
  now: () => Date;
  platform: NodeJS.Platform;
  logger: Logger;
}

export interface ProjectStore {
  /** Reads the file once. Called at start; a corrupt file is set aside and the store starts empty. */
  load(): Promise<void>;
  /** The saved projects, in the order they were added. */
  list(): Project[];
  /** The project with this id, or null. */
  get(id: string): Project | null;
  add(input: AddProjectInput): Promise<ProjectResult>;
  rename(id: string, name: unknown): Promise<ProjectResult>;
  setRules(id: string, rules: unknown): Promise<ProjectResult>;
  /** Drops the project from the store. Never touches its folder. */
  remove(id: string): Promise<ProjectResult>;
}

/** The fixed refusal reasons. None echoes a value from the input. */
export const STORE_REASONS = {
  noProject: 'no project with this id',
  root: 'the root must be an absolute path to an existing folder',
  duplicate: 'a project already uses this folder',
  name: 'the name must be 1 to 80 characters with no line break',
  environment: 'only local projects are supported',
  save: 'the projects could not be saved, so nothing changed',
  failed: 'the action failed',
} as const;

/** The longest project name, in characters. */
export const MAX_PROJECT_NAME_LENGTH = 80;

/** The file version this store reads and writes. */
const FILE_VERSION = 1;

/** The base name of the store file, for log lines. */
const FILE_LABEL = 'projects.json';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Step<T> = { ok: true; value: T } | { ok: false; reason: string };

function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Windows and macOS compare folder paths without case; Linux compares them exactly. */
function caseInsensitive(platform: NodeJS.Platform): boolean {
  return platform === 'win32' || platform === 'darwin';
}

/** True when two resolved roots are the same folder for this platform. */
function sameRoot(a: string, b: string, platform: NodeJS.Platform): boolean {
  if (caseInsensitive(platform)) return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

/** The trimmed name when it is 1 to 80 characters with no line break; otherwise null. */
function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const length = Array.from(trimmed).length;
  if (length < 1 || length > MAX_PROJECT_NAME_LENGTH) return null;
  if (hasLineBreak(trimmed)) return null;
  return trimmed;
}

/** True only for the local environment, and only with its one key. */
function isLocal(value: unknown): value is ProjectEnvironment {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 1 && value['kind'] === 'local';
}

/** A copy that the caller can keep without changing the store. */
function copyOf(project: Project): Project {
  return {
    id: project.id,
    name: project.name,
    environment: { kind: 'local' },
    root: project.root,
    rules: { ...project.rules },
  };
}

/** The checks a stored project must pass on load. Returns the project, or null when it fails. */
function storedProject(value: unknown): Project | null {
  if (!isRecord(value)) return null;
  const id = value['id'];
  if (typeof id !== 'string' || !UUID_PATTERN.test(id)) return null;
  const name = cleanName(value['name']);
  if (name === null || name !== value['name']) return null;
  if (!isLocal(value['environment'])) return null;
  const root = value['root'];
  if (typeof root !== 'string' || !isAbsolute(root) || resolve(root) !== root) return null;
  const parsed = parseRules(value['rules']);
  if (!parsed.ok) return null;
  return { id, name, environment: { kind: 'local' }, root, rules: parsed.rules };
}

/** The stored projects, or null when one fails a check or two share an id or a folder. */
function storedProjects(values: unknown[], platform: NodeJS.Platform): Project[] | null {
  const out: Project[] = [];
  for (const value of values) {
    const project = storedProject(value);
    if (project === null) return null;
    const clash = out.some(
      (other) => other.id === project.id || sameRoot(other.root, project.root, platform),
    );
    if (clash) return null;
    out.push(project);
  }
  return out;
}

function isNotFound(error: unknown): boolean {
  return isRecord(error) && error['code'] === 'ENOENT';
}

export function createProjectStore(options: ProjectStoreOptions): ProjectStore {
  const { filePath, newId, now, platform, logger } = options;
  let projects: Project[] = [];

  // One write at a time, so each write starts from the list the last one left.
  let queue: Promise<unknown> = Promise.resolve();
  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task);
    queue = run.catch(() => undefined);
    return run;
  }

  /** Saves a whole list. True only when the file was written. */
  async function persist(next: Project[]): Promise<boolean> {
    try {
      await fs.mkdir(dirname(filePath), { recursive: true });
      const text = `${JSON.stringify({ version: FILE_VERSION, projects: next }, null, 2)}\n`;
      const written = await writeFileAtomic(
        localEnvironment().files,
        filePath,
        Buffer.from(text, 'utf8'),
      );
      return written.ok;
    } catch {
      return false;
    }
  }

  /** Saves the next list; the in-memory list changes only when the save worked. */
  async function commit(next: Project[]): Promise<Step<null>> {
    if (!(await persist(next))) return { ok: false, reason: STORE_REASONS.save };
    projects = next;
    return { ok: true, value: null };
  }

  /** Renames a corrupt file aside and starts empty. The reason is a code, never the content. */
  async function setAside(reason: string): Promise<void> {
    const stamp = now().toISOString().replace(/[:.]/g, '-');
    const target = `${filePath}.corrupt-${stamp}`;
    projects = [];
    try {
      await fs.rename(filePath, target);
      logger.error(
        `project store: ${FILE_LABEL} is not valid (reason: ${reason}); it was set aside and the store starts empty`,
      );
    } catch {
      logger.error(
        `project store: ${FILE_LABEL} is not valid (reason: ${reason}); setting it aside failed, so the store starts empty and the next save replaces it`,
      );
    }
  }

  async function loadOnce(): Promise<void> {
    let text: string;
    try {
      text = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      if (isNotFound(error)) {
        projects = [];
        return;
      }
      await setAside('unreadable');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      await setAside('not-json');
      return;
    }
    if (!isRecord(parsed) || parsed['version'] !== FILE_VERSION) {
      await setAside('version');
      return;
    }
    const list = parsed['projects'];
    const checked = Array.isArray(list) ? storedProjects(list, platform) : null;
    if (checked === null) {
      await setAside('invalid-project');
      return;
    }
    projects = checked;
  }

  function findIndex(id: string): number {
    return projects.findIndex((project) => project.id === id);
  }

  /** Replaces one project in the list and saves. Returns the stored copy, or the refusal. */
  async function replaceAt(index: number, updated: Project): Promise<ProjectResult> {
    const next = projects.map((project, at) => (at === index ? updated : project));
    const saved = await commit(next);
    return saved.ok ? { ok: true, project: copyOf(updated) } : fail(saved.reason);
  }

  return {
    load: () =>
      enqueue(async () => {
        await loadOnce();
      }),

    list: () => projects.map(copyOf),

    get: (id) => {
      const project = projects.find((candidate) => candidate.id === id);
      return project === undefined ? null : copyOf(project);
    },

    add: (input) =>
      enqueue(async (): Promise<ProjectResult> => {
        try {
          const name = cleanName(input.name);
          if (name === null) return fail(STORE_REASONS.name);
          if (!isLocal(input.environment)) return fail(STORE_REASONS.environment);
          const rules =
            input.rules === undefined
              ? { ok: true as const, rules: DEFAULT_RULES }
              : parseRules(input.rules);
          if (!rules.ok) return fail(rules.reason);
          if (typeof input.root !== 'string' || !isAbsolute(input.root)) {
            return fail(STORE_REASONS.root);
          }
          const root = resolve(input.root);
          try {
            const info = await fs.stat(root);
            if (!info.isDirectory()) return fail(STORE_REASONS.root);
          } catch {
            return fail(STORE_REASONS.root);
          }
          if (projects.some((other) => sameRoot(other.root, root, platform))) {
            return fail(STORE_REASONS.duplicate);
          }
          const project: Project = {
            id: newId(),
            name,
            environment: { kind: 'local' },
            root,
            rules: rules.rules,
          };
          const saved = await commit([...projects, project]);
          return saved.ok ? { ok: true, project: copyOf(project) } : fail(saved.reason);
        } catch {
          return fail(STORE_REASONS.failed);
        }
      }),

    rename: (id, name) =>
      enqueue(async (): Promise<ProjectResult> => {
        try {
          const index = findIndex(id);
          if (index < 0) return fail(STORE_REASONS.noProject);
          const clean = cleanName(name);
          if (clean === null) return fail(STORE_REASONS.name);
          const current = projects[index];
          if (current === undefined) return fail(STORE_REASONS.noProject);
          return await replaceAt(index, { ...current, name: clean });
        } catch {
          return fail(STORE_REASONS.failed);
        }
      }),

    setRules: (id, rules) =>
      enqueue(async (): Promise<ProjectResult> => {
        try {
          const index = findIndex(id);
          if (index < 0) return fail(STORE_REASONS.noProject);
          const parsed = parseRules(rules);
          if (!parsed.ok) return fail(parsed.reason);
          const current = projects[index];
          if (current === undefined) return fail(STORE_REASONS.noProject);
          return await replaceAt(index, { ...current, rules: parsed.rules });
        } catch {
          return fail(STORE_REASONS.failed);
        }
      }),

    remove: (id) =>
      enqueue(async (): Promise<ProjectResult> => {
        try {
          const index = findIndex(id);
          if (index < 0) return fail(STORE_REASONS.noProject);
          const removed = projects[index];
          if (removed === undefined) return fail(STORE_REASONS.noProject);
          const next = projects.filter((_project, at) => at !== index);
          const saved = await commit(next);
          return saved.ok ? { ok: true, project: copyOf(removed) } : fail(saved.reason);
        } catch {
          return fail(STORE_REASONS.failed);
        }
      }),
  };
}
