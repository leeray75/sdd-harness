// The docker seam of the dev container backend (D44, p4-env-container). This module is the only code that starts
// the docker program (container-detect.ts also names it). Every call is an argument array with no shell: on the
// host, `docker <args…>`; for a WSL Docker host, the WSL launcher runs `-d <distro> --exec docker <args…>`. Variables that must
// cross into a container are set in the docker process's own environment, and only their names go on the
// argument array (`-e NAME`); on the WSL host the names also go through WSLENV with no path flags.
//
// `findContainer` looks a container up by its `devcontainer.local_folder` label on each connect, and reads the
// user it runs programs as from the `devcontainer.metadata` label. The pure parts (the exec form, the user rule,
// the folder rule, the host shape) are exported for the store, the environment factory and the tests. Runs only in
// main. The transport is injected through `ContainerTransport`, so the tests use a fake (tests/support).

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { isDistributionName } from './wsl-detect';
import { WSL_EXE } from './wsl';

/** The docker program on the host PATH. Named here and in container-detect.ts only (AC12). */
export const DOCKER_PROGRAM = 'docker';

/** Where the docker CLI runs: on this machine, or in a WSL distribution (Windows only). */
export type DockerHost = { kind: 'host' } | { kind: 'wsl'; distribution: string };

/** The options of one docker run. The `env` values are set in the docker process's environment, never in argv. */
export interface ContainerRunOptions {
  /** Bytes for the process's stdin. Only set for a call that needs `exec -i`. */
  stdin?: Buffer | string;
  /** Collects stdout, up to maxBytes, for the caller. Without it, stdout is only streamed to onOutput. */
  capture?: { maxBytes: number };
  timeoutMs: number;
  /** Aborting it stops the docker process. */
  signal?: AbortSignal;
  /** Variables for the docker process. Their names cross (`-e NAME`, and WSLENV on the WSL host). */
  env?: NodeJS.ProcessEnv;
  /** Receives each chunk of stdout and stderr while the run goes on. */
  onOutput?: (chunk: Buffer) => void;
}

/** How a docker run ended. `started: false` means the docker program could not start. Never a rejection. */
export type ContainerRunResult =
  | { started: false }
  | {
      started: true;
      code: number | null;
      signal: NodeJS.Signals | null;
      timedOut: boolean;
      aborted: boolean;
      /** Set when the run captured stdout. */
      stdout?: Buffer;
      /** Set when the run captured stdout and it went past its cap. */
      truncated?: boolean;
      /** stderr is always kept, up to a small cap, because the backend reads docker's own messages from it. */
      stderr?: Buffer;
    };

/** The seam between the container backend and the docker program. */
export interface ContainerTransport {
  /** Runs docker with the given docker arguments (no shell). Resolves, and never rejects. */
  run(argv: readonly string[], options: ContainerRunOptions): Promise<ContainerRunResult>;
}

/** The longest a lookup or a small docker call may take, in milliseconds. */
export const DOCKER_TIMEOUT_MS = 30_000;
/** The most stdout a lookup listing may return, in bytes. */
const LISTING_MAX_BYTES = 1024 * 1024;
/** The most stderr a run keeps, in bytes. */
const STDERR_MAX_BYTES = 64 * 1024;
/** Grace after a stop, so a process tree that keeps the pipes open cannot hold the result. */
const STOP_GRACE_MS = 2_000;

/** The label that names the folder a dev container was built for (set by the devcontainer tools). */
export const LABEL_LOCAL_FOLDER = 'devcontainer.local_folder';
/** The label that holds the devcontainer metadata: a JSON array with the users the container runs as. */
export const LABEL_METADATA = 'devcontainer.metadata';
/** The label that names the devcontainer.json the container was built from. */
export const LABEL_CONFIG_FILE = 'devcontainer.config_file';

/** A POSIX user name the backend accepts (D43). Any other user is ignored: the image's default user runs instead. */
export const CONTAINER_USER_PATTERN = /^[a-z_][a-z0-9_-]{0,31}$/;

/** True for a plain object, not an array or null. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * True for a folder the backend accepts as a label value (D44): 1 to 1024 characters, no control character
 * (U+0000 to U+001F and U+007F), no double or single quote, and no leading `-`.
 */
export function isContainerFolder(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const length = Array.from(value).length;
  if (length < 1 || length > 1024) return false;
  if (value.startsWith('-') || value.includes('"') || value.includes("'")) return false;
  for (let at = 0; at < value.length; at += 1) {
    const code = value.charCodeAt(at);
    if (code <= 0x1f || code === 0x7f) return false;
  }
  return true;
}

/**
 * The Docker host of a descriptor, with exactly its keys: `{ kind: 'host' }`, or `{ kind: 'wsl', distribution }`
 * with a valid distribution name. Anything else is null.
 */
export function parseDockerHost(value: unknown): DockerHost | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value).sort();
  if (value['kind'] === 'host') return keys.length === 1 ? { kind: 'host' } : null;
  if (value['kind'] === 'wsl') {
    if (keys.length !== 2 || keys[0] !== 'distribution' || keys[1] !== 'kind') return null;
    const distribution = value['distribution'];
    return isDistributionName(distribution) ? { kind: 'wsl', distribution } : null;
  }
  return null;
}

/** The program and argument array that start docker for a host, and the environment of that process. */
export interface DockerInvocation {
  file: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

/**
 * The invocation for one docker call (AC3). The host form runs `docker <argv>`. The WSL form runs
 * the WSL launcher with `-d <distro> --exec docker <argv>`, and names the variables of `env` in WSLENV, with no path flags.
 * The values of `env` are in the process environment only. No shell is ever used.
 */
export function dockerInvocation(
  host: DockerHost,
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): DockerInvocation {
  if (host.kind === 'host') {
    return { file: DOCKER_PROGRAM, args: [...argv], env: { ...process.env, ...env } };
  }
  return {
    file: WSL_EXE,
    args: ['-d', host.distribution, '--exec', DOCKER_PROGRAM, ...argv],
    env: { ...process.env, ...env, WSLENV: Object.keys(env).join(':') },
  };
}

/** A bounded buffer: keeps chunks up to a cap, and records that it dropped some. */
function bounded(maxBytes: number): {
  add(chunk: Buffer): void;
  done(): { buffer: Buffer; truncated: boolean };
} {
  const parts: Buffer[] = [];
  let size = 0;
  let truncated = false;
  return {
    add: (chunk) => {
      if (size + chunk.length > maxBytes) {
        truncated = true;
        return;
      }
      size += chunk.length;
      parts.push(chunk);
    },
    done: () => ({ buffer: Buffer.concat(parts), truncated }),
  };
}

/** Starts docker, collects what the options ask for, and stops it on timeout or abort. Never rejects. */
function runDocker(
  host: DockerHost,
  argv: readonly string[],
  options: ContainerRunOptions,
): Promise<ContainerRunResult> {
  return new Promise<ContainerRunResult>((resolvePromise) => {
    const invocation = dockerInvocation(host, argv, options.env ?? {});
    let child: ChildProcess;
    try {
      child = nodeSpawn(invocation.file, invocation.args, {
        shell: false,
        windowsHide: true,
        env: invocation.env,
        stdio: [options.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      });
    } catch {
      resolvePromise({ started: false });
      return;
    }

    const stdout = bounded(options.capture?.maxBytes ?? 0);
    const stderr = bounded(STDERR_MAX_BYTES);
    let settled = false;
    let stopReason: 'timeout' | 'aborted' | null = null;
    let graceTimer: NodeJS.Timeout | undefined;

    const finish = (result: ContainerRunResult): void => {
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

    const onData = (sink: (chunk: Buffer) => void) => (chunk: Buffer | string) => {
      if (settled || stopReason !== null) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      options.onOutput?.(buffer);
      sink(buffer);
    };
    child.stdout?.on(
      'data',
      onData((buffer) => {
        if (options.capture !== undefined) stdout.add(buffer);
      }),
    );
    child.stderr?.on(
      'data',
      onData((buffer) => stderr.add(buffer)),
    );
    // A program that exits before it reads its stdin must not raise an unhandled error.
    child.stdin?.on('error', () => undefined);

    child.on('error', () => {
      if (child.pid === undefined) finish({ started: false });
    });
    child.on('close', (code, signal) => {
      if (stopReason !== null) return;
      const out = stdout.done();
      finish({
        started: true,
        code,
        signal,
        timedOut: false,
        aborted: false,
        stderr: stderr.done().buffer,
        ...(options.capture === undefined ? {} : { stdout: out.buffer, truncated: out.truncated }),
      });
    });

    if (options.stdin !== undefined) child.stdin?.end(options.stdin);
    if (options.signal !== undefined) {
      if (options.signal.aborted) stop('aborted');
      else options.signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/** The app's transport for a Docker host. It is the only code that starts docker (through the WSL launcher for a WSL host). */
export function appContainerTransport(host: DockerHost): ContainerTransport {
  return { run: (argv, options) => runDocker(host, argv, options) };
}

/** A candidate container from the label listing. */
export interface ContainerCandidate {
  id: string;
  running: boolean;
  /** Creation time in milliseconds, or 0 when the listing did not give one. */
  created: number;
}

/**
 * The time of docker's `CreatedAt` text (`2026-11-26 10:00:00 +0000 UTC`), in milliseconds. 0 when the text is not
 * in that form.
 */
export function createdMs(text: unknown): number {
  if (typeof text !== 'string') return 0;
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?: \S+)? ([+-])(\d{2})(\d{2})/.exec(text);
  if (match === null) return 0;
  const [, day, time, sign, hours, minutes] = match;
  const parsed = Date.parse(`${day}T${time}${sign}${hours}:${minutes}`);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** The candidates in a `docker ps --format '{{json .}}'` listing. A line that is not a container entry is skipped. */
export function parseListing(stdout: string): ContainerCandidate[] {
  const found: ContainerCandidate[] = [];
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(entry) || typeof entry['ID'] !== 'string' || entry['ID'] === '') continue;
    found.push({
      id: entry['ID'],
      running: entry['State'] === 'running',
      created: createdMs(entry['CreatedAt']),
    });
  }
  return found;
}

/**
 * The user programs run as, from the metadata label (AC2): the last `remoteUser`, else the last `containerUser`.
 * A user that fails CONTAINER_USER_PATTERN is ignored, so null (the image's default user) is returned.
 */
export function userOfMetadata(metadata: unknown): string | null {
  let entries: unknown = metadata;
  if (typeof metadata === 'string') {
    try {
      entries = JSON.parse(metadata);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(entries)) return null;
  let remote: string | null = null;
  let container: string | null = null;
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    if (typeof entry['remoteUser'] === 'string') remote = entry['remoteUser'];
    if (typeof entry['containerUser'] === 'string') container = entry['containerUser'];
  }
  const user = remote ?? container;
  return user !== null && CONTAINER_USER_PATTERN.test(user) ? user : null;
}

/** Why a container could not be found (D44). Never names the folder, the container, the image or the user. */
export type FindCause = 'engine-down' | 'not-found' | 'docker-missing';

/** The result of a lookup: the container's id, whether it runs, and its user, or the cause. */
export type FindResult =
  { ok: true; id: string; running: boolean; user: string | null } | { ok: false; cause: FindCause };

/** The cause of a failed docker call, read from its stderr. An unknown failure is an engine problem. */
export function causeOf(stderr: string): FindCause {
  if (/execvpe\(docker\) failed|docker: not found|executable file not found/i.test(stderr)) {
    return 'docker-missing';
  }
  return 'engine-down';
}

/** The stderr of a run as text, with NUL bytes dropped (a UTF-16 message from the WSL launcher is read as text too). */
export function textOf(stderr: Buffer | undefined): string {
  return (stderr ?? Buffer.alloc(0)).toString('utf8').replace(/\0/g, '');
}

/**
 * Finds the container for a folder (AC2): `docker ps -a` with the label filter, then a running one over a stopped
 * one, and the newest among equals. Its user comes from `docker inspect` on the metadata label. Never throws.
 */
export async function findContainer(
  transport: ContainerTransport,
  folder: string,
): Promise<FindResult> {
  const listed = await transport.run(
    [
      'ps',
      '-a',
      '--no-trunc',
      '--filter',
      `label=${LABEL_LOCAL_FOLDER}=${folder}`,
      '--format',
      '{{json .}}',
    ],
    { timeoutMs: DOCKER_TIMEOUT_MS, capture: { maxBytes: LISTING_MAX_BYTES } },
  );
  if (!listed.started) return { ok: false, cause: 'docker-missing' };
  if (listed.timedOut || listed.code !== 0) {
    return { ok: false, cause: causeOf(textOf(listed.stderr)) };
  }
  const candidates = parseListing((listed.stdout ?? Buffer.alloc(0)).toString('utf8'));
  if (candidates.length === 0) return { ok: false, cause: 'not-found' };
  candidates.sort((a, b) => Number(b.running) - Number(a.running) || b.created - a.created);
  const chosen = candidates[0];
  if (chosen === undefined) return { ok: false, cause: 'not-found' };

  const inspected = await transport.run(
    ['inspect', '--format', '{{json .Config.Labels}}', chosen.id],
    { timeoutMs: DOCKER_TIMEOUT_MS, capture: { maxBytes: LISTING_MAX_BYTES } },
  );
  if (!inspected.started) return { ok: false, cause: 'docker-missing' };
  if (inspected.timedOut || inspected.code !== 0) {
    return { ok: false, cause: causeOf(textOf(inspected.stderr)) };
  }
  let labels: unknown;
  try {
    labels = JSON.parse((inspected.stdout ?? Buffer.alloc(0)).toString('utf8'));
  } catch {
    labels = null;
  }
  const metadata = isRecord(labels) ? labels[LABEL_METADATA] : undefined;
  return { ok: true, id: chosen.id, running: chosen.running, user: userOfMetadata(metadata) };
}

/** Options of an exec call: the container, the user, the folder, the variables that cross, and the command. */
export interface ExecSpec {
  id: string;
  user: string | null;
  cwd: string;
  /** Names of the variables that cross (`-e NAME`); their values are set in the docker process. */
  names: readonly string[];
  /** Whether stdin is passed (`-i`). */
  stdin?: boolean;
  /** The program and its arguments, run inside the container. */
  command: readonly string[];
}

/**
 * The exec argument array (D44): `exec [-i] [-u <user>] -w <cwd> [-e <NAME> …] <id> <command…>`. Every value is one
 * argument; the command is the program's own words, never a shell line.
 */
export function execArgv(spec: ExecSpec): string[] {
  return [
    'exec',
    ...(spec.stdin === true ? ['-i'] : []),
    ...(spec.user !== null ? ['-u', spec.user] : []),
    '-w',
    spec.cwd,
    ...spec.names.flatMap((name) => ['-e', name]),
    spec.id,
    ...spec.command,
  ];
}
