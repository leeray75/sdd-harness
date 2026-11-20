// Main-side runner for the run_command tool. Starts one program with an argument array,
// never through a shell, inside the root, with a minimal environment, a timeout that kills
// the whole process tree, and a capped output tail. Refuses git, and on Windows refuses
// .cmd and .bat programs, before anything is started. Runs only in main, only after the gate
// allows the call. Reasons are fixed strings: they never echo the program, arguments or output.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { MAX_TOOL_OUTPUT_LENGTH } from '../../shared/agent-protocol';
import type { RunCommandArgs } from '../../shared/tools';
import type { ToolRunResult } from '../agent/router';
import { resolveInRoot } from './paths';

/** The timeout when main does not give one: 10 minutes. The agent cannot set it. */
export const COMMAND_DEFAULT_TIMEOUT_MS = 600_000;

/** Bytes of combined output kept (the tail). Room is left for the status and cut lines. */
export const COMMAND_OUTPUT_TAIL_BYTES = MAX_TOOL_OUTPUT_LENGTH - 512;

/** How long to wait for the output streams after the process exits, for a grandchild that holds them open. */
const STREAM_GRACE_MS = 250;

export interface RunCommandOptions {
  /** Timeout in milliseconds, set by main. Ignored unless it is a positive integer. */
  timeoutMs?: number;
  /** The platform to act for. Defaults to the running one; tests set it. */
  platform?: NodeJS.Platform;
}

const NO_PROGRAM = 'program must not be empty';
const GIT_REFUSED = 'git is not allowed: run_command never runs git';
const CMD_REFUSED = 'programs ending in .cmd or .bat cannot run on Windows through this tool';
const CWD_NOT_FOLDER = 'cwd is not a folder inside the root';
const START_FAILED = 'the program could not be started';
const TRUNCATED_NOTE = 'output cut: the earliest output was dropped; the last part is shown';

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
 * The reason a program is refused before it starts, or null when it may start. Git is refused
 * by base name, ignoring case and a .exe, .cmd or .bat extension. On Windows, .cmd and .bat
 * programs are refused, because they cannot run without a shell.
 */
export function programRefusal(program: string, platform: NodeJS.Platform): string | null {
  if (program.length === 0) {
    return NO_PROGRAM;
  }
  const base = (program.split(/[\\/]/).pop() ?? '').toLowerCase();
  const stripped = base.replace(/\.(exe|cmd|bat)$/, '');
  if (stripped === 'git') {
    return GIT_REFUSED;
  }
  if (platform === 'win32' && /\.(cmd|bat)$/.test(base)) {
    return CMD_REFUSED;
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

/**
 * Runs `args.program` with `args.args`, inside the root (or `args.cwd`, a folder inside it).
 * Returns ok with the exit status and the output tail, whatever the exit code. Returns failed
 * for a refused program or cwd, or a program that cannot be started.
 */
export async function runCommandInRoot(
  root: unknown,
  args: RunCommandArgs,
  options: RunCommandOptions = {},
): Promise<ToolRunResult> {
  const platform = options.platform ?? process.platform;
  const refusal = programRefusal(args.program, platform);
  if (refusal !== null) {
    return { ok: false, reason: refusal };
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

  return new Promise<ToolRunResult>((resolvePromise) => {
    let child: ChildProcess;
    try {
      child = spawn(args.program, args.args, {
        cwd: resolved.target,
        env: commandEnv(process.env, platform),
        shell: false,
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
