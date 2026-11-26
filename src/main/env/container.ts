// The dev container backend of the environment interface (D44, p4-env-container). One object serves one dev
// container (found by its devcontainer.local_folder label on each connect) and a POSIX root inside it. Every
// files call is one exec of a fixed script, with its paths and arguments as positional words, never in the
// script text. Programs and git run through the same exec form, with the group launcher (launcher.ts). Watching
// polls one folder (poll-watch.ts). Nothing here falls back to the local backend: a failing docker call is a
// result for each call (a Node code, { started: false }, or a git code), never a throw that escapes. The
// transport is injected (ContainerTransport), so the tests use a fake (tests/support/fake-container-transport.ts).
// Runs only in main.

import { posix } from 'node:path';
import {
  chooseNetwork,
  wrapCommand,
  writerNetworkEnv,
  type NetworkChoice,
} from '../commands/network';
import { createGit, type GitLauncher } from '../git/git';
import { createMarkerReader, GROUP_MARKER, LAUNCHER } from './launcher';
import { pollWatchPart } from './poll-watch';
import {
  execArgv,
  findContainer,
  textOf,
  type ContainerRunResult,
  type ContainerTransport,
  type DockerHost,
} from './container-transport';
import type {
  AccessMode,
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

/** The folder and the Docker host of one dev container, as the descriptor gives them (D44). */
export interface ContainerDescriptor {
  folder: string;
  docker: DockerHost;
}

/** The options of the container backend. The poll interval is for the tests; it defaults to one second. */
export interface ContainerEnvironmentOptions {
  descriptor: ContainerDescriptor;
  transport: ContainerTransport;
  pollMs?: number;
}

/** The poll of the watcher, in milliseconds (the same as WSL and SSH, D42, D43). */
export const CONTAINER_POLL_MS = 1_000;
/** The longest a files script may take, in milliseconds. */
const FILE_TIMEOUT_MS = 30_000;
/** The longest a connect step (the lookup's start, the connect check) may take, in milliseconds. */
const CONNECT_TIMEOUT_MS = 60_000;
/** The longest a network probe may take, in milliseconds. */
const PROBE_TIMEOUT_MS = 10_000;
/** The longest a kill of a program group may take, in milliseconds. */
const KILL_TIMEOUT_MS = 10_000;
/** The docker run's own limit is this much later than the backend's, so the backend stops the group first (D43). */
const STOP_GRACE_MS = 2_000;
/** The most output a files call captures when it has no cap: the whole file, read in one piece. */
const UNCAPPED_BYTES = Number.MAX_SAFE_INTEGER;
/** The most output a connect step captures: its own short answers. */
const CHECK_CAPTURE_BYTES = 4096;

/** The fields `stat -c` prints, in this order (the format of the stat scripts). */
const STAT_FORMAT = '%f %s %Y %X %W %u %g %h %i';

/**
 * The shell lines that explain a failed call on "$p" from the path alone, then exit 1 with a code word on stderr
 * (ENOENT, ENOTDIR, or EACCES when the path is there). `linkAware` counts a dangling link as present.
 */
function explain(linkAware: boolean): string {
  const present = linkAware ? 'if [ -e "$p" ] || [ -L "$p" ]; then' : 'if [ -e "$p" ]; then';
  return [
    present,
    '  echo EACCES >&2',
    '  exit 1',
    'fi',
    'd=$p',
    'while [ "$d" != / ]; do',
    '  d=${d%/*}',
    '  [ -n "$d" ] || d=/',
    '  if [ -e "$d" ] && [ ! -d "$d" ]; then echo ENOTDIR >&2; exit 1; fi',
    'done',
    'echo ENOENT >&2',
    'exit 1',
  ].join('\n');
}

/** Joins script lines. */
function script(...lines: string[]): string {
  return lines.join('\n');
}

/** The same lines, indented by two spaces, so a block can sit inside an `if`. */
function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

/**
 * The fixed files scripts (D44). Each one reads its paths and arguments from "$1" and "$2" (the script's own
 * positional words), and prints a code word on stderr for the cases it tests itself. Only commands that exist in
 * both GNU coreutils and BusyBox are used. Exported: the fake recognises them by this text, and the real-shell
 * test runs them.
 */
export const FILES_SCRIPTS = {
  stat: script(
    'p=$1',
    `if stat -c '${STAT_FORMAT}' "$p" 2>/dev/null; then exit 0; fi`,
    explain(true),
  ),
  statFollow: script(
    'p=$1',
    `if stat -L -c '${STAT_FORMAT}' "$p" 2>/dev/null; then exit 0; fi`,
    explain(false),
  ),
  accessExists: script('p=$1', 'if test -e "$p"; then exit 0; fi', explain(false)),
  accessExecute: script('p=$1', 'if test -x "$p"; then exit 0; fi', explain(false)),
  // GNU realpath accepts a missing last component unless told otherwise, so the path must exist first.
  realpath: script(
    'p=$1',
    'if [ -e "$p" ] && realpath "$p" 2>/dev/null; then exit 0; fi',
    explain(false),
  ),
  readlink: script(
    'p=$1',
    'if [ -L "$p" ]; then exec readlink "$p"; fi',
    'if [ -e "$p" ]; then echo EINVAL >&2; exit 1; fi',
    explain(false),
  ),
  read: script(
    'p=$1',
    'if [ -d "$p" ]; then echo EISDIR >&2; exit 1; fi',
    'if cat "$p"; then exit 0; fi',
    explain(false),
  ),
  readCapped: script(
    'p=$1',
    'if [ -d "$p" ]; then echo EISDIR >&2; exit 1; fi',
    'if head -c "$2" "$p"; then exit 0; fi',
    explain(false),
  ),
  readRange: script(
    'p=$1',
    'if [ -d "$p" ]; then echo EISDIR >&2; exit 1; fi',
    'if [ ! -r "$p" ]; then',
    explain(false)
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n'),
    'fi',
    'tail -c +"$2" "$p" | head -c "$3"',
  ),
  write: script(
    'p=$1',
    'if [ -d "$p" ]; then echo EISDIR >&2; exit 1; fi',
    'if cat > "$p"; then exit 0; fi',
    explain(false),
  ),
  writeExclusive: script(
    'p=$1',
    'if [ -e "$p" ] || [ -L "$p" ]; then echo EEXIST >&2; exit 1; fi',
    'if cat > "$p"; then exit 0; fi',
    explain(true),
  ),
  mkdir: script(
    'p=$1',
    'if mkdir "$p"; then exit 0; fi',
    'if [ -e "$p" ] || [ -L "$p" ]; then echo EEXIST >&2; exit 1; fi',
    explain(true),
  ),
  mkdirRecursive: script(
    'p=$1',
    'if [ -d "$p" ]; then exit 0; fi',
    'if [ -e "$p" ] || [ -L "$p" ]; then echo EEXIST >&2; exit 1; fi',
    'if mkdir -p "$p"; then exit 0; fi',
    explain(true),
  ),
  remove: script(
    'p=$1',
    'if [ -d "$p" ] && [ ! -L "$p" ]; then',
    '  if [ "$2" != 1 ]; then echo EISDIR >&2; exit 1; fi',
    '  if rm -r -- "$p"; then exit 0; fi',
    'elif [ -e "$p" ] || [ -L "$p" ]; then',
    '  if rm -- "$p"; then exit 0; fi',
    'elif [ "$3" = 1 ]; then',
    '  exit 0',
    'fi',
    explain(true),
  ),
  removeDir: script(
    'p=$1',
    'if [ -d "$p" ] && [ ! -L "$p" ]; then',
    '  if [ -n "$(ls -A "$p" 2>/dev/null)" ]; then echo ENOTEMPTY >&2; exit 1; fi',
    'elif [ -e "$p" ] || [ -L "$p" ]; then',
    '  echo ENOTDIR >&2',
    '  exit 1',
    'fi',
    'if rmdir "$p"; then exit 0; fi',
    explain(true),
  ),
  rename: script(
    'p=$1',
    'if [ ! -e "$p" ] && [ ! -L "$p" ]; then',
    explain(true)
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n'),
    'fi',
    'if [ -d "$2" ]; then echo EEXIST >&2; exit 1; fi',
    'if mv -f -- "$1" "$2"; then exit 0; fi',
    'echo EIO >&2',
    'exit 1',
  ),
  chmod: script('p=$1', 'if chmod "$2" "$p"; then exit 0; fi', explain(true)),
  symlink: script(
    'p=$2',
    'if [ -e "$p" ] || [ -L "$p" ]; then echo EEXIST >&2; exit 1; fi',
    'if ln -s -- "$1" "$p"; then exit 0; fi',
    explain(true),
  ),
  readdir: script(
    'p=$1',
    'if [ ! -d "$p" ]; then',
    '  if [ -e "$p" ] || [ -L "$p" ]; then echo ENOTDIR >&2; exit 1; fi',
    indent(explain(true)),
    'fi',
    'if ! ls -1A "$p" >/dev/null 2>&1; then',
    indent(explain(true)),
    'fi',
    'ls -1A "$p" | while IFS= read -r n; do',
    '  if [ -L "$p/$n" ]; then t=l; elif [ -d "$p/$n" ]; then t=d; elif [ -f "$p/$n" ]; then t=f; else t=o; fi',
    '  printf \'%s %s\\n\' "$t" "$n"',
    'done',
  ),
} as const;

/**
 * The connect check, run once per connect as the chosen user: the system name, then whether `setsid` exists (the
 * launcher needs it). Exported so the fake answers it by its text.
 */
export const CONNECT_SCRIPT = script(
  'uname -s',
  'if command -v setsid >/dev/null 2>&1; then echo SDD-SETSID; fi',
);

/** The kill of a process group, run as the chosen user: its one word is `-<pgid>`. */
export const KILL_SCRIPT = 'kill -s KILL -- "$1"';

/** The code words a files script may print on stderr. Any other failure is EIO. */
export const CODE_WORDS = new Set([
  'ENOENT',
  'ENOTDIR',
  'EISDIR',
  'EEXIST',
  'ENOTEMPTY',
  'EACCES',
  'EINVAL',
]);

/**
 * docker's own message lines for a container that is gone or stopped, or an engine that is down (D44, revision 1).
 * Only a line that starts with one of these counts: `Error response from daemon: ` with `No such container` or
 * `is not running` in it, `Error: No such container`, or `Cannot connect to the Docker daemon`. Text that merely
 * contains the phrases elsewhere (a program's own output) is not docker's message.
 */
const GONE_LINE =
  /^(?:Error response from daemon: .*(?:No such container|is not running)|Error: No such container|Cannot connect to the Docker daemon)/;

/** True when one of the lines of a stderr text is one of docker's gone or engine-down messages. */
export function goneIn(text: string): boolean {
  return text.split('\n').some((line) => GONE_LINE.test(line));
}

/** The fixed reasons of a failed reconnect (D44). None names the folder, the container, the image or the user. */
export const CONTAINER_RECONNECT_REASONS = {
  'docker-missing': 'Docker is not installed or not on the PATH here; install it and reconnect',
  'engine-down': 'the Docker engine is not running; start it and reconnect',
  'not-found': 'no dev container for this project was found; start its dev container and reconnect',
  'start-failed': 'the dev container could not be started; reconnect to try again',
  'not-linux': 'the dev container is not a Linux system',
  'no-setsid': 'the dev container has no setsid program',
} as const;

/** The reason of a failed connect, by its cause. */
export type ConnectReason = keyof typeof CONTAINER_RECONNECT_REASONS;

/** The Node-style error with a code and no path or container text in its message. */
function codeError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: the path is not available in this container`), { code });
}

/** The session of a connection: the container's id, and the user programs run as (null: the image's default). */
interface Session {
  readonly id: string;
  readonly user: string | null;
}

/** The backend's state, shared by its parts. */
interface Ctx {
  readonly descriptor: ContainerDescriptor;
  readonly transport: ContainerTransport;
  state: ConnectionState;
  session: Session | null;
  platform: NodeJS.Platform;
  /** Counts up on each successful connect. The network probe is kept per connection. */
  connection: number;
  /** The last network probe, with the connection it was made on. */
  probe: { connection: number; works: boolean } | null;
  readonly listeners: Set<(state: ConnectionState) => void>;
  /** Moves to a state and tells the listeners once, when it changed. */
  setState(next: ConnectionState): void;
}

/** Makes the shared context of one backend. */
function contextFor(options: ContainerEnvironmentOptions): Ctx {
  const listeners = new Set<(state: ConnectionState) => void>();
  const ctx: Ctx = {
    descriptor: options.descriptor,
    transport: options.transport,
    state: 'unreachable',
    session: null,
    platform: 'linux',
    connection: 0,
    probe: null,
    listeners,
    setState: (next) => {
      if (next === ctx.state) return;
      ctx.state = next;
      for (const listener of [...listeners]) listener(next);
    },
  };
  return ctx;
}

/**
 * One docker call, checked afterwards: a call that cannot start docker, or whose stderr has one of docker's gone or
 * engine-down lines, moves the backend to unreachable (D44). `programStarted` is given for a launched program: once
 * its marker has arrived, stderr belongs to the program and is not checked (revision 1). Never rejects.
 */
async function dockerCall(
  ctx: Ctx,
  argv: readonly string[],
  options: Parameters<ContainerTransport['run']>[1],
  programStarted?: () => boolean,
): Promise<ContainerRunResult> {
  const result = await ctx.transport.run(argv, options);
  const checkStderr = programStarted === undefined || !programStarted();
  if (!result.started || (checkStderr && goneIn(textOf(result.stderr)))) {
    ctx.setState('unreachable');
  }
  return result;
}

/** The exec's shape for the backend's container and user, with the given folder and command. */
function execFor(
  session: Session,
  cwd: string,
  command: readonly string[],
  options: { names?: readonly string[]; stdin?: boolean } = {},
): string[] {
  return execArgv({
    id: session.id,
    user: session.user,
    cwd,
    names: options.names ?? [],
    stdin: options.stdin === true,
    command,
  });
}

/** The last line of a stderr text: a files script puts its code word there. */
function lastLine(text: string): string {
  const lines = text.trim().split('\n');
  return (lines[lines.length - 1] ?? '').trim();
}

/** The path as given when it is absolute, normalized and has no NUL; otherwise ENOENT, with no process started (AC4). */
function checkedPath(path: string): string {
  if (!posix.isAbsolute(path) || posix.normalize(path) !== path || path.includes('\0')) {
    throw codeError('ENOENT');
  }
  return path;
}

/**
 * Runs one fixed files script with its positional words, and returns its stdout. A call on an unreachable backend
 * is ENOTCONN and starts nothing. A failed script gives its code word, or EIO.
 */
async function runScript(
  ctx: Ctx,
  body: string,
  args: readonly string[],
  options: { stdin?: Buffer; maxBytes?: number } = {},
): Promise<Buffer> {
  const session = ctx.session;
  if (ctx.state !== 'connected' || session === null) throw codeError('ENOTCONN');
  const result = await dockerCall(
    ctx,
    execFor(session, '/', ['sh', '-c', body, 'sh', ...args], {
      stdin: options.stdin !== undefined,
    }),
    {
      timeoutMs: FILE_TIMEOUT_MS,
      capture: { maxBytes: options.maxBytes ?? UNCAPPED_BYTES },
      ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
    },
  );
  if (ctx.state !== 'connected') throw codeError('ENOTCONN');
  if (!result.started) throw codeError('ENOTCONN');
  if (result.timedOut) throw codeError('EIO');
  if (result.code === 0) return result.stdout ?? Buffer.alloc(0);
  const word = lastLine(textOf(result.stderr));
  throw codeError(CODE_WORDS.has(word) ? word : 'EIO');
}

/** The file type bits of a mode word. */
function kindOfMode(mode: number): number {
  return mode & 0o170000;
}

/** The FileStat of the fields `stat -c STAT_FORMAT` prints. */
function statOf(text: string): FileStat {
  const [modeHex = '0', size = '0', mtime = '0'] = text.trim().split(' ');
  const mode = Number.parseInt(modeHex, 16);
  const kind = kindOfMode(mode);
  return {
    isFile: () => kind === 0o100000,
    isDirectory: () => kind === 0o040000,
    isSymbolicLink: () => kind === 0o120000,
    size: Number(size),
    mtimeMs: Number(mtime) * 1000,
    mode,
  };
}

/** The files part over the container. Every method is one exec of a fixed script, or a result without a process. */
function filesPartFor(ctx: Ctx): FilesPart {
  const stat = async (path: string, body: string): Promise<FileStat> =>
    statOf((await runScript(ctx, body, [checkedPath(path)])).toString('utf8'));

  return {
    stat: (path) => stat(path, FILES_SCRIPTS.statFollow),
    lstat: (path) => stat(path, FILES_SCRIPTS.stat),
    realpath: async (path) => {
      const out = await runScript(ctx, FILES_SCRIPTS.realpath, [checkedPath(path)]);
      return out.toString('utf8').replace(/\n$/, '');
    },
    access: async (path: string, mode: AccessMode): Promise<void> => {
      const target = checkedPath(path);
      await runScript(
        ctx,
        mode === 'execute' ? FILES_SCRIPTS.accessExecute : FILES_SCRIPTS.accessExists,
        [target],
      );
    },
    readFile: async (path, options) => {
      const target = checkedPath(path);
      const cap = options?.maxBytes;
      if (cap === undefined) return runScript(ctx, FILES_SCRIPTS.read, [target]);
      const out = await runScript(ctx, FILES_SCRIPTS.readCapped, [target, String(cap + 1)], {
        maxBytes: cap + 1,
      });
      if (out.length > cap) throw codeError('EFBIG');
      return out;
    },
    open: async (path, flag): Promise<FileHandleLike> => {
      const target = checkedPath(path);
      if (flag !== 'r') throw codeError('EINVAL');
      // The open itself checks that the file can be read, with no bytes taken.
      await runScript(ctx, FILES_SCRIPTS.readRange, [target, '1', '0']);
      return {
        read: async (buffer, offset, length, position) => {
          const data = await runScript(
            ctx,
            FILES_SCRIPTS.readRange,
            [target, String(position + 1), String(length)],
            { maxBytes: length },
          );
          data.copy(buffer, offset, 0, data.length);
          return { bytesRead: data.length };
        },
        close: async () => undefined,
      };
    },
    writeFile: async (path, data, options) => {
      const target = checkedPath(path);
      const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
      const body = options?.flag === 'wx' ? FILES_SCRIPTS.writeExclusive : FILES_SCRIPTS.write;
      await runScript(ctx, body, [target], { stdin: bytes });
    },
    mkdir: async (path, options) => {
      const target = checkedPath(path);
      const body = options?.recursive === true ? FILES_SCRIPTS.mkdirRecursive : FILES_SCRIPTS.mkdir;
      await runScript(ctx, body, [target]);
    },
    readdir: async (path): Promise<DirEntryInfo[]> => {
      const target = checkedPath(path);
      const out = await runScript(ctx, FILES_SCRIPTS.readdir, [target]);
      const entries: DirEntryInfo[] = [];
      for (const line of out.toString('utf8').split('\n')) {
        if (line === '') continue;
        const type = line.charAt(0);
        const name = line.slice(2);
        entries.push({
          name,
          isFile: () => type === 'f',
          isDirectory: () => type === 'd',
          isSymbolicLink: () => type === 'l',
        });
      }
      return entries;
    },
    rm: async (path, options) => {
      const target = checkedPath(path);
      const recursive = options?.recursive === true ? '1' : '0';
      const force = options?.force === true ? '1' : '0';
      await runScript(ctx, FILES_SCRIPTS.remove, [target, recursive, force]);
    },
    rmdir: async (path) => {
      await runScript(ctx, FILES_SCRIPTS.removeDir, [checkedPath(path)]);
    },
    rename: async (from, to) => {
      await runScript(ctx, FILES_SCRIPTS.rename, [checkedPath(from), checkedPath(to)]);
    },
    chmod: async (path, mode) => {
      await runScript(ctx, FILES_SCRIPTS.chmod, [checkedPath(path), (mode & 0o7777).toString(8)]);
    },
    readlink: async (path) => {
      const out = await runScript(ctx, FILES_SCRIPTS.readlink, [checkedPath(path)]);
      return out.toString('utf8').replace(/\n$/, '');
    },
    symlink: async (target, path) => {
      await runScript(ctx, FILES_SCRIPTS.symlink, [target, checkedPath(path)]);
    },
  };
}

/** The path part: the POSIX flavour of the container's own files (D41, D44). */
const pathPart: Environment['path'] = posix;

/**
 * The environment of a dev container for one descriptor. Making it starts nothing: it is unreachable until a
 * successful reconnect (D44). Its parts share one transport, and none of them falls back to the local backend.
 */
export function createContainerEnvironment(options: ContainerEnvironmentOptions): Environment {
  const ctx = contextFor(options);
  const files = filesPartFor(ctx);
  return {
    path: pathPart,
    files,
    process: processPartFor(ctx),
    watch: pollWatchPart(files, options.pollMs ?? CONTAINER_POLL_MS),
    git: createGit(gitLauncherFor(ctx)),
    connection: connectionPartFor(ctx),
  };
}

/** The variable that never crosses: the container's shell keeps its own PATH. */
const PATH_NAME = 'PATH';
/** A name an environment variable may have to cross (the same rule as WSLENV and SSH, D42, D43). */
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The variables that cross into the container: the ones the caller set or changed relative to the app's own
 * environment, never PATH, and never a name that is not a plain variable name (D44).
 */
export function changedVariables(env: NodeJS.ProcessEnv): Record<string, string> {
  const changed: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || !VARIABLE_NAME.test(name)) continue;
    if (name.toUpperCase() === PATH_NAME) continue;
    if (process.env[name] === value) continue;
    changed[name] = value;
  }
  return changed;
}

/** One program to run in the container, with its network choice already made. */
interface ProgramRun {
  cwd: string;
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  network: NetworkLevel | undefined;
  options: SpawnOptions;
  /** Collects stdout and stderr, up to maxBytes for stdout (git needs both). */
  capture?: { maxBytes: number };
}

/** The output of a captured run, kept apart by stream. */
interface Captured {
  stdout: Buffer;
  stderr: Buffer;
  truncated: boolean;
}

/** How a program run ended, and its captured output when it was asked for. */
interface ProgramResult {
  outcome: SpawnOutcome;
  captured?: Captured;
}

/**
 * Runs one program in the container over the exec form (D44), with the group kill on timeout and abort. The group
 * is stopped first, on a second exec, then the docker process is stopped, then the result resolves. Never rejects.
 * A stop that comes before the marker stops only the docker process (the same limit as SSH, documented).
 */
async function runProgram(ctx: Ctx, run: ProgramRun): Promise<ProgramResult> {
  const { options } = run;
  const netPart = run.network === undefined ? {} : { network: run.network };
  const session = ctx.session;
  if (ctx.state !== 'connected' || session === null) return { outcome: { started: false } };
  let stopped: 'timeout' | 'aborted' | null = null;
  let halting: Promise<void> = Promise.resolve();
  const inner = new AbortController();
  const marker = createMarkerReader();

  /** Stops the program: forwards nothing further, kills its group if it is known, then stops the docker process. */
  const halt = (reason: 'timeout' | 'aborted'): Promise<void> => {
    if (stopped !== null) return halting;
    stopped = reason;
    halting = (async () => {
      const group = marker.group;
      if (group !== null) {
        await dockerCall(ctx, execFor(session, '/', ['sh', '-c', KILL_SCRIPT, 'sh', `-${group}`]), {
          timeoutMs: KILL_TIMEOUT_MS,
          capture: { maxBytes: CHECK_CAPTURE_BYTES },
        });
      }
      inner.abort();
    })();
    return halting;
  };

  // The marker line is taken out by the shared reader; the rest of the output goes to the caller while the run lasts.
  const onChunk = (chunk: Buffer): void => {
    if (stopped !== null) return;
    const out = marker.feed(chunk);
    if (out !== null) options.onOutput?.(out);
  };

  const onAbort = (): void => void halt('aborted');
  if (options.signal?.aborted === true) onAbort();
  else options.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => void halt('timeout'), options.timeoutMs);

  const changed = changedVariables(run.env);
  const argv = execFor(session, run.cwd, ['sh', '-c', LAUNCHER, 'sh', run.command, ...run.args], {
    names: Object.keys(changed),
  });
  let result: ContainerRunResult;
  try {
    result = await dockerCall(
      ctx,
      argv,
      {
        env: changed,
        timeoutMs: options.timeoutMs + STOP_GRACE_MS,
        signal: inner.signal,
        onOutput: onChunk,
        ...(run.capture === undefined ? {} : { capture: run.capture }),
      },
      // Docker's own messages come before the marker; after it, stderr is the program's own (revision 1).
      () => marker.group !== null,
    );
  } catch {
    result = { started: false };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
  if (result.started && result.timedOut) await halt('timeout');
  await halting;
  const captured: Captured | undefined =
    result.started && result.stdout !== undefined
      ? {
          stdout: result.stdout,
          stderr: result.stderr ?? Buffer.alloc(0),
          truncated: result.truncated === true,
        }
      : undefined;
  const done = (outcome: SpawnOutcome): ProgramResult => ({ outcome, captured });
  if (stopped === 'timeout') {
    return done({
      started: true,
      code: null,
      signal: null,
      timedOut: true,
      aborted: false,
      ...netPart,
    });
  }
  if (stopped === 'aborted') {
    return done({
      started: true,
      code: null,
      signal: null,
      timedOut: false,
      aborted: true,
      ...netPart,
    });
  }
  // The container went away during the run: the program did not run to an answer.
  if (ctx.state !== 'connected' || !result.started) return done({ started: false });
  return done({
    started: true,
    code: result.code,
    signal: result.signal,
    timedOut: false,
    aborted: result.aborted,
    ...netPart,
  });
}

/**
 * Whether `unshare --user --map-root-user --net true` works as the chosen user, probed once per connection and
 * remembered for it (D42, D44). An unreachable backend is never probed and answers no.
 */
async function unshareWorks(ctx: Ctx): Promise<boolean> {
  const session = ctx.session;
  if (ctx.state !== 'connected' || session === null) return false;
  if (ctx.probe !== null && ctx.probe.connection === ctx.connection) return ctx.probe.works;
  const result = await dockerCall(
    ctx,
    execFor(session, '/', ['unshare', '--user', '--map-root-user', '--net', 'true']),
    { timeoutMs: PROBE_TIMEOUT_MS, capture: { maxBytes: CHECK_CAPTURE_BYTES } },
  );
  const works = result.started && !result.timedOut && result.code === 0;
  ctx.probe = { connection: ctx.connection, works };
  return works;
}

/** The wrapper choice of this container: the same answer for networkLevel and for a spawn (D31, D44). */
async function choiceFor(ctx: Ctx): Promise<NetworkChoice> {
  return chooseNetwork('linux', {
    unshareWorks: await unshareWorks(ctx),
    sandboxExecExists: false,
  });
}

/**
 * The process part (D44): `spawn` runs one program over the exec form, with its variables, and the platform read at
 * connect. A network limit is applied as the other Linux backends do, and `networkLevel` agrees with it.
 */
function processPartFor(ctx: Ctx): ProcessPart {
  return {
    get platform() {
      return ctx.platform;
    },
    networkLevel: async () => {
      if (ctx.state !== 'connected') return 'proxy-only';
      return (await choiceFor(ctx)).level;
    },
    spawn: async (file, argv, options) => {
      if (!posix.isAbsolute(options.cwd) || options.cwd.includes('\0')) return { started: false };
      let command = file;
      let args = [...argv];
      let env = options.env;
      let network: NetworkLevel | undefined;
      // The writer's command gets the network limit and the dead proxies (D31), as on the other Linux backends.
      if (options.network === 'none') {
        const choice = await choiceFor(ctx);
        const wrapped = wrapCommand(choice, file, args);
        command = wrapped.command;
        args = wrapped.args;
        env = { ...env, ...writerNetworkEnv() };
        network = choice.level;
      }
      const { outcome } = await runProgram(ctx, {
        cwd: options.cwd,
        command,
        args,
        env,
        network,
        options,
      });
      return outcome;
    },
  };
}

/** A captured stream starts with the group marker line the launcher printed; this takes it off. */
function withoutMarker(output: Buffer): Buffer {
  const newline = output.indexOf(0x0a);
  if (newline < 0) return output;
  const first = output.subarray(0, newline).toString('utf8');
  return new RegExp(`^${GROUP_MARKER}\\d+$`).test(first) ? output.subarray(newline + 1) : output;
}

/**
 * git through the group launcher (D44): the same argument lists, environment, timeouts, parsing and codes as the
 * local instance. Exit 127 is git-missing, a timeout is `timeout` and kills the group, and any other failure is
 * `failed`.
 */
function gitLauncherFor(ctx: Ctx): GitLauncher {
  return async (args, options) => {
    const { outcome, captured } = await runProgram(ctx, {
      cwd: options.cwd,
      command: 'git',
      args: [...args],
      env: options.env,
      network: undefined,
      options: {
        cwd: options.cwd,
        env: options.env,
        timeoutMs: options.timeoutMs,
        network: 'normal',
      },
      capture: { maxBytes: options.maxBuffer },
    });
    if (!outcome.started) return { ok: false, kind: 'failed', stderr: '' };
    const stderr = captured?.stderr.toString('utf8') ?? '';
    if (outcome.timedOut) return { ok: false, kind: 'timeout', stderr };
    if (outcome.code === 127) return { ok: false, kind: 'missing', stderr };
    if (outcome.code === 0 && captured !== undefined && !captured.truncated) {
      return { ok: true, stdout: withoutMarker(captured.stdout).toString('utf8') };
    }
    return { ok: false, kind: 'failed', stderr };
  };
}

/** The outcome of a connect: connected, or the cause of the failure. */
type ConnectOutcome = { ok: true } | { ok: false; cause: ConnectReason };

/**
 * One connect (D44): finds the container by its label, starts it when it is stopped, then checks as its user that
 * the system is Linux and that `setsid` exists. Any failure leaves the backend unreachable with its fixed cause.
 */
async function connect(ctx: Ctx): Promise<ConnectOutcome> {
  const fail = (cause: ConnectReason): ConnectOutcome => {
    ctx.session = null;
    ctx.setState('unreachable');
    return { ok: false, cause };
  };
  const found = await findContainer(ctx.transport, ctx.descriptor.folder);
  if (!found.ok) return fail(found.cause);
  if (!found.running) {
    const started = await dockerCall(ctx, ['start', found.id], {
      timeoutMs: CONNECT_TIMEOUT_MS,
      capture: { maxBytes: CHECK_CAPTURE_BYTES },
    });
    if (!started.started || started.timedOut || started.code !== 0) return fail('start-failed');
  }
  const session: Session = { id: found.id, user: found.user };
  ctx.session = session;
  const check = await dockerCall(ctx, execFor(session, '/', ['sh', '-c', CONNECT_SCRIPT, 'sh']), {
    timeoutMs: CONNECT_TIMEOUT_MS,
    capture: { maxBytes: CHECK_CAPTURE_BYTES },
  });
  if (!check.started || check.timedOut || check.code !== 0) return fail('start-failed');
  const lines = (check.stdout ?? Buffer.alloc(0)).toString('utf8').split('\n');
  if ((lines[0] ?? '').trim() !== 'Linux') return fail('not-linux');
  if (!lines.some((line) => line.trim() === 'SDD-SETSID')) return fail('no-setsid');
  ctx.platform = 'linux';
  ctx.connection += 1;
  ctx.setState('connected');
  return { ok: true };
}

/** The connection part (D43, D44): the state, its changes, and reconnect, which is one connect. Never reconnects by itself. */
function connectionPartFor(ctx: Ctx): ConnectionPart {
  return {
    state: () => ctx.state,
    onChange: (listener) => {
      ctx.listeners.add(listener);
      return () => {
        ctx.listeners.delete(listener);
      };
    },
    reconnect: async () => {
      try {
        const result = await connect(ctx);
        if (result.ok) return { ok: true };
        return { ok: false, reason: CONTAINER_RECONNECT_REASONS[result.cause] };
      } catch {
        ctx.setState('unreachable');
        return { ok: false, reason: CONTAINER_RECONNECT_REASONS['engine-down'] };
      }
    },
  };
}
