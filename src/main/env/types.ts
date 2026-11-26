// The environment interface (D41, p4-env-local). Every part of the app that works inside a project
// reaches the project through one of these objects: paths, files, programs, watching and git. The
// local backend (src/main/env/local.ts) is the first; WSL, SSH and container backends come later
// (docs/environments.md). Types only: no Electron import, and nothing here runs anything.
//
// Every method is async except the path helpers and the platform value. Failures carry the Node
// error `code` (ENOENT, ENOTDIR, EISDIR, EACCES, EPERM, EBUSY, ELOOP, EEXIST and so on).

import type { GitResult, GitStatus } from '../git/git';

/** Named so it does not clash with the store's descriptor type `ProjectEnvironment`. */
export type Environment = {
  readonly path: PathPart;
  readonly files: FilesPart;
  readonly process: ProcessPart;
  readonly watch: WatchPart;
  readonly git: GitPart;
};

/** The tools, commands and agent host see this narrower view: no git part and no watch part. */
export interface ToolEnvironment {
  readonly path: PathPart;
  readonly files: FilesPart;
  readonly process: ProcessPart;
  /** The git-ignored entries of a root; null when git is missing or the root is not a repository. */
  ignoredEntries(root: string, env?: NodeJS.ProcessEnv): Promise<Set<string> | null>;
}

/** The path helpers of the environment's flavour: node:path locally, path.posix remotely. */
export interface PathPart {
  readonly sep: string;
  join(...parts: string[]): string;
  resolve(...parts: string[]): string;
  relative(from: string, to: string): string;
  dirname(path: string): string;
  basename(path: string, suffix?: string): string;
  isAbsolute(path: string): boolean;
}

/** The part of a file's stat the modules read. */
export interface FileStat {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  readonly size: number;
  readonly mtimeMs: number;
  readonly mode: number;
}

/** One entry of a folder listing, with its type. */
export interface DirEntryInfo {
  readonly name: string;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

/** An open file for reads by byte range. */
export interface FileHandleLike {
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}

/** The access modes the modules ask for: existence, or that a file can be run. */
export type AccessMode = 'exists' | 'execute';

export interface FilesPart {
  stat(path: string): Promise<FileStat>;
  lstat(path: string): Promise<FileStat>;
  realpath(path: string): Promise<string>;
  access(path: string, mode: AccessMode): Promise<void>;
  /** Reads a whole file. With `maxBytes`, a larger file is refused with the code of an over-size read. */
  readFile(path: string, options?: { maxBytes?: number }): Promise<Buffer>;
  /** Opens a file for reads by byte range. */
  open(path: string, flag: 'r'): Promise<FileHandleLike>;
  writeFile(path: string, data: Buffer | string, options?: { flag?: 'w' | 'wx' }): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readdir(path: string): Promise<DirEntryInfo[]>;
  rm(path: string, options?: { force?: boolean; recursive?: boolean }): Promise<void>;
  /** Removes an empty folder. A folder with entries is refused with ENOTEMPTY. */
  rmdir(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  /** The target a symbolic link holds. Needed by the protected-set restore (D31). */
  readlink(path: string): Promise<string>;
  /** Creates a symbolic link at `path` pointing at `target`. */
  symlink(target: string, path: string): Promise<void>;
}

/** The network limit (D31): `none` is the code writer's command, `normal` is everything else. */
export type NetworkPolicy = 'normal' | 'none';

/** The level a backend gave: `os` when the OS enforces the limit, `proxy-only` when it cannot. */
export type NetworkLevel = 'os' | 'proxy-only';

export interface SpawnOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** The timeout; on expiry the whole process tree is killed and the result says so. */
  timeoutMs: number;
  network: NetworkPolicy;
  signal?: AbortSignal;
  /** Windows only: pass the argument line as written (a cmd.exe line). */
  verbatimArguments?: boolean;
  /** Receives each chunk of stdout and stderr. Never called after the spawn has resolved. */
  onOutput?: (chunk: Buffer) => void;
}

/** How a started process ended. `started: false` means it could not be started. */
export type SpawnOutcome =
  | { started: false }
  | {
      started: true;
      code: number | null;
      signal: NodeJS.Signals | null;
      timedOut: boolean;
      aborted: boolean;
      /** Set when the network policy was `none`: the level the backend gave. */
      network?: NetworkLevel;
    };

export interface ProcessPart {
  readonly platform: NodeJS.Platform;
  /**
   * Starts a program with an argument array, never through a shell. Resolves when it has ended or
   * could not start. Never rejects.
   */
  spawn(file: string, argv: readonly string[], options: SpawnOptions): Promise<SpawnOutcome>;
  /** The level a `network: 'none'` spawn would get here, decided before anything starts. */
  networkLevel(): Promise<NetworkLevel>;
}

export interface WatchHandle {
  close(): void;
}

export interface WatchPart {
  /** Watches one folder, not recursively. Errors are reported through `onError`. */
  watchDir(
    path: string,
    onEvent: (eventType: string, filename: string | null) => void,
    onError: (error: Error) => void,
  ): WatchHandle;
}

export interface GitPart {
  currentBranch(root: string): Promise<GitResult<{ branch: string } | { detached: true }>>;
  defaultBranch(root: string): Promise<GitResult<string | null>>;
  changedPaths(root: string): Promise<GitResult<string[]>>;
  stage(root: string, paths: readonly string[]): Promise<GitStatus>;
  commit(root: string, message: string): Promise<GitStatus>;
  push(root: string, branch: string): Promise<GitStatus>;
  aheadOfUpstream(
    root: string,
  ): Promise<GitResult<{ upstream: false } | { upstream: true; ahead: number }>>;
  ignoredEntries(root: string, env?: NodeJS.ProcessEnv): Promise<Set<string> | null>;
}
