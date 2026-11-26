import { existsSync, lstatSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  WSL_GROUP_MARKER,
  WSL_LAUNCHER,
  type WslRunOptions,
  type WslRunResult,
  type WslTransport,
} from '../../src/main/env/wsl';

// A fake WSL transport (D42, p4-env-wsl). It never starts wsl.exe. Each run is recorded with its argument
// array and its environment, then answered from the script the test sets: the launcher's group line and
// output, the probe, the kill, git's output for a given argument list, the fixed ln and chmod commands,
// a stall that waits for an abort or a timeout, and a transport that cannot start. Its share root is a
// temp folder that stands for the distribution's `/`.

/** The real text wsl.exe writes when git cannot be started in the distribution (exit code 1). */
export const GIT_MISSING_STDERR =
  '<3>WSL (4242 - Relay) ERROR: CreateProcessCommon:800: execvpe(git) failed: No such file or directory\n';

/** The real text wsl.exe writes when the program cannot be started (exit code 1), for any name. */
export function programMissingStderr(name: string): string {
  return `<3>WSL (4242 - Relay) ERROR: CreateProcessCommon:800: execvpe(${name}) failed: No such file or directory\n`;
}

/** One program's answer: its chunks of output (after the group line) and its exit code, or a stall. */
export interface FakeProgram {
  code?: number;
  chunks?: Array<string | Buffer>;
  stall?: boolean;
}

/** One git call's answer. */
export interface FakeGit {
  code?: number;
  stdout?: string;
  stderr?: string;
  stall?: boolean;
  /** Reports the call as timed out at once (the real limit is 30 s). */
  timedOut?: boolean;
  truncated?: boolean;
}

export interface FakeScript {
  /** The id the launcher prints after its marker; null prints no marker. Default 4242. */
  groupId?: number | null;
  /** The answer for a launched program, given its file and arguments. */
  program?: (argv: readonly string[]) => FakeProgram;
  /** Whether the unshare probe passes. Default false. */
  probe?: boolean;
  /** The answer for git, given its arguments (after `git`) and the folder it runs in. */
  git?: (args: readonly string[], cwd: string) => FakeGit;
  /** When true, every run gives { started: false }. */
  cannotStart?: boolean;
  /** When true, the reconnect command (`--exec true`) reports a distribution that wsl.exe does not have. */
  distroMissing?: boolean;
  /** The share root the transport reports now. A test sets a missing folder to simulate a missing share. */
  share?: string;
}

/** One recorded run: the argument array as given, the environment, the timeout and the capture flag. */
export interface FakeCall {
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  capture: boolean;
}

export interface FakeTransport extends WslTransport {
  readonly calls: FakeCall[];
  script: FakeScript;
}

/** Waits for an abort, or for the timeout, whichever comes first. */
function stallUntil(options: WslRunOptions): Promise<WslRunResult> {
  return new Promise((resolve) => {
    const finish = (timedOut: boolean, aborted: boolean): void => {
      clearTimeout(timer);
      resolve({ started: true, code: null, signal: 'SIGKILL', timedOut, aborted });
    };
    const timer = setTimeout(() => finish(true, false), options.timeoutMs);
    if (options.signal?.aborted === true) finish(false, true);
    else options.signal?.addEventListener('abort', () => finish(false, true), { once: true });
  });
}

/** The index after `--exec`, or -1 when the argument array has none. */
function execIndex(argv: readonly string[]): number {
  return argv.indexOf('--exec');
}

/** A fake transport over a temp share root. */
export function fakeWslTransport(shareRoot: string, script: FakeScript = {}): FakeTransport {
  const calls: FakeCall[] = [];
  const transport: FakeTransport = {
    get shareRoot() {
      return transport.script.share ?? shareRoot;
    },
    rediscover: () => transport.shareRoot,
    calls,
    script,
    run: async (argv, options) => {
      calls.push({
        argv: [...argv],
        env: options.env,
        timeoutMs: options.timeoutMs,
        capture: options.capture !== undefined,
      });
      if (transport.script.cannotStart === true) return { started: false };
      const at = execIndex(argv);
      const command = at >= 0 ? argv[at + 1] : undefined;
      const after = at >= 0 ? argv.slice(at + 2) : [];

      if (command === 'sh' && after[0] === '-c' && after[1] === WSL_LAUNCHER) {
        // The launcher: its arguments after `sh -c LAUNCHER sh` are the program and its arguments.
        const programArgv = after.slice(3);
        const program = transport.script.program?.(programArgv) ?? { code: 0 };
        const groupId = transport.script.groupId === undefined ? 4242 : transport.script.groupId;
        if (groupId !== null) options.onOutput?.(Buffer.from(`${WSL_GROUP_MARKER}${groupId}\n`));
        if (program.stall === true) return stallUntil(options);
        for (const chunk of program.chunks ?? []) {
          options.onOutput?.(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        return {
          started: true,
          code: program.code ?? 0,
          signal: null,
          timedOut: false,
          aborted: false,
        };
      }

      if (command === 'git') {
        const cwdAt = argv.indexOf('--cd');
        const cwd = cwdAt >= 0 ? (argv[cwdAt + 1] ?? '') : '';
        const answer: FakeGit = transport.script.git?.(after, cwd) ?? { code: 0, stdout: '' };
        if (answer.stall === true) return stallUntil(options);
        return {
          started: true,
          code: answer.timedOut === true ? null : (answer.code ?? 0),
          signal: null,
          timedOut: answer.timedOut === true,
          aborted: false,
          stdout: Buffer.from(answer.stdout ?? ''),
          stderr: Buffer.from(answer.stderr ?? ''),
          truncated: answer.truncated === true,
        };
      }

      if (command === 'unshare') {
        return {
          started: true,
          code: transport.script.probe === true ? 0 : 1,
          signal: null,
          timedOut: false,
          aborted: false,
        };
      }
      if (command === 'kill') {
        return { started: true, code: 0, signal: null, timedOut: false, aborted: false };
      }
      if (command === 'true') {
        // The reconnect command: it starts a stopped distribution, or reports a missing one (exit 127).
        if (transport.script.distroMissing === true) {
          return {
            started: true,
            code: 127,
            signal: null,
            timedOut: false,
            aborted: false,
            ...(options.capture === undefined
              ? {}
              : {
                  stdout: Buffer.alloc(0),
                  stderr: Buffer.from(
                    'There is no distribution with the supplied name.\nError code: Wsl/Service/WSL_E_DISTRO_NOT_FOUND\n',
                    'utf16le',
                  ),
                  truncated: false,
                }),
          };
        }
        return { started: true, code: 0, signal: null, timedOut: false, aborted: false };
      }
      if (command === 'ln') {
        return {
          started: true,
          code: linkCode(argv),
          signal: null,
          timedOut: false,
          aborted: false,
        };
      }
      if (command === 'chmod') {
        const target = argv[argv.length - 1] ?? '';
        return {
          started: true,
          code: existsSync(sharePathOf(target)) ? 0 : 1,
          signal: null,
          timedOut: false,
          aborted: false,
        };
      }
      return { started: true, code: 127, signal: null, timedOut: false, aborted: false };
    },
  };

  /** The share path of a Linux path, for the fake's own checks (the backend has its own mapping). */
  function sharePathOf(linux: string): string {
    return join(shareRoot, ...linux.split('/').filter((segment) => segment !== ''));
  }

  /** The exit code of a fake `ln -s -- target path`: 1 when the path exists or its folder does not, else 0. */
  function linkCode(argv: readonly string[]): number {
    const path = argv[argv.length - 1] ?? '';
    const mapped = sharePathOf(path);
    if (isPresent(mapped)) return 1;
    if (!existsSync(join(mapped, '..'))) return 1;
    return 0;
  }

  return transport;
}

/** lstat-style presence check, for the fake's own use. */
function isPresent(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** A stat of a share path, for tests that check what the fake's folder holds. */
export function shareStat(path: string): ReturnType<typeof statSync> {
  return statSync(path);
}
