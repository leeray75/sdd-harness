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
import { createMarkerReader, GROUP_MARKER, LAUNCHER } from './launcher';
import { pollWatchPart } from './poll-watch';
import type {
  ConnectionPart,
  ConnectionState,
  DirEntryInfo,
  Environment,
  FileHandleLike,
  FilesPart,
  FileStat,
  NetworkLevel,
  ProcessPart,
  SpawnOptions,
  SpawnOutcome,
} from './types';

/** The program that starts WSL here. Only this module and wsl-detect.ts name it (AC10). */
const WSL_EXE = 'wsl.exe';

/** The line the launcher prints first: the marker, then the id of the process group it created. */
export const WSL_GROUP_MARKER = GROUP_MARKER;

/** The fixed launcher (D42), now shared with the SSH backend (launcher.ts). */
export const WSL_LAUNCHER = LAUNCHER;

/** The timeouts of the fixed commands, in milliseconds. */
const FIXED_TIMEOUT_MS = 30_000;
const PROBE_TIMEOUT_MS = 10_000;
const KILL_TIMEOUT_MS = 10_000;
/** How long the watcher waits between two listings, in milliseconds. */
export const WSL_POLL_MS = 1_000;
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
  /**
   * The folder that stands for the distribution's `/`. Found when the transport is made, and again by
   * `rediscover` (the reconnect of D43).
   */
  readonly shareRoot: string;
  /** Looks the share root up again and returns it. Called only by the backend's reconnect. */
  rediscover(): string;
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
 * A result the share gives back (realpath or readlink) as a Linux path, by four rules in order: a native
 * absolute result inside the share root maps back to its Linux path; a `/`-prefixed result is a Linux
 * path, kept as it is, only when the share root is not POSIX-absolute (a UNC root, as on Windows); a
 * relative result is kept as written; anything else is a host path outside the share, so ENOENT.
 */
export function linuxResult(shareRoot: string, result: string): string {
  if (nativeIsAbsolute(result)) {
    const linux = linuxFor(shareRoot, result);
    if (linux !== null) return linux;
  }
  if (!nativeIsAbsolute(result)) return result;
  if (result.startsWith('/') && !posix.isAbsolute(shareRoot)) return result;
  throw codeError('ENOENT');
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
  const share = (linux: string): string => {
    const mapped = shareFor(ctx.transport.shareRoot, linux);
    if (mapped === null) throw codeError('ENOENT');
    return mapped;
  };
  return {
    stat: async (path) => (await fsp.stat(share(path))) as FileStat,
    lstat: async (path) => (await fsp.lstat(share(path))) as FileStat,
    realpath: async (path) =>
      linuxResult(ctx.transport.shareRoot, await realpathNative(share(path))),
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
    readlink: async (path) =>
      linuxResult(ctx.transport.shareRoot, String(await fsp.readlink(share(path)))),
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
  let stopped: 'timeout' | 'aborted' | null = null;
  let halting: Promise<void> = Promise.resolve();
  const inner = new AbortController();

  /** Stops the program: forwards nothing further, kills its group if it is known, then kills wsl.exe. */
  const halt = (reason: 'timeout' | 'aborted'): Promise<void> => {
    if (stopped !== null) return halting;
    stopped = reason;
    halting = (async () => {
      const group = marker.group;
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

  // The marker line is taken out by the shared reader (launcher.ts); the rest of the output goes to the
  // caller while the run lasts.
  const marker = createMarkerReader();
  const onChunk = (chunk: Buffer): void => {
    if (stopped !== null) return;
    const out = marker.feed(chunk);
    if (out !== null) options.onOutput?.(out);
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
/** The reason of a failed reconnect. Fixed text: it never echoes the distribution's name. */
export const WSL_RECONNECT_REASONS = {
  notStarted: 'the distribution could not be started; reconnect to try again',
  notFound: 'the distribution was not found in WSL',
  noShare: "the distribution's files are not reachable; reconnect to try again",
} as const;

/** The most output a reconnect keeps, to read wsl.exe's own message. */
const RECONNECT_CAPTURE_BYTES = 4096;

/** wsl.exe's message for a distribution it does not have (exit code 127), in either text encoding. */
const DISTRO_NOT_FOUND = /WSL_E_DISTRO_NOT_FOUND|no distribution with the supplied name/;

/**
 * The connection part of a WSL backend (D43), and the transport the backend uses. Each run through the
 * transport sets the state: a run that cannot start is unreachable, and a run that starts makes it
 * reachable again. The state is unreachable also while the share root does not exist. Only `reconnect`
 * runs the fixed `--exec true` command that starts a stopped distribution; normal calls never do.
 */
function connectionFor(
  distribution: string,
  inner: WslTransport,
): { part: ConnectionPart; transport: WslTransport } {
  let reachable = true;
  let last: ConnectionState = 'connected';
  const listeners = new Set<(state: ConnectionState) => void>();

  const current = (): ConnectionState =>
    reachable && existsSync(inner.shareRoot) ? 'connected' : 'unreachable';

  /** Tells the listeners when the state has moved since the last time. */
  const publish = (): void => {
    const next = current();
    if (next === last) return;
    last = next;
    for (const listener of [...listeners]) listener(next);
  };

  const transport: WslTransport = {
    get shareRoot() {
      return inner.shareRoot;
    },
    rediscover: () => inner.rediscover(),
    run: async (argv, options) => {
      const result = await inner.run(argv, options);
      reachable = result.started;
      publish();
      return result;
    },
  };

  const part: ConnectionPart = {
    state: current,
    onChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reconnect: async () => {
      const run = await transport.run(['-d', distribution, '--exec', 'true'], {
        env: wslProcessEnv({}),
        timeoutMs: FIXED_TIMEOUT_MS,
        capture: { maxBytes: RECONNECT_CAPTURE_BYTES },
      });
      if (!run.started || run.timedOut || run.code !== 0) {
        const text = run.started ? (run.stderr ?? Buffer.alloc(0)).toString('utf8') : '';
        // wsl.exe's text may be UTF-16; the NUL bytes are dropped before the match.
        const missing =
          run.started && run.code === 127 && DISTRO_NOT_FOUND.test(text.replace(/\0/g, ''));
        reachable = false;
        publish();
        return {
          ok: false,
          reason: missing ? WSL_RECONNECT_REASONS.notFound : WSL_RECONNECT_REASONS.notStarted,
        };
      }
      // The distribution runs: find its share again, and it is reachable only if that folder exists.
      inner.rediscover();
      reachable = existsSync(inner.shareRoot);
      publish();
      return reachable ? { ok: true } : { ok: false, reason: WSL_RECONNECT_REASONS.noShare };
    },
  };
  return { part, transport };
}

export function createWslEnvironment(options: WslEnvironmentOptions): Environment {
  const { part: connection, transport } = connectionFor(options.distribution, options.transport);
  const ctx: Ctx = { distribution: options.distribution, transport };
  const files = filesPartFor(ctx);
  return {
    path: pathPart,
    files,
    process: processPartFor(ctx),
    watch: pollWatchPart(files, options.pollMs ?? WSL_POLL_MS),
    git: gitPartFor(ctx),
    connection,
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
  let shareRoot = findShareRoot(distribution);
  return {
    get shareRoot() {
      return shareRoot;
    },
    rediscover: () => {
      shareRoot = findShareRoot(distribution);
      return shareRoot;
    },
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
