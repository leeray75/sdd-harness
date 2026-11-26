// Main-side runner for the run_command tool. Starts one program with an argument array,
// never through a shell, inside the root, with a minimal environment, a timeout that kills
// the whole process tree, and a capped output tail. Refuses git before anything is started.
// The call is checked again against the job's command check (D31). A program is found on
// PATH; on Windows a .cmd or .bat it resolves to runs through cmd.exe, and only when the
// check allowed it and its arguments are safe tokens. Around the run, the protected files are
// read-only while it runs and reverted after it (D31); the writer's command gets the network
// limit. The process is started through the environment (D41), which holds the timeout, the
// tree kill and the network limit. Runs only in main, only after the gate allows the call.
// Reasons are fixed strings: they never echo the program, arguments, paths or output.

import { MAX_TOOL_OUTPUT_LENGTH, type JobId } from '../../shared/agent-protocol';
import type { RunCommandArgs } from '../../shared/tools';
import type { ToolRunResult } from '../agent/router';
import { cmdExeFor, cmdLineFor, isCommandScript, resolveProgram } from '../commands/lookup';
import {
  lockSpecFolder,
  restoreAfterRun,
  snapshotForRun,
  type RestoreResult,
  type RevertArea,
} from '../commands/protect';
import type { ToolEnvironment } from '../env/types';
import { NOT_A_COMMAND_JOB } from '../policy/command-allowlist';
import type { CommandCall, CommandCheck } from '../policy/context';
import { makeNetworkEvent, makeRevertEvent, type RuleEvent } from '../policy/rule-event';
import { resolveInRoot } from './paths';

/** The timeout when main does not give one: 10 minutes. The agent cannot set it. */
export const COMMAND_DEFAULT_TIMEOUT_MS = 600_000;

/** Bytes of combined output kept (the tail). Room is left for the status and cut lines. */
export const COMMAND_OUTPUT_TAIL_BYTES = MAX_TOOL_OUTPUT_LENGTH - 512;

/** Who is asking, the check that decides it, and where the events of the call go. Set by main. */
export interface CommandContext {
  job: JobId;
  check: CommandCheck;
  /** Receives the network and revert events of the call. Unset means none are reported. */
  onRuleEvent?: (event: RuleEvent) => void;
}

export interface RunCommandOptions {
  /** Timeout in milliseconds, set by main. Ignored unless it is a positive integer. */
  timeoutMs?: number;
  /** The platform to act for. Defaults to the environment's; tests set it. */
  platform?: NodeJS.Platform;
  /** The parent environment the minimal one is taken from. Defaults to the app's; tests set it. */
  parentEnv?: NodeJS.ProcessEnv;
  /** The byte cap on the protected files; the default is 256 MiB. Tests lower it. */
  protectMaxBytes?: number;
}

const NO_PROGRAM = 'program must not be empty';
const GIT_REFUSED = 'git is not allowed: run_command never runs git';
const CWD_NOT_FOLDER = 'cwd is not a folder inside the root';
const START_FAILED = 'the program could not be started';
const LOCK_FAILED = 'the spec folder could not be made read-only, so the command was not run';
const PARTIAL_RESTORE = 'some protected files could not be put back';
const TRUNCATED_NOTE = 'output cut: the earliest output was dropped; the last part is shown';

/** The result lines for the areas a restore reverted, in a fixed order. */
const AREA_LINES: ReadonlyArray<readonly [RevertArea, string]> = [
  ['docs/specs', 'reverted changes in docs/specs'],
  ['.git', 'reverted changes in .git'],
  ['project files', 'reverted changes to project files'],
];

const WINDOWS_VARS = ['PATH', 'SystemRoot', 'TEMP', 'TMP', 'USERPROFILE'];
const OTHER_VARS = ['PATH', 'HOME', 'TMPDIR'];

/** Upper-cases names on win32, where environment names are case-insensitive. */
function compareKey(name: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? name.toUpperCase() : name;
}

/**
 * The environment a command gets: only the basics for the platform, with the parent's
 * spelling of each name. Every other variable of the app, keys included, is dropped.
 */
export function commandEnv(
  parent: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): NodeJS.ProcessEnv {
  const wanted = platform === 'win32' ? WINDOWS_VARS : OTHER_VARS;
  const env: NodeJS.ProcessEnv = {};
  for (const name of wanted) {
    const key = Object.keys(parent).find(
      (candidate) =>
        parent[candidate] !== undefined &&
        compareKey(candidate, platform) === compareKey(name, platform),
    );
    if (key !== undefined) {
      env[key] = parent[key];
    }
  }
  return env;
}

/**
 * The reason a program is refused before anything else, or null when it may go on. Git is
 * refused by base name, ignoring case and a .exe, .cmd or .bat extension, and an empty program
 * is refused. A .cmd or .bat is not refused here: it runs only through the command check and
 * cmd.exe, see runCommandInRoot.
 */
export function programRefusal(program: string): string | null {
  if (program.length === 0) {
    return NO_PROGRAM;
  }
  const base = (program.split(/[\\/]/).pop() ?? '').toLowerCase();
  const stripped = base.replace(/\.(exe|cmd|bat)$/, '');
  if (stripped === 'git') {
    return GIT_REFUSED;
  }
  return null;
}

function statusLine(code: number | null, signal: NodeJS.Signals | null): string {
  if (code !== null) {
    return `exit code ${code}`;
  }
  return `terminated by signal ${signal ?? 'unknown'}`;
}

/** What one started process needs: the file and arguments to start, and how to run it. */
interface ProcessPlan {
  file: string;
  argv: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  /** The network policy: the writer's command is `none`, the reviewer's `normal`. */
  network: 'normal' | 'none';
  /** True for a cmd.exe line, which Node must pass without quoting it again. */
  verbatim: boolean;
}

/**
 * Starts the process through the environment and waits for it, with the output tail. Returns ok
 * with the status and the tail, or failed when the process cannot be started. Never rejects.
 */
async function runProcess(env: ToolEnvironment, plan: ProcessPlan): Promise<ToolRunResult> {
  let tail: Buffer = Buffer.alloc(0);
  let dropped = false;

  const withOutput = (status: string): ToolRunResult => {
    const text = tail.toString('utf8');
    const cut = dropped ? `${TRUNCATED_NOTE}\n` : '';
    const body = `${cut}${text}`;
    return { ok: true, output: body.length > 0 ? `${status}\n${body}` : status };
  };

  const outcome = await env.process.spawn(plan.file, plan.argv, {
    cwd: plan.cwd,
    env: plan.env,
    timeoutMs: plan.timeoutMs,
    network: plan.network,
    verbatimArguments: plan.verbatim,
    onOutput: (chunk) => {
      tail = Buffer.concat([tail, chunk]);
      if (tail.length > COMMAND_OUTPUT_TAIL_BYTES) {
        tail = tail.subarray(tail.length - COMMAND_OUTPUT_TAIL_BYTES);
        dropped = true;
      }
    },
  });
  if (!outcome.started) {
    return { ok: false, reason: START_FAILED };
  }
  if (outcome.timedOut) {
    return withOutput(`timed out after ${plan.timeoutMs} ms; the process tree was killed`);
  }
  return withOutput(statusLine(outcome.code, outcome.signal));
}

/** The result lines for the areas a restore reverted, and one for a partial restore. */
function revertLines(restore: RestoreResult): string[] {
  const lines = AREA_LINES.filter(([area]) =>
    restore.records.some((record) => record.area === area),
  ).map(([, line]) => line);
  if (restore.incomplete) {
    lines.push(PARTIAL_RESTORE);
  }
  return lines;
}

/**
 * Runs `args.program` with `args.args`, inside the root (or `args.cwd`, a folder inside it).
 *
 * Order: the program is refused by git; the check decides the call again; the program is found
 * on PATH; a Windows script gets a safe cmd.exe line; the cwd is checked; the protected files are
 * snapshotted (refused over the cap); the writer's command gets the network limit (its level is
 * reported before anything starts); the spec folder is locked; the program runs; the protected
 * set is restored, whatever happened. Returns ok with the exit status, the output tail and one
 * line per area reverted, whatever the exit code. Returns failed for any refusal before the run,
 * and for a program that cannot start. Nothing is started before the checks before the run have
 * passed.
 */
export async function runCommandInRoot(
  env: ToolEnvironment,
  root: unknown,
  args: RunCommandArgs,
  context: CommandContext,
  options: RunCommandOptions = {},
): Promise<ToolRunResult> {
  const platform = options.platform ?? env.process.platform;
  const refusal = programRefusal(args.program);
  if (refusal !== null) {
    return { ok: false, reason: refusal };
  }

  // The same check the gate ran, applied again here: a second layer under the gate.
  const call: CommandCall = {
    job: context.job,
    program: args.program,
    args: [...args.args],
    ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
  };
  const verdict = context.check(call);
  if (!verdict.allow) {
    return { ok: false, reason: verdict.reason };
  }
  const job = context.job;
  if (job !== 'writer' && job !== 'reviewer') {
    return { ok: false, reason: NOT_A_COMMAND_JOB };
  }
  const emit = (event: RuleEvent): void => context.onRuleEvent?.(event);

  const childEnv = commandEnv(options.parentEnv ?? process.env, platform);
  const lookup = await resolveProgram(env, args.program, childEnv, platform);
  if (!lookup.ok) {
    return { ok: false, reason: lookup.reason };
  }
  let command = lookup.file;
  let commandArgs = [...args.args];
  const viaCmd = platform === 'win32' && isCommandScript(lookup.file);
  if (viaCmd) {
    const line = cmdLineFor(lookup.file, args.args);
    if (!line.ok) {
      return { ok: false, reason: line.reason };
    }
    command = cmdExeFor(childEnv);
    commandArgs = ['/d', '/s', '/c', line.line];
  }

  const resolved = await resolveInRoot(env, root, args.cwd ?? '.', { mustExist: true });
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason };
  }
  try {
    if (!(await env.files.stat(resolved.target)).isDirectory()) {
      return { ok: false, reason: CWD_NOT_FOLDER };
    }
  } catch {
    return { ok: false, reason: CWD_NOT_FOLDER };
  }

  const timeoutMs =
    options.timeoutMs !== undefined && Number.isInteger(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : COMMAND_DEFAULT_TIMEOUT_MS;

  // The protected set is taken before anything changes; over the cap, nothing starts.
  const protection = await snapshotForRun(env, {
    root: resolved.root,
    job,
    env: childEnv,
    maxBytes: options.protectMaxBytes,
  });
  if (!protection.ok) {
    return { ok: false, reason: protection.reason };
  }
  const snapshot = protection.snapshot;

  // The writer's command gets the network limit; the reviewer's gets nothing. The level is
  // reported here, before the lock, as it always was.
  const network = job === 'writer' ? 'none' : 'normal';
  if (network === 'none') {
    emit(makeNetworkEvent(args.program, await env.process.networkLevel()));
  }

  // The lock and the run sit in a try, and the restore is in the finally, so it runs after a
  // timeout, a start failure or a failed lock alike. A failed lock means the command never ran.
  let outcome: ToolRunResult | null;
  let restore: RestoreResult;
  try {
    await lockSpecFolder(env, snapshot);
    outcome = await runProcess(env, {
      file: command,
      argv: commandArgs,
      cwd: resolved.target,
      env: childEnv,
      timeoutMs,
      network,
      verbatim: viaCmd,
    });
  } catch {
    outcome = null;
  } finally {
    restore = await restoreAfterRun(env, snapshot);
  }
  for (const record of restore.records) {
    emit(makeRevertEvent(job, record.path, record.action));
  }

  const lines = revertLines(restore);
  const result: ToolRunResult = outcome ?? { ok: false, reason: LOCK_FAILED };
  if (!result.ok) {
    return lines.length === 0
      ? result
      : { ok: false, reason: [result.reason, ...lines].join('; ') };
  }
  return { ok: true, output: [result.output, ...lines].join('\n') };
}
