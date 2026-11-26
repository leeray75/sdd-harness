// The WSL backend of the environment interface (D41, D42, p4-env-wsl). One object serves one WSL
// distribution and one Linux root. Files use node:fs on the distribution's share (\\wsl.localhost\<distro>,
// or \\wsl$\<distro>); programs and git run through wsl.exe; watching polls one folder. The Linux-to-share
// mapping lives only in this module. Nothing here falls back to the local backend: a failing transport
// is a result for each call (a Node code, { started: false }, or a git code), never a throw that escapes.
//
// The transport is injectable (WslTransport). The app's transport (appWslTransport) is the only code
// here that starts wsl.exe, apart from detection in wsl-detect.ts. The tests use a fake transport over
// a temp folder (tests/support/fake-wsl-transport.ts). Runs only in main.

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { constants, existsSync, promises as fsp, realpath as nodeRealpath } from 'node:fs';
import { isAbsolute as nativeIsAbsolute, join, posix, relative, sep as nativeSep } from 'node:path';
import { chooseNetwork, wrapCommand, writerNetworkEnv } from '../commands/network';
import { createGit, type GitLauncher } from '../git/git';
import type {
  DirEntryInfo,
  Environment,
  FileHandleLike,
  FilesPart,
  FileStat,
  NetworkLevel,
  ProcessPart,
  SpawnOptions,
  SpawnOutcome,
  WatchHandle,
  WatchPart,
} from './types';

/** The program that starts WSL here. Only this module and wsl-detect.ts name it (AC10). */
const WSL_EXE = 'wsl.exe';

/** The line the launcher prints first: the marker, then the id of the process group it created. */
export const WSL_GROUP_MARKER = 'SDD-GROUP-';

/**
 * The fixed launcher (D42). The outer shell runs `setsid --wait`, which makes the program a new
 * session and process group, with its id as the group id. The inner shell prints the marker and its
 * own id (the group id, since the id is unchanged by exec), then replaces itself with the program
 * from the positional arguments, so no argument is ever parsed by a shell.
 */
export const WSL_LAUNCHER =
  'setsid --wait sh -c \'printf "%s%s\\n" "$0" "$$"; exec "$@"\' ' + WSL_GROUP_MARKER + ' "$@"';

/** The timeouts of the fixed commands, in milliseconds. */
const FIXED_TIMEOUT_MS = 30_000;
const PROBE_TIMEOUT_MS = 10_000;
const KILL_TIMEOUT_MS = 10_000;
/** How long the watcher waits between two listings, in milliseconds. */
export const WSL_POLL_MS = 1_000;
/** Most bytes kept of the marker line before a line break arrives; past it the line is dropped. */
const MARKER_MAX_BYTES = 4096;
/** Grace after a stop: a process tree that keeps the output pipes open cannot hold the result. */
const STOP_GRACE_MS = 2_000;

/** git's own message when wsl.exe cannot start git in the distribution (exit code 1). Read by the launcher only. */
const GIT_MISSING = /execvpe\(git\) failed: No such file or directory/;

/** The environment variable name a WSLENV entry may carry. */
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The options of one run through the transport. */
export interface WslRunOptions {
  /** The environment of the wsl.exe process. The backend works out what crosses through WSLENV. */
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  /** Aborting it kills the wsl.exe process. */
  signal?: AbortSignal;
  /** Receives each chunk of stdout and stderr while the run goes on. */
  onOutput?: (chunk: Buffer) => void;
  /** Collects stdout and stderr, up to maxBytes each, for the caller. */
  capture?: { maxBytes: number };
  stdin?: Buffer | string;
}

/** How a run ended. `started: false` means wsl.exe could not start. Never a rejection. */
export type WslRunResult =
  | { started: false }
  | {
      started: true;
      code: number | null;
      signal: NodeJS.Signals | null;
      timedOut: boolean;
      aborted: boolean;
      stdout?: Buffer;
      stderr?: Buffer;
      /** Set when captured output went past its cap. */
      truncated?: boolean;
    };

/** The seam between the backend and wsl.exe. */
export interface WslTransport {
  /** The folder that stands for the distribution's `/`. Found once, when the transport is made. */
  readonly shareRoot: string;
  /** Starts wsl.exe with the given argument array (no shell). Never rejects. */
  run(argv: readonly string[], options: WslRunOptions): Promise<WslRunResult>;
}

/** The options of the WSL backend. The poll interval is for the tests; it defaults to one second. */
export interface WslEnvironmentOptions {
  distribution: string;
  transport: WslTransport;
  pollMs?: number;
}

interface Ctx {
  readonly distribution: string;
  readonly transport: WslTransport;
}

/** A Node-style error with a code and no path in its text. */
function codeError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: the path is not available in this distribution`), {
    code,
  });
}

/** The variables that cross to the distribution: the caller's, changed or added, never PATH. */
function crossingVariables(env: NodeJS.ProcessEnv): Record<string, string> {
  const changed: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || !VARIABLE_NAME.test(name)) continue;
    if (name.toUpperCase() === 'PATH') continue;
    if (process.env[name] === value) continue;
    changed[name] = value;
  }
  return changed;
}

/** The environment of a wsl.exe process: the app's own, plus the crossing variables named in WSLENV. */
function wslProcessEnv(changed: Record<string, string>): NodeJS.ProcessEnv {
  return { ...process.env, ...changed, WSLENV: Object.keys(changed).join(':') };
}

/** The environment of a wsl.exe process for a caller's environment. */
function envFor(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return wslProcessEnv(crossingVariables(env));
}

/**
 * The share path of a Linux path, or null when the path is not an absolute POSIX path. A segment with a
 * backslash or a colon is refused (null): on Windows such a name would not stay inside the share.
 */
export function shareFor(shareRoot: string, linux: string): string | null {
  if (!posix.isAbsolute(linux) || linux.includes('\0')) return null;
  const segments = posix
    .normalize(linux)
    .split('/')
    .filter((segment) => segment !== '');
  if (segments.some((segment) => segment.includes('\\') || segment.includes(':'))) return null;
  return join(shareRoot, ...segments);
}

/** The Linux path of a share path, or null when it is outside the share. */
function linuxFor(shareRoot: string, sharePath: string): string | null {
  const rel = relative(shareRoot, sharePath);
  if (rel === '') return '/';
  if (rel === '..' || rel.startsWith(`..${nativeSep}`) || nativeIsAbsolute(rel)) return null;
  return `/${rel.split(nativeSep).join('/')}`;
}

/**
 * A result the share gives back (realpath or readlink) as a Linux path. A POSIX-absolute result is
 * already Linux; a relative link target is kept as written; a share path outside the share is ENOENT.
 */
function linuxResult(shareRoot: string, result: string): string {
  if (result.startsWith('/')) return result;
  if (!nativeIsAbsolute(result)) return result;
  const linux = linuxFor(shareRoot, result);
  if (linux === null) throw codeError('ENOENT');
  return linux;
}

/** True when a path exists, lstat-style (a dangling link counts). */
async function exists(path: string): Promise<boolean> {
  try {
    await fsp.lstat(path);
    return true;
  } catch {
    return false;
  }
}

/** Runs one fixed command through the transport. True only for exit code 0 from a started process. */
async function runFixed(ctx: Ctx, argv: string[]): Promise<boolean> {
  const result = await ctx.transport.run(argv, {
    env: wslProcessEnv({}),
    timeoutMs: FIXED_TIMEOUT_MS,
  });
  return result.started && result.code === 0 && !result.timedOut;
}

const pathPart: Environment['path'] = posix;

function wrapHandle(handle: Awaited<ReturnType<typeof fsp.open>>): FileHandleLike {
  return {
    read: async (buffer, offset, length, position) => {
      const result = await handle.read(buffer, offset, length, position);
      return { bytesRead: result.bytesRead };
    },
    close: () => handle.close(),
  };
}

function realpathNative(path: string): Promise<string> {
  return new Promise<string>((resolvePromise, reject) => {
    nodeRealpath.native(path, (error, resolved) => {
      if (error) reject(error);
      else resolvePromise(resolved);
    });
  });
}

/** The files part over the share. Every method is async, so a failure is always a rejection. */
function filesPartFor(ctx: Ctx): FilesPart {
  const shareRoot = ctx.transport.shareRoot;
  const share = (linux: string): string => {
    const mapped = shareFor(shareRoot, linux);
    if (mapped === null) throw codeError('ENOENT');
    return mapped;
  };
  return {
    stat: async (path) => (await fsp.stat(share(path))) as FileStat,
    lstat: async (path) => (await fsp.lstat(share(path))) as FileStat,
    realpath: async (path) => linuxResult(shareRoot, await realpathNative(share(path))),
    access: async (path, mode) =>
      fsp.access(share(path), mode === 'execute' ? constants.X_OK : constants.F_OK),
    readFile: async (path, options) => {
      const mapped = share(path);
      if (options?.maxBytes === undefined) return fsp.readFile(mapped);
      const handle = await fsp.open(mapped, 'r');
      try {
        const info = await handle.stat();
        if (info.size > options.maxBytes) throw codeError('EFBIG');
        return await handle.readFile();
      } finally {
        await handle.close();
      }
    },
    open: async (path, flag) => wrapHandle(await fsp.open(share(path), flag)),
    writeFile: async (path, data, options) => {
      await fsp.writeFile(share(path), data, options);
    },
    mkdir: async (path, options) => {
      await fsp.mkdir(share(path), options);
    },
    readdir: async (path): Promise<DirEntryInfo[]> =>
      fsp.readdir(share(path), { withFileTypes: true }),
    rm: async (path, options) => fsp.rm(share(path), options),
    rmdir: async (path) => fsp.rmdir(share(path)),
    rename: async (from, to) => fsp.rename(share(from), share(to)),
    chmod: async (path, mode) => {
      const mapped = share(path);
      const ok = await runFixed(ctx, [
        '-d',
        ctx.distribution,
        '--exec',
        'chmod',
        (mode & 0o7777).toString(8),
        '--',
        path,
      ]);
      if (ok) return;
      throw codeError((await exists(mapped)) ? 'EIO' : 'ENOENT');
    },
    readlink: async (path) => linuxResult(shareRoot, String(await fsp.readlink(share(path)))),
    symlink: async (target, path) => {
      const mapped = share(path);
      const ok = await runFixed(ctx, [
        '-d',
        ctx.distribution,
        '--exec',
        'ln',
        '-s',
        '--',
        target,
        path,
      ]);
      if (ok) return;
      if (await exists(mapped)) throw codeError('EEXIST');
      if (!(await exists(join(mapped, '..')))) throw codeError('ENOENT');
      throw codeError('EIO');
    },
  };
}

/**
 * The process part: `spawn` runs the program through wsl.exe with the fixed launcher. The group id
 * comes back on the first line; a timeout or an abort kills that group through a second wsl.exe call
 * before the result resolves, and nothing reaches onOutput after it.
 */
function processPartFor(ctx: Ctx): ProcessPart {
  let probe: Promise<boolean> | undefined;
  /** Whether `unshare --user --map-root-user --net true` works here: run once, then remembered. */
  const unshareWorks = (): Promise<boolean> => {
    probe ??= (async () => {
      const result = await ctx.transport.run(
        ['-d', ctx.distribution, '--exec', 'unshare', '--user', '--map-root-user', '--net', 'true'],
        { env: wslProcessEnv({}), timeoutMs: PROBE_TIMEOUT_MS },
      );
      return result.started && result.code === 0 && !result.timedOut;
    })();
    return probe;
  };

  return {
    platform: 'linux',
    networkLevel: async () =>
      chooseNetwork('linux', { unshareWorks: await unshareWorks(), sandboxExecExists: false })
        .level,
    spawn: async (file, argv, options) => {
      if (!posix.isAbsolute(options.cwd)) return { started: false };
      let command = file;
      let args = [...argv];
      let env = options.env;
      let network: NetworkLevel | undefined;
      if (options.network === 'none') {
        const choice = chooseNetwork('linux', {
          unshareWorks: await unshareWorks(),
          sandboxExecExists: false,
        });
        const wrapped = wrapCommand(choice, file, args);
        command = wrapped.command;
        args = wrapped.args;
        env = { ...env, ...writerNetworkEnv() };
        network = choice.level;
      }
      return runProgram(ctx, { cwd: options.cwd, command, args, env, network, options });
    },
  };
}

interface ProgramRun {
  cwd: string;
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  network: NetworkLevel | undefined;
  options: SpawnOptions;
}

/** Runs one program under the launcher, with the group kill on timeout and abort (D42). Never rejects. */
async function runProgram(ctx: Ctx, run: ProgramRun): Promise<SpawnOutcome> {
  const { options } = run;
  const netPart = run.network === undefined ? {} : { network: run.network };
  let group: number | null = null;
  let stopped: 'timeout' | 'aborted' | null = null;
  let halting: Promise<void> = Promise.resolve();
  const inner = new AbortController();

  /** Stops the program: forwards nothing further, kills its group if it is known, then kills wsl.exe. */
  const halt = (reason: 'timeout' | 'aborted'): Promise<void> => {
    if (stopped !== null) return halting;
    stopped = reason;
    halting = (async () => {
      if (group !== null) {
        await ctx.transport.run(
          ['-d', ctx.distribution, '--exec', 'kill', '-KILL', '--', `-${group}`],
          { env: wslProcessEnv({}), timeoutMs: KILL_TIMEOUT_MS },
        );
      }
      inner.abort();
    })();
    return halting;
  };

  // The marker line is taken out here; the rest of the output goes to the caller while the run lasts.
  let head: Buffer = Buffer.alloc(0);
  let marked = false;
  const onChunk = (chunk: Buffer): void => {
    if (stopped !== null) return;
    if (marked) {
      options.onOutput?.(chunk);
      return;
    }
    head = Buffer.concat([head, chunk]);
    const newline = head.indexOf(0x0a);
    if (newline < 0) {
      if (head.length > MARKER_MAX_BYTES) {
        marked = true;
        head = Buffer.alloc(0);
      }
      return;
    }
    const match = /^SDD-GROUP-(\d+)$/.exec(head.subarray(0, newline).toString('utf8'));
    marked = true;
    if (match !== null) group = Number(match[1]);
    const rest = head.subarray(newline + 1);
    head = Buffer.alloc(0);
    if (rest.length > 0) options.onOutput?.(rest);
  };

  const onAbort = (): void => void halt('aborted');
  if (options.signal?.aborted === true) onAbort();
  else options.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => void halt('timeout'), options.timeoutMs);

  const argv = [
    '-d',
    ctx.distribution,
    '--cd',
    run.cwd,
    '--exec',
    'sh',
    '-c',
    WSL_LAUNCHER,
    'sh',
    run.command,
    ...run.args,
  ];
  let result: WslRunResult;
  try {
    result = await ctx.transport.run(argv, {
      env: envFor(run.env),
      timeoutMs: options.timeoutMs,
      signal: inner.signal,
      onOutput: onChunk,
    });
  } catch {
    result = { started: false };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
  if (result.started && result.timedOut) await halt('timeout');
  await halting;
  if (stopped === 'timeout') {
    return { started: true, code: null, signal: null, timedOut: true, aborted: false, ...netPart };
  }
  if (stopped === 'aborted') {
    return { started: true, code: null, signal: null, timedOut: false, aborted: true, ...netPart };
  }
  if (!result.started) return { started: false };
  return {
    started: true,
    code: result.code,
    signal: result.signal,
    timedOut: false,
    aborted: result.aborted,
    ...netPart,
  };
}

/** The watch part: a poll of one folder, about every `pollMs`. */
function watchPartFor(files: FilesPart, pollMs: number): WatchPart {
  return {
    watchDir: (path, onEvent, onError): WatchHandle => {
      /** name -> a key: size and mtime for a file, the name alone for a folder. */
      let last: Map<string, string> | null = null;
      let closed = false;
      let failing = false;
      let busy = false;
      let timer: NodeJS.Timeout | undefined;

      const listing = async (): Promise<Map<string, string>> => {
        const found = new Map<string, string>();
        for (const entry of await files.readdir(path)) {
          if (entry.isDirectory()) {
            found.set(entry.name, 'dir');
            continue;
          }
          try {
            const info = await files.stat(posix.join(path, entry.name));
            found.set(entry.name, `${info.size}:${info.mtimeMs}`);
          } catch (error) {
            // Removed between the listing and the stat: it is simply gone.
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
        }
        return found;
      };

      const report = (previous: Map<string, string>, next: Map<string, string>): void => {
        for (const [name, key] of next) {
          const before = previous.get(name);
          if (before === undefined) onEvent('rename', name);
          else if (before !== key) onEvent('change', name);
        }
        for (const name of previous.keys()) {
          if (!next.has(name)) onEvent('rename', name);
        }
      };

      const tick = async (): Promise<void> => {
        if (closed || busy) return;
        busy = true;
        try {
          const next = await listing();
          if (closed) return;
          failing = false;
          if (last !== null) report(last, next);
          last = next;
        } catch (error) {
          if (!closed && !failing) {
            failing = true;
            onError(error instanceof Error ? error : new Error('listing failed'));
          }
        } finally {
          busy = false;
          if (!closed) timer = setTimeout(() => void tick(), pollMs);
        }
      };

      void tick();
      return {
        close: () => {
          closed = true;
          if (timer !== undefined) clearTimeout(timer);
        },
      };
    },
  };
}

/** The git part: the same functions as the local instance, over a launcher that runs git in the distribution. */
function gitPartFor(ctx: Ctx): Environment['git'] {
  const launcher: GitLauncher = async (args, options) => {
    const result = await ctx.transport.run(
      ['-d', ctx.distribution, '--cd', options.cwd, '--exec', 'git', ...args],
      {
        env: envFor(options.env),
        timeoutMs: options.timeoutMs,
        capture: { maxBytes: options.maxBuffer },
      },
    );
    if (!result.started) return { ok: false, kind: 'failed', stderr: '' };
    const stderr = result.stderr?.toString('utf8') ?? '';
    if (result.timedOut) return { ok: false, kind: 'timeout', stderr };
    if (result.code === 0 && result.truncated !== true) {
      return { ok: true, stdout: result.stdout?.toString('utf8') ?? '' };
    }
    if (GIT_MISSING.test(stderr)) return { ok: false, kind: 'missing', stderr };
    return { ok: false, kind: 'failed', stderr };
  };
  return createGit(launcher);
}

/**
 * The WSL backend for one distribution and its Linux root. Its parts share one transport, and none of
 * them falls back to the local backend.
 */
export function createWslEnvironment(options: WslEnvironmentOptions): Environment {
  const ctx: Ctx = { distribution: options.distribution, transport: options.transport };
  const files = filesPartFor(ctx);
  return {
    path: pathPart,
    files,
    process: processPartFor(ctx),
    watch: watchPartFor(files, options.pollMs ?? WSL_POLL_MS),
    git: gitPartFor(ctx),
  };
}

/**
 * The share root of a distribution: \\wsl.localhost\<distro>, or \\wsl$\<distro> when the first is
 * missing. Looked up once, when the transport is made. Falls back to the first form, so a stopped or
 * missing distribution gives a Node code on each call.
 */
function findShareRoot(distribution: string): string {
  const modern = `\\\\wsl.localhost\\${distribution}`;
  if (existsSync(modern)) return modern;
  const legacy = `\\\\wsl$\\${distribution}`;
  if (existsSync(legacy)) return legacy;
  return modern;
}

/** The app's transport: starts wsl.exe with an argument array and no shell. */
export function appWslTransport(distribution: string): WslTransport {
  return {
    shareRoot: findShareRoot(distribution),
    run: (argv, options) => runWslExe(argv, options),
  };
}

/** Starts wsl.exe, collects what the options ask for, and kills it on timeout or abort. Never rejects. */
function runWslExe(argv: readonly string[], options: WslRunOptions): Promise<WslRunResult> {
  return new Promise<WslRunResult>((resolvePromise) => {
    let child: ChildProcess;
    try {
      child = nodeSpawn(WSL_EXE, [...argv], {
        shell: false,
        windowsHide: true,
        env: options.env,
        stdio: [options.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      });
    } catch {
      resolvePromise({ started: false });
      return;
    }

    const stdoutParts: Buffer[] = [];
    const stderrParts: Buffer[] = [];
    let captured = 0;
    let truncated = false;
    let settled = false;
    let stopReason: 'timeout' | 'aborted' | null = null;
    let graceTimer: NodeJS.Timeout | undefined;

    const finish = (result: WslRunResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (graceTimer !== undefined) clearTimeout(graceTimer);
      options.signal?.removeEventListener('abort', onAbort);
      resolvePromise(result);
    };

    const stop = (reason: 'timeout' | 'aborted'): void => {
      if (settled || stopReason !== null) return;
      stopReason = reason;
      child.kill('SIGKILL');
      graceTimer = setTimeout(
        () =>
          finish({
            started: true,
            code: null,
            signal: null,
            timedOut: reason === 'timeout',
            aborted: reason === 'aborted',
          }),
        STOP_GRACE_MS,
      );
    };
    const onAbort = (): void => stop('aborted');
    const timeoutTimer = setTimeout(() => stop('timeout'), options.timeoutMs);

    const collect = (parts: Buffer[], chunk: Buffer): void => {
      if (options.capture === undefined) return;
      if (captured + chunk.length > options.capture.maxBytes) {
        truncated = true;
        return;
      }
      captured += chunk.length;
      parts.push(chunk);
    };
    const onData = (parts: Buffer[]) => (chunk: Buffer | string) => {
      if (settled || stopReason !== null) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      options.onOutput?.(buffer);
      collect(parts, buffer);
    };
    child.stdout?.on('data', onData(stdoutParts));
    child.stderr?.on('data', onData(stderrParts));

    child.on('error', () => {
      if (child.pid === undefined) finish({ started: false });
    });
    child.on('close', (code, signal) => {
      if (stopReason !== null) return;
      finish({
        started: true,
        code,
        signal,
        timedOut: false,
        aborted: false,
        ...(options.capture === undefined
          ? {}
          : {
              stdout: Buffer.concat(stdoutParts),
              stderr: Buffer.concat(stderrParts),
              truncated,
            }),
      });
    });

    if (options.stdin !== undefined) child.stdin?.end(options.stdin);
    if (options.signal !== undefined) {
      if (options.signal.aborted) stop('aborted');
      else options.signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}
