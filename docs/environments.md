# Environments

An environment is where a project's files, programs, file watching and git live. Every part of the app that works inside a project reaches it through an environment object (D41). The local backend (D41) and the WSL backend (D42) are in this version. The SSH and dev container backends (phase 4, `p4-env-ssh`, `p4-env-container`) plug in behind the same interface.

The code is in `src/main/env/`:

- `types.ts`: the interface (`Environment`, `ToolEnvironment` and their parts). No Electron import.
- `local.ts`: the local backend.
- `wsl.ts`: the WSL backend, its transport, the Linux-to-share mapping and the app transport (`appWslTransport`). The only code, with `wsl-detect.ts`, that names `wsl.exe`.
- `wsl-detect.ts`: `detectWsl` and `isDistributionName`.
- `probes.ts`: the network probes of the local backend (`unshare`, `sandbox-exec`).
- `index.ts`: `environmentFor`, `localEnvironment` and `toolEnvironment`.

Only `src/main/env/`, `src/main/git/` and the two app-data stores (`src/main/projects/store.ts`, `src/main/secrets/store.ts`) import `node:fs`, `node:fs/promises` or `node:child_process` under `src/main/`. `tests/unit/env-boundary.test.ts` checks this on every run.

## The interface

`Environment` has five parts. Every method is async except the path helpers and the platform value.

| Part      | What it covers                                                                                                                                                                                                                                                                                                                                                                                           |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `path`    | `join`, `resolve`, `relative`, `dirname`, `basename`, `isAbsolute` and `sep`, in the environment's own flavour: `node:path` locally, `path.posix` on a remote backend.                                                                                                                                                                                                                                   |
| `files`   | `stat`, `lstat`, `realpath`, `access` (`exists` or `execute`), `readFile` (with an optional byte cap), `open` (for reads by byte range), `writeFile`, `mkdir`, `readdir` (with file types), `rm`, `rmdir`, `rename`, `chmod`, `readlink` and `symlink`. Failures carry Node-style `code`s.                                                                                                               |
| `process` | `platform`, `spawn(file, argv, options)` and `networkLevel()`. `spawn` takes an argument array and never a shell, streams output to `onOutput`, kills the whole process tree on timeout or abort, and resolves with the exit code, the signal, `timedOut`, `aborted` and, for `network: 'none'`, the level it got. It resolves `{ started: false }` when the program cannot start, and it never rejects. |
| `watch`   | `watchDir(path, onEvent, onError)`: one folder, not recursive, returning a handle with `close()`.                                                                                                                                                                                                                                                                                                        |
| `git`     | `currentBranch`, `defaultBranch`, `changedPaths`, `stage`, `commit`, `push`, `aheadOfUpstream` and `ignoredEntries`. Each takes the project root and returns the same `GitResult`/`GitStatus` values and the same four failure codes (`git-missing`, `timeout`, `not-a-repo`, `failed`) as `src/main/git/git.ts`.                                                                                        |

`ToolEnvironment` is `{ path, files, process, ignoredEntries }`. It has no `git` and no `watch`. The tools, the command runner and the agent host take only this type, so a tool cannot reach git (D4). `toolEnvironment(env)` builds it, and its `ignoredEntries` calls the git part.

`process.networkLevel()` is an addition to the interface: the command runner asks it before the spec folder is locked, so the network rule event is emitted at the same point as before.

## The backend contract

A backend must keep these rules, which the local backend and the test suite rely on:

- **Error codes.** The `files` part passes the Node codes of the operation through unchanged (`ENOENT`, `ENOTDIR`, `EISDIR`, `EACCES`, `EPERM`, `EBUSY`, `ELOOP`, `EEXIST`, `ENOTEMPTY`). A remote backend maps its own errors to these codes. `readFile` with a `maxBytes` cap refuses a larger file with `EFBIG`.
- **No shell.** `spawn` starts the program with its argument array. A backend must not join the arguments into a command line for a shell. The one exception is the Windows `.cmd` path, which the command runner builds and checks itself (D31) and starts with `verbatimArguments`.
- **Timeout and tree kill.** On timeout or abort, the backend kills the whole process tree before it resolves, and reports `timedOut` or `aborted`. Output that arrives after the result is not passed on.
- **Network.** `network: 'none'` applies the writer's limit as far as the OS allows, and reports the level it got: `os` when the OS enforces it, `proxy-only` when only the proxy variables and offline flags are set. `networkLevel()` must give the same answer before a spawn. A backend that cannot enforce anything reports `proxy-only`, and says so.
- **Path flavour.** Modules join and split project paths only through `path`. A backend sets `path` to the flavour of its own files, so a path from a remote project is never built with `node:path`.
- **Git.** The git part of a backend lives in `src/main/git/`, or calls it. Only that folder runs git, and no tool, command or agent file names a git member of an environment (D38, D41). The results and the failure codes are the same on every backend.
- **Watching.** `watchDir` reports each change in one folder and nothing from below it. `close()` stops the events, so none arrives after it.
- **No fallback.** A backend never falls back to the local one. A failure is a result, not a reason to run locally.

## How a backend is chosen and held

- `environmentFor(descriptor)` returns the backend for a project's descriptor (`{ kind: 'local' }` today). Any other kind is refused with a fixed reason, and the registry refuses that project.
- The project registry (`src/main/projects/registry.ts`) makes each project's environment once, from its descriptor, and holds it next to the project's root. The lock watcher, the spec and ship handlers and the build runner take it from there. `environmentOf(projectId)` returns it, or `null` for an unknown project.
- A project whose environment cannot be made gets no watcher and no handlers. Its requests are refused the same way as an unknown project (`no project with this id`), and adding it is refused before anything is stored.
- The app starts the agent host with the dev project's environment (`src/main/index.ts`).

## The WSL backend (D42)

A WSL project lives inside one distribution, at one Linux root. Its backend is `createWslEnvironment({ distribution, transport })` in `src/main/env/wsl.ts`, built by `environmentFor({ kind: 'wsl', distribution })` on Windows. The tests use a fake transport (`tests/support/fake-wsl-transport.ts`) over a temp folder, so no `wsl.exe` starts in `pnpm test`.

- **Transport.** `WslTransport` has a `shareRoot` (the folder that stands for the distribution's `/`) and `run(argv, options)`. `run` starts `wsl.exe` with an argument array and no shell, and resolves `{ started: false }` or the exit code, the signal, `timedOut`, `aborted` and, when asked to capture, stdout and stderr. It never rejects. `appWslTransport(distribution)` is the app's transport. It is the only code that starts `wsl.exe`, apart from detection.
- **Share.** The share root is `\\wsl.localhost\<distro>`, or `\\wsl$\<distro>` when the first is missing, found once when the transport is made. `files` calls `node:fs` on the mapped path. Each Linux path must be absolute POSIX. A segment containing `\` or `:` is refused with `ENOENT`, so a name cannot leave the share. `realpath` and `readlink` map the result back to a Linux path, and a result outside the share is `ENOENT`. `readFile` with a cap stats the file before it reads. `symlink` runs `ln -s -- <target> <path>` and `chmod` runs `chmod <octal> -- <path>` through the transport. A failed `symlink` is `EEXIST` when the path exists, `ENOENT` when its folder does not, and `EIO` otherwise. A failed `chmod` is `ENOENT` when the path is missing, and `EIO` otherwise.
- **Path flavour.** `path` is `path.posix`, with `sep` `/`.
- **Launcher.** A program runs as `wsl.exe -d <distro> --cd <cwd> --exec sh -c <launcher> sh <file> <args…>`. The launcher is a constant, `setsid --wait sh -c 'printf "%s%s\n" "$0" "$$"; exec "$@"' SDD-GROUP- "$@"`. It prints one marker line with the process group id, then replaces itself with the program, so every argument reaches the program unchanged and no shell parses it. The marker line is removed from the output. On timeout or abort, the backend runs `kill -KILL -- -<pgid>` through the transport before the result resolves, then stops `wsl.exe`. Output that arrives after the stop is not passed on. When the group id never arrived, only `wsl.exe` is stopped.
- **WSLENV.** Only the variables the caller set or changed relative to the app's own environment cross, named in `WSLENV` with no path flags. `PATH` never crosses, and no value appears in an argument array.
- **Network.** `network: 'none'` probes `unshare --user --map-root-user --net true` inside the distribution, once per backend. When it works the level is `os`, and the program is wrapped with the same `unshare` wrapper as Linux (`src/main/commands/network.ts`). When it does not, the level is `proxy-only`. The dead proxy variables and the offline flags cross through `WSLENV`. `networkLevel()` gives the same answer.
- **Watching.** `watchDir` polls one folder about every second through `files`, and reports added and removed names as `rename` and changed size or mtime as `change`. Subfolders are compared by name only, so a change inside them is not reported. A failing listing calls `onError` once per run of failures, with no events, and the polling goes on. `close()` stops it.
- **Git.** The git part is `createGit(wslLauncher)` from `src/main/git/git.ts`, with the same argument lists, environment, timeouts, parsing and codes as the local instance. The WSL launcher runs `wsl.exe -d <distro> --cd <root> --exec git <args…>`. Git missing in the distribution is `git-missing`. wsl.exe reports it as `execvpe(git) failed: No such file or directory` on stderr with exit code 1 (checked live against Ubuntu, with a program that does not exist, since git is installed there). A timeout is `timeout`, and any other failure is `failed` or `not-a-repo`. A timed-out git call stops `wsl.exe`, but the Linux git process may keep running, because git is not started through the group launcher.
- **Detection.** `detectWsl()` in `src/main/env/wsl-detect.ts` runs `wsl.exe --list --verbose` with an argument array and a timeout, decodes its UTF-16LE output, and reads the `*` as the default distribution. It returns `{ installed: false }` off Windows, when `wsl.exe` is missing, or when the call fails or times out, and it never throws. A name that fails `isDistributionName` is left out. Nothing calls it at import time or at app start; the add wizard (`p4-add-project-wizard`) will.
- **Failures.** A missing distribution or a stopped transport gives a result for each call: a Node code, `{ started: false }` or a git code. Nothing falls back to the local backend.
- **Rename over an existing file.** On the share, a rename over an existing file can fail with `EPERM` now and then (22 of 300 in a probe), and locally it failed under parallel test load. The shared atomic writer retries the rename, and the spec lock's `writeAtomic` uses it (see below). The WSL files part's own `rename` makes one attempt and passes the Node code through.

### The atomic write and the rename retry (revision 1)

`writeFileAtomic(files, path, bytes)` in `src/main/tools/atomic-write.ts` is the one atomic writer (D41). It writes a temporary file in the same folder, renames it over the target, and retries a failed rename `RENAME_ATTEMPTS` times, waiting `RENAME_RETRY_MS` times the attempt between them. A failed attempt removes the temporary file. The tools and the project store keep its fixed reasons. The spec lock's `writeAtomic` (`src/main/workflow/spec-lock.ts`) calls it with `codeReason`, so its reason is the Node code of the last error, a failed first write included. Its signature and result are unchanged. The writes of the build loop, the spec handlers and the ship step go through it, so the retry covers both the share and the local parallel runs.

## Checklist for the WSL, SSH and container backends

Status: the WSL backend meets every item below (`p4-env-wsl`, D42). The SSH and container backends are later subtasks.

Each backend is its own subtask, and each one runs the phase 3 headless walk (`tests/unit/headless-e2e.test.ts`) on its backend before it is done.

- Detection, if any, is in the backend's own module, and it is not run at import time.
- `path` is the backend's flavour (`path.posix` for WSL and SSH; the container's path for a dev container). Its `sep` is `/`.
- `files` answers every method, with the Node codes listed above, and `readFile`'s byte cap is enforced on the remote side.
- `process.spawn` runs through the backend's transport with an argument array, with no shell; the timeout kills the tree on the remote side; `network` reports a level, and `networkLevel()` agrees with it.
- `process.platform` is the platform of the backend's own system (Linux for WSL and most containers).
- `watch.watchDir` reports changes in one folder, and `close()` stops them. A remote watcher that cannot report changes says so with `onError`, and the lock watcher re-arms on its next refresh.
- `git` runs git on the backend through the same functions and the same argument lists as `src/main/git/git.ts`, and it returns the same codes. Credentials are never passed in an argument or a log line.
- A failing connection is a result for each call (`{ started: false }`, a code, or an error code), never a throw that escapes, and never a fallback to the local folder. The unreachable and read-only project state is `p4-env-ssh`'s job.
- The backend's tests run on temp folders or a fake transport, and the recording backend (`tests/support/recording-env.ts`) shows that each step reaches its result through the interface.
- The boundary scan (`tests/unit/env-boundary.test.ts`) still passes, and the backend's own module is the only new place that touches its transport.
