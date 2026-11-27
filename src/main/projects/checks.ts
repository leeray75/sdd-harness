// The project checks runner (p4-project-checks, D45). runProjectChecks computes the five checks of the
// add-project wizard and the projects screen for one project folder, through the project's environment
// (D41): it reads the git part, the origin remote, the spec folders and the root's marker files, and it
// starts no program of its own. It never rejects, and one failing check never hides another. An
// unreachable environment runs nothing and reports every check as not checked; nothing reconnects (D43).
// Results are returned, never stored (D45). The result type and the helpers are in
// src/shared/project-checks.ts. Runs only in main; it imports no node:fs, node:fs/promises or
// node:child_process.

import { detectCommands, rootMarkerFiles } from '../commands/detect';
import { toolEnvironment, type Environment } from '../env';
import {
  CHECK_IDS,
  codeHostOf,
  inferTracker,
  parseOrigin,
  type CheckId,
  type ProjectCheck,
  type ProjectChecks,
} from '../../shared/project-checks';
import { scanSpecFolders, type SpecFolder } from '../workflow/spec-folders';
import { PROJECT_UNREACHABLE } from './registry';

/** The title of each check, as the wizard and the projects screen show it. */
const TITLES: Readonly<Record<CheckId, string>> = {
  git: 'Git repository',
  'code-host': 'Code host',
  tracker: 'Tracker',
  'test-command': 'Test command',
  'earlier-specs': 'Earlier specs',
};

/** The fixed detail of a check that threw. The error text is never used. */
const COULD_NOT_RUN = 'The check could not run';

/** The detail and fix shared by the two tracker results. */
const TRACKER_DETAIL = 'Not connected. Without it, tickets are typed by hand.';
const TRACKER_FIX = "Connecting a tracker comes later; you can add it from the project's settings";

/** The marker file that shows each test program's project type. */
const MARKER_BY_PROGRAM: ReadonlyMap<string, string> = new Map([
  ['pnpm', 'package.json'],
  ['npm', 'package.json'],
  ['yarn', 'package.json'],
  ['bun', 'package.json'],
  ['go', 'go.mod'],
  ['cargo', 'Cargo.toml'],
]);

/** What the checks share while one run goes on. */
interface RunContext {
  readonly env: Environment;
  readonly root: string;
  /** True once the git check has failed: the code host check then does not run. */
  gitFailed: boolean;
  /** The code host's name from the origin remote, or null. */
  codeHostName: string | null;
  /** The spec folder scan, started once and shared by the tracker and earlier-specs checks. */
  scan: Promise<SpecFolder[]> | null;
}

/**
 * True when the environment cannot be reached now. A state read that throws counts as unreachable, so
 * a broken environment runs nothing.
 */
function isUnreachable(env: Environment): boolean {
  try {
    return env.connection.state() === 'unreachable';
  } catch {
    return true;
  }
}

/** A check that did not run, with its fixed detail. */
function notChecked(id: CheckId, detail: string): ProjectCheck {
  return { id, status: 'not-checked', title: TITLES[id], detail };
}

/** A check that threw: a fixed failure, never the error text. */
function couldNotRun(id: CheckId): ProjectCheck {
  return { id, status: 'fail', title: TITLES[id], detail: COULD_NOT_RUN };
}

/** The spec folder scan, run once per check run. */
function scanOnce(ctx: RunContext): Promise<SpecFolder[]> {
  if (ctx.scan === null) ctx.scan = scanSpecFolders(ctx.env, ctx.root);
  return ctx.scan;
}

/** The git failure codes as a check result. The detail and fix are the design's fixed texts. */
function gitFailure(code: 'not-a-repo' | 'git-missing' | 'timeout' | 'failed'): ProjectCheck {
  if (code === 'not-a-repo') {
    return {
      id: 'git',
      status: 'fail',
      title: TITLES.git,
      detail: 'Not a git repository',
      fix: "Run git init in this folder, or pick the repository's folder",
    };
  }
  if (code === 'git-missing') {
    return {
      id: 'git',
      status: 'fail',
      title: TITLES.git,
      detail: 'Git is not installed in this environment',
      fix: 'Install git in this environment',
    };
  }
  return { id: 'git', status: 'fail', title: TITLES.git, detail: 'Git did not answer' };
}

/** The git repository check: the branch (or a detached head) and the number of changed files. */
async function gitCheck(ctx: RunContext): Promise<ProjectCheck> {
  const head = await ctx.env.git.currentBranch(ctx.root);
  if (!head.ok) return gitFailure(head.code);
  const changes = await ctx.env.git.changedPaths(ctx.root);
  if (!changes.ok) return gitFailure(changes.code);
  const label = 'branch' in head.value ? `Branch ${head.value.branch}` : 'Detached HEAD';
  const count = changes.value.length;
  const state = count === 0 ? 'clean' : count === 1 ? '1 changed file' : `${count} changed files`;
  return { id: 'git', status: 'ok', title: TITLES.git, detail: `${label} · ${state}` };
}

/** The code host check: the host of the origin remote, named. No URL, user or token is ever in it. */
async function codeHostCheck(ctx: RunContext): Promise<ProjectCheck> {
  if (ctx.gitFailed) return notChecked('code-host', 'Needs a git repository');
  const origin = await ctx.env.git.originUrl(ctx.root);
  if (!origin.ok) {
    return {
      id: 'code-host',
      status: 'warn',
      title: TITLES['code-host'],
      detail: 'The origin remote could not be read',
    };
  }
  if (origin.value === null) {
    return {
      id: 'code-host',
      status: 'warn',
      title: TITLES['code-host'],
      detail: 'No origin remote',
      fix: 'Add an origin remote to ship to a code host',
    };
  }
  const parsed = parseOrigin(origin.value);
  if (parsed === null) {
    return {
      id: 'code-host',
      status: 'warn',
      title: TITLES['code-host'],
      detail: 'The origin remote is not a code host',
    };
  }
  const name = codeHostOf(parsed.host);
  ctx.codeHostName = name;
  return {
    id: 'code-host',
    status: 'ok',
    title: `Code host: ${name}`,
    detail: 'From the origin remote',
  };
}

/** The tracker check: inferred from the spec tickets and the code host, never connected (D8). */
async function trackerCheck(ctx: RunContext): Promise<ProjectCheck> {
  const folders = await scanOnce(ctx);
  const ids = folders.map((folder) => folder.parsed.specs.ticket).filter((id) => id !== '');
  const name = inferTracker(ids, ctx.codeHostName);
  return {
    id: 'tracker',
    status: 'warn',
    title: name === null ? TITLES.tracker : `Tracker: ${name}`,
    detail: TRACKER_DETAIL,
    fix: TRACKER_FIX,
  };
}

/** The test command check: the first test form the detector finds. The command is only detected. */
async function testCommandCheck(ctx: RunContext): Promise<ProjectCheck> {
  const markers = await rootMarkerFiles(toolEnvironment(ctx.env), ctx.root);
  const form = detectCommands(markers).test[0];
  if (form === undefined) {
    return {
      id: 'test-command',
      status: 'warn',
      title: TITLES['test-command'],
      detail: 'No test command found',
      fix: 'Add a test script, for example "test" in package.json',
    };
  }
  const args = form.args.length > 0 ? ` ${form.args.join(' ')}` : '';
  const marker = MARKER_BY_PROGRAM.get(form.program);
  const from = marker === undefined ? '' : ` in ${marker}`;
  return {
    id: 'test-command',
    status: 'ok',
    title: TITLES['test-command'],
    detail: `Found ${form.program}${args}${from}`,
  };
}

/** The earlier specs check: how many feature folders docs/specs holds. */
async function earlierSpecsCheck(ctx: RunContext): Promise<ProjectCheck> {
  const count = (await scanOnce(ctx)).length;
  return {
    id: 'earlier-specs',
    status: 'info',
    title: TITLES['earlier-specs'],
    detail: count > 0 ? `${count} found in docs/specs` : 'None yet',
  };
}

/** Each check, by id. */
const CHECKS: Readonly<Record<CheckId, (ctx: RunContext) => Promise<ProjectCheck>>> = {
  git: gitCheck,
  'code-host': codeHostCheck,
  tracker: trackerCheck,
  'test-command': testCommandCheck,
  'earlier-specs': earlierSpecsCheck,
};

/** Runs one check. A throw becomes that check's fixed failure, and no other check is affected. */
async function runOne(ctx: RunContext, id: CheckId): Promise<ProjectCheck> {
  try {
    return await CHECKS[id](ctx);
  } catch {
    return couldNotRun(id);
  }
}

/**
 * The five project checks of a project folder, in CHECK_IDS order, through its environment (D41, D45).
 * Before each check the connection state is read again; once it is unreachable, that check and every
 * later one are not checked, and nothing else runs. Never rejects.
 */
export async function runProjectChecks(env: Environment, root: string): Promise<ProjectChecks> {
  try {
    const ctx: RunContext = { env, root, gitFailed: false, codeHostName: null, scan: null };
    const checks: ProjectCheck[] = [];
    let blocked = false;
    for (const id of CHECK_IDS) {
      if (!blocked && isUnreachable(env)) blocked = true;
      if (blocked) {
        checks.push(notChecked(id, PROJECT_UNREACHABLE));
        continue;
      }
      const check = await runOne(ctx, id);
      if (id === 'git') ctx.gitFailed = check.status === 'fail';
      checks.push(check);
    }
    return { checks };
  } catch {
    return { checks: CHECK_IDS.map((id) => couldNotRun(id)) };
  }
}
