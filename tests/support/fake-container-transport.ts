import { spawn, type ChildProcess } from 'node:child_process';
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, posix, relative, sep } from 'node:path';
import { CONNECT_SCRIPT, FILES_SCRIPTS, KILL_SCRIPT } from '../../src/main/env/container';
import { GROUP_MARKER, LAUNCHER } from '../../src/main/env/launcher';
import {
  LABEL_CONFIG_FILE,
  LABEL_LOCAL_FOLDER,
  LABEL_METADATA,
  type ContainerRunOptions,
  type ContainerRunResult,
  type ContainerTransport,
} from '../../src/main/env/container-transport';

// A fake docker transport (D44, p4-env-container). It never starts docker. It holds labelled containers, each
// standing for a container's `/` over a local temp folder, and answers the docker calls the backend makes: the
// label listing, the inspect of the labels, start, version and exec. An exec is read by its shape (the exec
// argument array is parsed here, as the backend builds it). A fixed script is recognised by its exact text (the
// constants the backend exports) and does its operation with node:fs on the mapped folder, answering with the
// script's own code word. A launched program runs locally in the mapped folder, with the variables it was given,
// as the SSH fake does. Every docker call is recorded with its argument array and the variables of the docker
// process, so a test can check that no value is in an argument array (AC3).

/** One labelled container the fake holds. */
export interface FakeContainer {
  id: string;
  /** The value of `devcontainer.local_folder`. */
  folder: string;
  /** The `devcontainer.metadata` label as docker stores it (a JSON text), or null when the label is absent. */
  metadata: string | null;
  running: boolean;
  /** docker's `CreatedAt` text. */
  created: string;
  /** The local folder that stands for the container's `/`. */
  mount: string;
  /** The `devcontainer.config_file` label, when the container has one. */
  configFile?: string;
  /** The container's name, as docker lists it. Default `fake-<id>`. */
  name?: string;
}

/** What the fake answers for the engine, the start, the connect check and the probes. */
export interface FakeDockerScript {
  /** docker cannot start: every call is `{ started: false }`. */
  dockerMissing?: boolean;
  /** The engine is down: every call fails with the daemon's message. */
  engineDown?: boolean;
  /** `docker start` fails for a stopped container. Default false. */
  startFails?: boolean;
  /** The output of `uname -s` in the container. Default `Linux`. */
  uname?: string;
  /** Whether `setsid` exists in the container. Default true. */
  setsid?: boolean;
  /** Whether the unshare probe passes. Default false. */
  probe?: boolean;
  /** When true, every launched program stalls until it is killed or its exec ends. */
  stall?: boolean;
  /** The answer for a launched program: its exit code and output chunks. Set, the program is not run. */
  program?: (argv: readonly string[]) => { code?: number; chunks?: string[]; stderr?: string };
  /** When true, every file counts as runnable (a container whose files all have the execute bit). */
  executable?: boolean;
}

/** One docker call as the backend sent it. */
export interface FakeDockerCall {
  argv: string[];
  /** The variables of the docker process (the values the backend gave the call). */
  env: NodeJS.ProcessEnv;
}

export interface FakeDocker extends ContainerTransport {
  /** Every docker call, in order. */
  readonly calls: FakeDockerCall[];
  readonly script: FakeDockerScript;
  /** The containers the fake holds. A test may add or change them. */
  readonly containers: FakeContainer[];
  /** Stops a running container, as a user would: its execs then fail with `is not running`. */
  stopContainer(id: string): void;
  /** Starts a stopped container (the test's own reset, with no docker start call). */
  runContainer(id: string): void;
  /** Kills every program still running, and resolves when they have exited (a test's cleanup). */
  killAll(): Promise<void>;
  /** The local folder that stands for a container path, for a test's own setup and checks. */
  localOf(container: FakeContainer, remote: string): string;
}

/** The daemon's message when the engine is down (the backend reads it as `engine-down`). */
const ENGINE_DOWN =
  'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?\n';

/** A parsed exec argument array: the flags the backend writes, the container and the command. */
export interface ParsedExec {
  stdin: boolean;
  user: string | null;
  cwd: string;
  names: string[];
  id: string;
  command: string[];
}

/** Reads an exec argument array the way the backend builds it. Null for any other shape. */
export function parseExec(argv: readonly string[]): ParsedExec | null {
  if (argv[0] !== 'exec') return null;
  let at = 1;
  let stdin = false;
  let user: string | null = null;
  let cwd = '/';
  const names: string[] = [];
  if (argv[at] === '-i') {
    stdin = true;
    at += 1;
  }
  if (argv[at] === '-u') {
    user = argv[at + 1] ?? null;
    at += 2;
  }
  if (argv[at] === '-w') {
    cwd = argv[at + 1] ?? '/';
    at += 2;
  }
  while (argv[at] === '-e') {
    names.push(argv[at + 1] ?? '');
    at += 2;
  }
  const id = argv[at];
  if (id === undefined) return null;
  return { stdin, user, cwd, names, id, command: argv.slice(at + 1) };
}

/** The local path of a container path under the mount. A relative path is returned as it is. */
function localPath(mount: string, remote: string): string {
  if (!posix.isAbsolute(remote)) return remote;
  const segments = posix
    .normalize(remote)
    .split('/')
    .filter((part) => part !== '');
  return join(mount, ...segments);
}

/** The container path of a local path inside a mount, or the input when it is outside. */
export function remoteOfLocal(mount: string, local: string): string {
  const rel = relative(mount, local);
  if (rel === '') return '/';
  if (rel.startsWith('..') || isAbsolute(rel)) return local;
  return `/${rel.split(sep).join('/')}`;
}

/** What a script answers: its exit code, stdout and stderr. */
interface Answer {
  code: number;
  stdout: Buffer;
  stderr: string;
}

const ok = (stdout: string | Buffer = ''): Answer => ({
  code: 0,
  stdout: Buffer.from(stdout),
  stderr: '',
});

const failWith = (word: string): Answer => ({
  code: 1,
  stdout: Buffer.alloc(0),
  stderr: `${word}\n`,
});

/** True when a local path is there, as `[ -e ]` or `[ -L ]` finds it. */
function present(local: string): boolean {
  return existsSync(local) || isLink(local);
}

/** True for a symbolic link (not followed). */
function isLink(local: string): boolean {
  try {
    return lstatSync(local).isSymbolicLink();
  } catch {
    return false;
  }
}

/** True for a folder (followed, as `[ -d ]` is). */
function isDir(local: string): boolean {
  try {
    return statSync(local).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The code word of a failed script on a container path, from the path alone (the scripts' own explain): EACCES
 * when the path is there, ENOTDIR when an ancestor is a file, ENOENT otherwise.
 */
function explainWord(mount: string, remote: string, linkAware: boolean): Answer {
  const local = localPath(mount, remote);
  if (linkAware ? present(local) : existsSync(local)) return failWith('EACCES');
  let above = posix.dirname(remote);
  for (;;) {
    const folder = localPath(mount, above);
    if (existsSync(folder) && !isDir(folder)) return failWith('ENOTDIR');
    if (above === '/') break;
    above = posix.dirname(above);
  }
  return failWith('ENOENT');
}

/** The answer of one fixed files script (or the connect check), as the shell would give it. Null when unknown. */
function answerFor(
  body: string,
  args: readonly string[],
  container: FakeContainer,
  stdin: Buffer | undefined,
  script: FakeDockerScript,
): Answer | null {
  const mount = container.mount;
  const at = (index: number): string => args[index] ?? '';
  const local = (index: number): string => localPath(mount, at(index));
  switch (body) {
    case FILES_SCRIPTS.stat:
    case FILES_SCRIPTS.statFollow: {
      try {
        const st = body === FILES_SCRIPTS.statFollow ? statSync(local(0)) : lstatSync(local(0));
        return ok(
          `${st.mode.toString(16)} ${st.size} ${Math.floor(st.mtimeMs / 1000)} ${Math.floor(st.atimeMs / 1000)} 0 ${st.uid} ${st.gid} ${st.nlink} ${st.ino}\n`,
        );
      } catch {
        return explainWord(mount, at(0), body === FILES_SCRIPTS.stat);
      }
    }
    case FILES_SCRIPTS.accessExists:
      return existsSync(local(0)) ? ok() : explainWord(mount, at(0), false);
    case FILES_SCRIPTS.accessExecute:
      // The mode bits decide, as `test -x` does for a user who is not root (Windows has no execute bit).
      if (
        existsSync(local(0)) &&
        (script.executable === true || (statSync(local(0)).mode & 0o111) !== 0)
      ) {
        return ok();
      }
      return explainWord(mount, at(0), false);
    case FILES_SCRIPTS.realpath:
      try {
        const real = realpathSync(local(0));
        return ok(`${remoteOfLocal(realpathSync(mount), real)}\n`);
      } catch {
        return explainWord(mount, at(0), false);
      }
    case FILES_SCRIPTS.readlink:
      if (isLink(local(0))) {
        const target = String(readlinkSync(local(0)));
        return ok(`${isAbsolute(target) ? remoteOfLocal(mount, target) : target}\n`);
      }
      if (existsSync(local(0))) return failWith('EINVAL');
      return explainWord(mount, at(0), false);
    case FILES_SCRIPTS.read:
      if (isDir(local(0))) return failWith('EISDIR');
      try {
        return ok(readFileSync(local(0)));
      } catch {
        return explainWord(mount, at(0), false);
      }
    case FILES_SCRIPTS.readCapped:
      if (isDir(local(0))) return failWith('EISDIR');
      try {
        return ok(readFileSync(local(0)).subarray(0, Number(at(1))));
      } catch {
        return explainWord(mount, at(0), false);
      }
    case FILES_SCRIPTS.readRange:
      if (isDir(local(0))) return failWith('EISDIR');
      try {
        accessSync(local(0), constants.R_OK);
      } catch {
        return explainWord(mount, at(0), false);
      }
      {
        const data = readFileSync(local(0));
        const start = Number(at(1)) - 1;
        return ok(data.subarray(start, start + Number(at(2))));
      }
    case FILES_SCRIPTS.write:
      if (isDir(local(0))) return failWith('EISDIR');
      try {
        writeFileSync(local(0), stdin ?? Buffer.alloc(0));
        return ok();
      } catch {
        return explainWord(mount, at(0), false);
      }
    case FILES_SCRIPTS.writeExclusive:
      if (present(local(0))) return failWith('EEXIST');
      try {
        writeFileSync(local(0), stdin ?? Buffer.alloc(0));
        return ok();
      } catch {
        return explainWord(mount, at(0), true);
      }
    case FILES_SCRIPTS.mkdir:
      try {
        mkdirSync(local(0));
        return ok();
      } catch {
        return present(local(0)) ? failWith('EEXIST') : explainWord(mount, at(0), true);
      }
    case FILES_SCRIPTS.mkdirRecursive:
      if (isDir(local(0))) return ok();
      if (present(local(0))) return failWith('EEXIST');
      try {
        mkdirSync(local(0), { recursive: true });
        return ok();
      } catch {
        return explainWord(mount, at(0), true);
      }
    case FILES_SCRIPTS.remove: {
      const recursive = at(1) === '1';
      const force = at(2) === '1';
      if (isDir(local(0)) && !isLink(local(0))) {
        if (!recursive) return failWith('EISDIR');
        try {
          rmSync(local(0), { recursive: true });
          return ok();
        } catch {
          return explainWord(mount, at(0), true);
        }
      }
      if (present(local(0))) {
        try {
          unlinkSync(local(0));
          return ok();
        } catch {
          return explainWord(mount, at(0), true);
        }
      }
      if (force) return ok();
      return explainWord(mount, at(0), true);
    }
    case FILES_SCRIPTS.removeDir:
      if (isDir(local(0)) && !isLink(local(0))) {
        if (readdirSync(local(0)).length > 0) return failWith('ENOTEMPTY');
        try {
          rmdirSync(local(0));
          return ok();
        } catch {
          return explainWord(mount, at(0), true);
        }
      }
      if (present(local(0))) return failWith('ENOTDIR');
      return explainWord(mount, at(0), true);
    case FILES_SCRIPTS.rename:
      if (!present(local(0))) return explainWord(mount, at(0), true);
      if (isDir(local(1))) return failWith('EEXIST');
      try {
        renameSync(local(0), local(1));
        return ok();
      } catch {
        return failWith('EIO');
      }
    case FILES_SCRIPTS.chmod:
      try {
        chmodSync(local(0), Number.parseInt(at(1), 8));
        return ok();
      } catch {
        return explainWord(mount, at(0), true);
      }
    case FILES_SCRIPTS.symlink: {
      // The script's own words: $1 is the target and $2 the link's path.
      const target = at(0);
      const link = local(1);
      if (present(link)) return failWith('EEXIST');
      try {
        symlinkSync(isAbsolute(target) ? localPath(mount, target) : target, link);
        return ok();
      } catch {
        return explainWord(mount, at(1), true);
      }
    }
    case FILES_SCRIPTS.readdir: {
      if (!isDir(local(0))) {
        if (present(local(0))) return failWith('ENOTDIR');
        return explainWord(mount, at(0), true);
      }
      let names: string[];
      try {
        names = readdirSync(local(0));
      } catch {
        return explainWord(mount, at(0), true);
      }
      const lines = names.map((name) => {
        const child = join(local(0), name);
        const type = isLink(child) ? 'l' : isDir(child) ? 'd' : existsSync(child) ? 'f' : 'o';
        return `${type} ${name}\n`;
      });
      return ok(lines.join(''));
    }
    case CONNECT_SCRIPT:
      return ok(`${script.uname ?? 'Linux'}\n${script.setsid === false ? '' : 'SDD-SETSID\n'}`);
    default:
      return null;
  }
}

/** The result of a call that finished with the given stdout and stderr. */
function finished(
  code: number,
  stdout: Buffer | string,
  stderr: Buffer | string,
  options: ContainerRunOptions,
): ContainerRunResult {
  const out = Buffer.from(stdout);
  const err = Buffer.from(stderr);
  return {
    started: true,
    code,
    signal: null,
    timedOut: false,
    aborted: false,
    stderr: err,
    ...(options.capture === undefined
      ? {}
      : {
          stdout: out,
          truncated: out.length > options.capture.maxBytes,
        }),
  };
}

/** A fake docker over the containers it holds. */
export function fakeDocker(containers: FakeContainer[], script: FakeDockerScript = {}): FakeDocker {
  const calls: FakeDockerCall[] = [];
  let nextGroup = 91_000;
  const groups = new Map<number, ChildProcess | (() => void)>();

  /** Kills a program's whole group, as the launcher's group kill does on POSIX. */
  function killProcess(child: ChildProcess): Promise<void> {
    const exited = new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      child.once('exit', () => resolve());
      setTimeout(resolve, 3_000).unref();
    });
    if (process.platform !== 'win32' && child.pid !== undefined) {
      try {
        process.kill(-child.pid, 'SIGKILL');
        return exited;
      } catch {
        // The group has gone already; the child kill below is the fallback.
      }
    }
    child.kill('SIGKILL');
    return exited;
  }

  /** A program that stalls: it prints a group marker and waits for a kill, a timeout or an abort. */
  function stalled(options: ContainerRunOptions): Promise<ContainerRunResult> {
    const group = nextGroup++;
    options.onOutput?.(Buffer.from(`${GROUP_MARKER}${group}\n`));
    return new Promise<ContainerRunResult>((resolve) => {
      let settled = false;
      const finish = (result: ContainerRunResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        groups.delete(group);
        options.signal?.removeEventListener('abort', onAbort);
        resolve(result);
      };
      const timer = setTimeout(
        () =>
          finish({ started: true, code: null, signal: 'SIGKILL', timedOut: true, aborted: false }),
        options.timeoutMs,
      );
      const onAbort = (): void =>
        finish({ started: true, code: null, signal: 'SIGKILL', timedOut: false, aborted: true });
      options.signal?.addEventListener('abort', onAbort, { once: true });
      if (options.signal?.aborted === true) onAbort();
      groups.set(group, () =>
        finish({ started: true, code: null, signal: 'SIGKILL', timedOut: false, aborted: false }),
      );
    });
  }

  /** A launched program: `sh -c LAUNCHER sh <file> <args…>`, run locally in the mapped folder. */
  async function launched(
    parsed: ParsedExec,
    container: FakeContainer,
    options: ContainerRunOptions,
  ): Promise<ContainerRunResult> {
    const [file, ...args] = parsed.command.slice(4);
    if (file === undefined) return finished(127, '', 'fake: no program\n', options);
    if (script.stall === true) return stalled(options);
    if (script.program !== undefined) {
      const answer = script.program(parsed.command.slice(4));
      options.onOutput?.(Buffer.from(`${GROUP_MARKER}${process.pid}\n`));
      for (const chunk of answer.chunks ?? []) options.onOutput?.(Buffer.from(chunk));
      // The program's own stderr comes after the marker, as it does through docker exec.
      if (answer.stderr !== undefined) options.onOutput?.(Buffer.from(answer.stderr));
      return {
        started: true,
        code: answer.code ?? 0,
        signal: null,
        timedOut: false,
        aborted: false,
        stderr: Buffer.from(answer.stderr ?? ''),
      };
    }
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const name of parsed.names) {
      const value = options.env?.[name];
      if (value !== undefined) env[name] = value;
    }
    const cwd = localPath(container.mount, parsed.cwd);
    const runArgs =
      file === 'git' && args[0] === '-C' && args[1] !== undefined
        ? ['-C', localPath(container.mount, args[1]), ...args.slice(2)]
        : args;
    let child: ChildProcess;
    try {
      child = spawn(file, runArgs, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      return finished(127, '', '', options);
    }
    if (child.pid === undefined) {
      child.on('error', () => undefined);
      return finished(127, '', '', options);
    }
    const group = child.pid;
    groups.set(group, child);
    // The launcher's first line: the marker with the group id, which the backend takes off.
    const markerLine = Buffer.from(`${GROUP_MARKER}${group}\n`);
    options.onOutput?.(markerLine);
    const outParts: Buffer[] = [markerLine];
    const errParts: Buffer[] = [];
    return new Promise<ContainerRunResult>((resolve) => {
      let settled = false;
      const finish = (result: ContainerRunResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        groups.delete(group);
        options.signal?.removeEventListener('abort', onAbort);
        const out = Buffer.concat(outParts);
        const err = Buffer.concat(errParts);
        const captured =
          options.capture === undefined
            ? { stderr: err }
            : { stdout: out, stderr: err, truncated: out.length > options.capture.maxBytes };
        resolve({ ...result, ...captured } as ContainerRunResult);
      };
      const stopWith = (reason: 'timeout' | 'aborted'): void => {
        if (settled) return;
        void killProcess(child).then(() =>
          finish({
            started: true,
            code: null,
            signal: 'SIGKILL',
            timedOut: reason === 'timeout',
            aborted: reason === 'aborted',
          }),
        );
      };
      const onAbort = (): void => stopWith('aborted');
      const timer = setTimeout(() => stopWith('timeout'), options.timeoutMs);
      options.signal?.addEventListener('abort', onAbort, { once: true });
      if (options.signal?.aborted === true) onAbort();
      child.stdout?.on('data', (chunk: Buffer) => {
        if (settled) return;
        options.onOutput?.(chunk);
        outParts.push(chunk);
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        if (settled) return;
        options.onOutput?.(chunk);
        errParts.push(chunk);
      });
      child.on('error', () =>
        finish({ started: true, code: 127, signal: null, timedOut: false, aborted: false }),
      );
      child.on('close', (code, signal) =>
        finish({ started: true, code, signal, timedOut: false, aborted: false }),
      );
    });
  }

  /** `kill -KILL -- '-<group>'`: stops a group, or reports that there is none. */
  async function killGroup(arg: string, options: ContainerRunOptions): Promise<ContainerRunResult> {
    const group = Number(arg.slice(1));
    const target = groups.get(group);
    if (target === undefined) return finished(1, '', '', options);
    groups.delete(group);
    if (typeof target === 'function') target();
    else await killProcess(target);
    return finished(0, '', '', options);
  }

  /** The exec of one call: the container must be running, then the command is answered by its shape. */
  async function exec(
    argv: readonly string[],
    options: ContainerRunOptions,
  ): Promise<ContainerRunResult> {
    const parsed = parseExec(argv);
    if (parsed === null) return finished(1, '', 'fake: unsupported exec\n', options);
    const container = containers.find((item) => item.id === parsed.id);
    if (container === undefined) {
      return finished(
        1,
        '',
        `Error response from daemon: No such container: ${parsed.id}\n`,
        options,
      );
    }
    if (!container.running) {
      return finished(
        1,
        '',
        `Error response from daemon: Container ${container.id} is not running\n`,
        options,
      );
    }
    const command = parsed.command;
    if (command[0] === 'unshare') {
      return finished(script.probe === true ? 0 : 1, '', '', options);
    }
    if (command[0] === 'sh' && command[1] === '-c') {
      const body = command[2] ?? '';
      if (body === LAUNCHER) return launched(parsed, container, options);
      if (body === KILL_SCRIPT) return killGroup(command[4] ?? '', options);
      const stdin = options.stdin === undefined ? undefined : Buffer.from(options.stdin);
      const answer = answerFor(body, command.slice(4), container, stdin, script);
      if (answer !== null) return finished(answer.code, answer.stdout, answer.stderr, options);
    }
    return finished(1, '', 'fake: unsupported command\n', options);
  }

  /** The label listing: `ps -a --filter label=<key>[=<value>] --format {{json .}}`. */
  function listing(argv: readonly string[], options: ContainerRunOptions): ContainerRunResult {
    const filter = argv.find((arg) => arg.startsWith('label='));
    const wanted = filter === undefined ? null : filter.slice('label='.length);
    const folder =
      wanted !== null && wanted.includes('=') ? wanted.slice(wanted.indexOf('=') + 1) : null;
    const rows = containers
      .filter((item) => (folder === null ? true : item.folder === folder))
      .map((item) =>
        JSON.stringify({
          ID: item.id,
          Names: item.name ?? `fake-${item.id}`,
          State: item.running ? 'running' : 'exited',
          CreatedAt: item.created,
          Labels: `${LABEL_LOCAL_FOLDER}=${item.folder}`,
        }),
      );
    return finished(0, rows.map((row) => `${row}\n`).join(''), '', options);
  }

  const transport: FakeDocker = {
    get calls() {
      return calls;
    },
    script,
    containers,
    stopContainer: (id) => {
      const item = containers.find((candidate) => candidate.id === id);
      if (item !== undefined) item.running = false;
    },
    runContainer: (id) => {
      const item = containers.find((candidate) => candidate.id === id);
      if (item !== undefined) item.running = true;
    },
    localOf: (container, remote) => localPath(container.mount, remote),
    killAll: async () => {
      const running = [...groups.values()];
      groups.clear();
      await Promise.all(
        running.map((target) => (typeof target === 'function' ? target() : killProcess(target))),
      );
    },
    run: async (argv, options) => {
      calls.push({ argv: [...argv], env: { ...(options.env ?? {}) } });
      if (script.dockerMissing === true) return { started: false };
      if (script.engineDown === true) return finished(1, '', ENGINE_DOWN, options);
      const verb = argv[0];
      if (verb === 'version') {
        return finished(
          0,
          '{"Client":{"Version":"28.1.1"},"Server":{"Version":"28.1.1"}}\n',
          '',
          options,
        );
      }
      if (verb === 'ps') return listing(argv, options);
      if (verb === 'inspect') {
        // One line of labels per container id, in the order the ids are given (`inspect --format <f> <id…>`).
        const ids = argv.slice(3);
        const lines: string[] = [];
        for (const id of ids) {
          const container = containers.find((item) => item.id === id);
          if (container === undefined)
            return finished(1, '', `Error: No such object: ${id}\n`, options);
          const labels: Record<string, string> = { [LABEL_LOCAL_FOLDER]: container.folder };
          if (container.metadata !== null) labels[LABEL_METADATA] = container.metadata;
          if (container.configFile !== undefined) labels[LABEL_CONFIG_FILE] = container.configFile;
          lines.push(JSON.stringify(labels));
        }
        return finished(0, lines.map((line) => `${line}\n`).join(''), '', options);
      }
      if (verb === 'start') {
        const id = argv[1] ?? '';
        const container = containers.find((item) => item.id === id);
        if (container === undefined) {
          return finished(1, '', `Error response from daemon: No such container: ${id}\n`, options);
        }
        if (script.startFails === true) {
          return finished(1, '', 'Error response from daemon: failed to start\n', options);
        }
        container.running = true;
        return finished(0, `${id}\n`, '', options);
      }
      if (verb === 'exec') return exec(argv, options);
      return finished(1, '', 'fake: unsupported docker call\n', options);
    },
  };
  return transport;
}
