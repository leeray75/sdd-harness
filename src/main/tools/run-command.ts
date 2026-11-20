// Main-side runner for the run_command tool. Starts one program with an argument array,
// never through a shell, inside the root, with a minimal environment, a timeout that kills
// the whole process tree, and a capped output tail. Refuses git before anything is started.
// The call is checked again against the job's command check (D31). A program is found on
// PATH; on Windows a .cmd or .bat it resolves to runs through cmd.exe, and only when the
// check allowed it and its arguments are safe tokens. Around the run, the protected files are
// read-only while it runs and reverted after it (D31); the writer's command gets the network
// limit. Runs only in main, only after the gate allows the call. Reasons are fixed strings:
// they never echo the program, arguments, paths or output.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { MAX_TOOL_OUTPUT_LENGTH, type JobId } from '../../shared/agent-protocol';
import type { RunCommandArgs } from '../../shared/tools';
import type { ToolRunResult } from '../agent/router';
import { cmdExeFor, cmdLineFor, isCommandScript, resolveProgram } from '../commands/lookup';
import { chooseNetwork, probeNetwork, wrapCommand, writerNetworkEnv } from '../commands/network';
import {
  lockSpecFolder,
  restoreAfterRun,
  snapshotForRun,
  type RestoreResult,
  type RevertArea,
} from '../commands/protect';
import { NOT_A_COMMAND_JOB } from '../policy/command-allowlist';
import type { CommandCall, CommandCheck } from '../policy/context';
import { makeNetworkEvent, makeRevertEvent, type RuleEvent } from '../policy/rule-event';
import { resolveInRoot } from './paths';

/** The timeout when main does not give one: 10 minutes. The agent cannot set it. */
export const COMMAND_DEFAULT_TIMEOUT_MS = 600_000;

/** Bytes of combined output kept (the tail). Room is left for the status and cut lines. */
export const COMMAND_OUTPUT_TAIL_BYTES = MAX_TOOL_OUTPUT_LENGTH - 512;

/** How long to wait for the output streams after the process exits, for a grandchild that holds them open. */
const STREAM_GRACE_MS = 250;

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
  /** The platform to act for. Defaults to the running one; tests set it. */
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

/** Stops the process and everything it started: taskkill /T on Windows, the process group elsewhere. */
function killTree(child: ChildProcess, platform: NodeJS.Platform): void {
  const pid = child.pid;
  if (pid === undefined) {
    return;
  }
  try {
    if (platform === 'win32') {
      execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // The process has already gone.
    }
  }
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
  platform: NodeJS.Platform;
  timeoutMs: number;
  /** True for a cmd.exe line, which Node must pass without quoting it again. */
  verbatim: boolean;
}

/**
 * Starts the process and waits for it, with the timeout and the output tail. Returns ok with the
 * status and the tail, or failed when the process cannot be started. Never rejects.
 */
function runProcess(plan: ProcessPlan): Promise<ToolRunResult> {
  const { platform, timeoutMs } = plan;
  return new Promise<ToolRunResult>((resolvePromise) => {
    let child: ChildProcess;
    try {
      child = spawn(plan.file, plan.argv, {
        cwd: plan.cwd,
        env: plan.env,
        shell: false,
        windowsVerbatimArguments: plan.verbatim,
        windowsHide: true,
        // On POSIX the child leads its own process group, so a timeout can kill its children too.
        detached: platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      resolvePromise({ ok: false, reason: START_FAILED });
      return;
    }

    let settled = false;
    let graceTimer: NodeJS.Timeout | undefined;
    let tail: Buffer = Buffer.alloc(0);
    let dropped = false;

    // The timeout's const is declared below; finish only reads it from callbacks that run later.
    const finish = (result: ToolRunResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutTimer);
      if (graceTimer !== undefined) clearTimeout(graceTimer);
      resolvePromise(result);
    };

    const withOutput = (status: string): ToolRunResult => {
      const text = tail.toString('utf8');
      const cut = dropped ? `${TRUNCATED_NOTE}\n` : '';
      const body = `${cut}${text}`;
      return { ok: true, output: body.length > 0 ? `${status}\n${body}` : status };
    };

    const onData = (chunk: Buffer): void => {
      if (settled) {
        return;
      }
      tail = Buffer.concat([tail, chunk]);
      if (tail.length > COMMAND_OUTPUT_TAIL_BYTES) {
        tail = tail.subarray(tail.length - COMMAND_OUTPUT_TAIL_BYTES);
        dropped = true;
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    child.on('error', () => {
      // An error before the process started means it could not be started. Later errors
      // (for example a failed kill) do not change the result.
      if (child.pid === undefined) {
        finish({ ok: false, reason: START_FAILED });
      }
    });

    child.on('exit', (code, signal) => {
      if (settled) {
        return;
      }
      // Give the output streams a moment to finish, in case a grandchild still holds them.
      graceTimer = setTimeout(() => finish(withOutput(statusLine(code, signal))), STREAM_GRACE_MS);
    });

    child.on('close', (code, signal) => {
      finish(withOutput(statusLine(code, signal)));
    });

    const timeoutTimer = setTimeout(() => {
      killTree(child, platform);
      finish(withOutput(`timed out after ${timeoutMs} ms; the process tree was killed`));
    }, timeoutMs);
  });
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
 * snapshotted (refused over the cap); the writer's command gets the network limit; the spec
 * folder is locked; the program runs; the protected set is restored, whatever happened.
 * Returns ok with the exit status, the output tail and one line per area reverted, whatever the
 * exit code. Returns failed for any refusal before the run, and for a program that cannot start.
 * Nothing is started before the checks before the run have passed.
 */
export async function runCommandInRoot(
  root: unknown,
  args: RunCommandArgs,
  context: CommandContext,
  options: RunCommandOptions = {},
): Promise<ToolRunResult> {
  const platform = options.platform ?? process.platform;
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

  const env = commandEnv(options.parentEnv ?? process.env, platform);
  const lookup = resolveProgram(args.program, env, platform);
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
    command = cmdExeFor(env);
    commandArgs = ['/d', '/s', '/c', line.line];
  }

  const resolved = await resolveInRoot(root, args.cwd ?? '.', { mustExist: true });
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason };
  }
  try {
    if (!(await fs.stat(resolved.target)).isDirectory()) {
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
  const protection = await snapshotForRun({
    root: resolved.root,
    job,
    env,
    maxBytes: options.protectMaxBytes,
  });
  if (!protection.ok) {
    return { ok: false, reason: protection.reason };
  }
  const snapshot = protection.snapshot;

  // The writer's command gets the network limit and the dead proxies; the reviewer's, nothing.
  let spawnCommand = command;
  let spawnArgs = commandArgs;
  let spawnEnv = env;
  if (job === 'writer') {
    const network = chooseNetwork(platform, await probeNetwork(platform));
    const wrapped = wrapCommand(network, command, commandArgs);
    spawnCommand = wrapped.command;
    spawnArgs = wrapped.args;
    spawnEnv = { ...env, ...writerNetworkEnv() };
    emit(makeNetworkEvent(args.program, network.level));
  }

  // The lock and the run sit in a try, and the restore is in the finally, so it runs after a
  // timeout, a start failure or a failed lock alike. A failed lock means the command never ran.
  let outcome: ToolRunResult | null;
  let restore: RestoreResult;
  try {
    await lockSpecFolder(snapshot);
    outcome = await runProcess({
      file: spawnCommand,
      argv: spawnArgs,
      cwd: resolved.target,
      env: spawnEnv,
      platform,
      timeoutMs,
      verbatim: viaCmd,
    });
  } catch {
    outcome = null;
  } finally {
    restore = await restoreAfterRun(snapshot);
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
