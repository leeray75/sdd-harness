// The local backend of the environment interface (D41, p4-env-local). It is today's behaviour behind
// the interface: node:path for paths, node:fs for files and watching, a child process started
// without a shell with the timeout and tree kill of D31, and the git module of D38. Errors of the
// files part pass through unchanged, so their Node codes are the modules' codes. This is the only
// file under src/main/env that imports node:fs, node:fs/promises and node:child_process, and the only
// one that imports the network module. Runs only in main.

import { execFile, spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { constants, promises as fsp, realpath, watch as fsWatch } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { chooseNetwork, wrapCommand, writerNetworkEnv } from '../commands/network';
import * as git from '../git/git';
import { probeNetwork } from './probes';
import type {
  AccessMode,
  DirEntryInfo,
  Environment,
  FileHandleLike,
  FileStat,
  FilesPart,
  NetworkLevel,
  PathPart,
  ProcessPart,
  SpawnOptions,
  SpawnOutcome,
  WatchPart,
} from './types';

/** How long to wait for the output streams after the process exits, for a grandchild that holds them open. */
const STREAM_GRACE_MS = 250;

const pathPart: PathPart = {
  sep,
  join: (...parts) => join(...parts),
  resolve: (...parts) => resolve(...parts),
  relative: (from, to) => relative(from, to),
  dirname: (path) => dirname(path),
  basename: (path, suffix) => (suffix === undefined ? basename(path) : basename(path, suffix)),
  isAbsolute: (path) => isAbsolute(path),
};

function wrapHandle(handle: Awaited<ReturnType<typeof fsp.open>>): FileHandleLike {
  return {
    read: async (buffer, offset, length, position) => {
      const result = await handle.read(buffer, offset, length, position);
      return { bytesRead: result.bytesRead };
    },
    close: () => handle.close(),
  };
}

const filesPart: FilesPart = {
  stat: (path) => fsp.stat(path) as Promise<FileStat>,
  lstat: (path) => fsp.lstat(path) as Promise<FileStat>,
  // The native resolver expands Windows 8.3 short names (GIT~1 to .git), which the .git check needs.
  realpath: (path) =>
    new Promise<string>((resolvePromise, reject) => {
      realpath.native(path, (error, resolved) => {
        if (error) reject(error);
        else resolvePromise(resolved);
      });
    }),
  access: (path, mode: AccessMode) =>
    fsp.access(path, mode === 'execute' ? constants.X_OK : constants.F_OK),
  readFile: async (path, options) => {
    if (options?.maxBytes === undefined) {
      return fsp.readFile(path);
    }
    const handle = await fsp.open(path, 'r');
    try {
      const info = await handle.stat();
      if (info.size > options.maxBytes) {
        throw Object.assign(new Error('file is larger than the read limit'), { code: 'EFBIG' });
      }
      return await handle.readFile();
    } finally {
      await handle.close();
    }
  },
  open: async (path, flag) => wrapHandle(await fsp.open(path, flag)),
  writeFile: (path, data, options) => fsp.writeFile(path, data, options),
  mkdir: async (path, options) => {
    await fsp.mkdir(path, options);
  },
  readdir: async (path): Promise<DirEntryInfo[]> => fsp.readdir(path, { withFileTypes: true }),
  rm: (path, options) => fsp.rm(path, options),
  rmdir: (path) => fsp.rmdir(path),
  rename: (from, to) => fsp.rename(from, to),
  chmod: (path, mode) => fsp.chmod(path, mode),
  readlink: (path) => fsp.readlink(path),
  symlink: (target, path) => fsp.symlink(target, path),
};

const watchPart: WatchPart = {
  watchDir: (path, onEvent, onError) => {
    const watcher = fsWatch(path, (eventType, filename) => {
      onEvent(eventType, filename ?? null);
    });
    watcher.on('error', onError);
    return { close: () => watcher.close() };
  },
};

/**
 * Stops the process and everything it started: taskkill /T /F on Windows, the process group
 * elsewhere. `done` runs once the stop has been attempted, so a timeout's result is reported after
 * the tree is gone.
 */
function killTree(child: ChildProcess, platform: NodeJS.Platform, done: () => void): void {
  const pid = child.pid;
  if (pid === undefined) {
    done();
    return;
  }
  const fallback = (): void => {
    try {
      child.kill('SIGKILL');
    } catch {
      // The process has already gone.
    }
    done();
  };
  if (platform === 'win32') {
    try {
      execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, (error) => {
        if (error) fallback();
        else done();
      });
    } catch {
      fallback();
    }
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
    done();
  } catch {
    fallback();
  }
}

/** Starts the child and waits for it. Never rejects; output is passed to onOutput while it runs. */
function runChild(
  platform: NodeJS.Platform,
  command: string,
  argv: string[],
  options: SpawnOptions,
  env: NodeJS.ProcessEnv,
  network: NetworkLevel | undefined,
): Promise<SpawnOutcome> {
  return new Promise<SpawnOutcome>((resolvePromise) => {
    let child: ChildProcess;
    try {
      child = nodeSpawn(command, argv, {
        cwd: options.cwd,
        env,
        shell: false,
        windowsVerbatimArguments: options.verbatimArguments === true,
        windowsHide: true,
        // On POSIX the child leads its own process group, so a timeout can kill its children too.
        detached: platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      resolvePromise({ started: false });
      return;
    }

    let settled = false;
    let graceTimer: NodeJS.Timeout | undefined;
    // Set once a stop has begun: the exit and close events then wait for the stop's own result, so
    // the status of the child's exit (caused by the kill) never replaces "timed out" or "aborted".
    let stopReason: 'timeout' | 'aborted' | null = null;
    const netPart = network === undefined ? {} : { network };

    const finish = (outcome: SpawnOutcome): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutTimer);
      if (graceTimer !== undefined) clearTimeout(graceTimer);
      options.signal?.removeEventListener('abort', onAbort);
      resolvePromise(outcome);
    };

    const stop = (reason: 'timeout' | 'aborted'): void => {
      if (settled || stopReason !== null) {
        return;
      }
      stopReason = reason;
      killTree(child, platform, () =>
        finish({
          started: true,
          code: null,
          signal: null,
          timedOut: reason === 'timeout',
          aborted: reason === 'aborted',
          ...netPart,
        }),
      );
    };
    const onAbort = (): void => stop('aborted');

    const onData = (chunk: Buffer): void => {
      if (!settled) {
        options.onOutput?.(chunk);
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    child.on('error', () => {
      // An error before the process started means it could not be started. Later errors
      // (for example a failed kill) do not change the result.
      if (child.pid === undefined) {
        finish({ started: false });
      }
    });

    child.on('exit', (code, signal) => {
      if (settled || stopReason !== null) {
        return;
      }
      // Give the output streams a moment to finish, in case a grandchild still holds them.
      graceTimer = setTimeout(() => {
        if (stopReason === null) {
          finish({ started: true, code, signal, timedOut: false, aborted: false, ...netPart });
        }
      }, STREAM_GRACE_MS);
    });

    child.on('close', (code, signal) => {
      if (stopReason !== null) {
        return;
      }
      finish({ started: true, code, signal, timedOut: false, aborted: false, ...netPart });
    });

    const timeoutTimer = setTimeout(() => stop('timeout'), options.timeoutMs);
    if (options.signal !== undefined) {
      if (options.signal.aborted) {
        stop('aborted');
      } else {
        options.signal.addEventListener('abort', onAbort, { once: true });
      }
    }
  });
}

/** Builds the local process part for the platform of this app. */
function processPart(): ProcessPart {
  const platform = process.platform;
  return {
    platform,
    networkLevel: async () => chooseNetwork(platform, await probeNetwork(platform)).level,
    spawn: async (file, argv, options) => {
      let command = file;
      let args = [...argv];
      let env = options.env;
      let network: NetworkLevel | undefined;
      // The writer's command gets the network limit and the dead proxies (D31); nothing else does.
      if (options.network === 'none') {
        const choice = chooseNetwork(platform, await probeNetwork(platform));
        const wrapped = wrapCommand(choice, file, args);
        command = wrapped.command;
        args = wrapped.args;
        env = { ...env, ...writerNetworkEnv() };
        network = choice.level;
      }
      return runChild(platform, command, args, options, env, network);
    },
  };
}

const gitPart: Environment['git'] = {
  currentBranch: (root) => git.currentBranch(root),
  defaultBranch: (root) => git.defaultBranch(root),
  changedPaths: (root) => git.changedPaths(root),
  stage: (root, paths) => git.stage(root, paths),
  commit: (root, message) => git.commit(root, message),
  push: (root, branch) => git.push(root, branch),
  aheadOfUpstream: (root) => git.aheadOfUpstream(root),
  ignoredEntries: (root, env) => git.ignoredEntries(root, env),
};

/** The local folder is always reachable: its state never changes and its reconnect always works (D43). */
const connectionPart: Environment['connection'] = {
  state: () => 'connected',
  onChange: () => () => undefined,
  reconnect: async () => ({ ok: true }),
};

let local: Environment | undefined;

/**
 * The local backend: the app's own folder tree, process table and git, as they are today. It is one
 * object, so `environmentFor` and the tests get the same backend.
 */
export function localEnvironment(): Environment {
  local ??= {
    path: pathPart,
    files: filesPart,
    process: processPart(),
    watch: watchPart,
    git: gitPart,
    connection: connectionPart,
  };
  return local;
}
