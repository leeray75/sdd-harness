# Environments

An environment is where a project's files, programs, file watching and git live. Every part of the app that works inside a project reaches it through an environment object (D41). The local backend is the only one in this version. The WSL, SSH and dev container backends (phase 4, `p4-env-wsl`, `p4-env-ssh`, `p4-env-container`) plug in behind the same interface.

The code is in `src/main/env/`:

- `types.ts`: the interface (`Environment`, `ToolEnvironment` and their parts). No Electron import.
- `local.ts`: the local backend.
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

## Checklist for the WSL, SSH and container backends

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
