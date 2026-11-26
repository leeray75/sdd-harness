# Environments

An environment is where a project's files, programs, file watching and git live. Every part of the app that works inside a project reaches it through an environment object (D41). The local backend (D41), the WSL backend (D42) and the SSH backend (D43) are in this version. The dev container backend (phase 4, `p4-env-container`) plugs in behind the same interface.

The code is in `src/main/env/`:

- `types.ts`: the interface (`Environment`, `ToolEnvironment` and their parts). No Electron import.
- `local.ts`: the local backend.
- `wsl.ts`: the WSL backend, its transport, the Linux-to-share mapping and the app transport (`appWslTransport`). The only code, with `wsl-detect.ts`, that names `wsl.exe`.
- `wsl-detect.ts`: `detectWsl` and `isDistributionName`.
- `probes.ts`: the network probes of the local backend (`unshare`, `sandbox-exec`).
- `launcher.ts`: the fixed process launcher and its group-marker reader, shared by the WSL and SSH backends (D42, D43).
- `poll-watch.ts`: the polling watcher, shared by the WSL and SSH backends.
- `ssh.ts`: the SSH backend (`createSshEnvironment`). `ssh-transport.ts`: the transport seam, host key checks, credentials and the app transport over `ssh2`, the only code that imports `ssh2`. `ssh-command.ts`: the quoter and the exec strings (D43).
- `index.ts`: `environmentFor`, `localEnvironment` and `toolEnvironment`.

Only `src/main/env/`, `src/main/git/` and the two app-data stores (`src/main/projects/store.ts`, `src/main/secrets/store.ts`) import `node:fs`, `node:fs/promises` or `node:child_process` under `src/main/`. `tests/unit/env-boundary.test.ts` checks this on every run.

## The interface

`Environment` has six parts: the five below and `connection` (D43), which reports `state()` (`connected` or `unreachable`), `onChange` and `reconnect()`. Local is always connected, WSL and SSH follow their session, and `reconnect()` never runs on its own. Every method is async except the path helpers and the platform value.

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

- `environmentFor(descriptor, deps)` returns the backend for a project's descriptor: `local`, `wsl` (on Windows) and `ssh` (for a saved server's UUID, with the server store and the secret store in `deps.ssh`). Any other kind is refused with a fixed reason.
- The project registry (`src/main/projects/registry.ts`) makes each project's environment once, from its descriptor, and holds it next to the project's root. The lock watcher, the spec and ship handlers and the build runner take it from there. `environmentOf(projectId)` returns it, or `null` for an unknown or unreachable project.
- A project whose environment cannot be made is listed as unreachable, and removable. Its requests are refused as an unknown project (`no project with this id`), and `reconnect(id)` tries to make it again (D43, revision 1).
- A project whose environment was made but cannot be reached (its connect failed, or its connection dropped) is listed, removable and read-only. Its requests are refused with `PROJECT_UNREACHABLE`, it has no watcher, and `reconnect(id)` brings it back and starts the watcher (D43).
- `stateOf(id)` gives `connected` or `unreachable`, and `onStateChange` tells the listeners of each change (the project and its state, never a value from its settings).
- The app starts the agent host with the dev project's environment (`src/main/index.ts`).

## The WSL backend (D42)

A WSL project lives inside one distribution, at one Linux root. Its backend is `createWslEnvironment({ distribution, transport })` in `src/main/env/wsl.ts`, built by `environmentFor({ kind: 'wsl', distribution })` on Windows. The tests use a fake transport (`tests/support/fake-wsl-transport.ts`) over a temp folder, so no `wsl.exe` starts in `pnpm test`.

- **Transport.** `WslTransport` has a `shareRoot` (the folder that stands for the distribution's `/`) and `run(argv, options)`. `run` starts `wsl.exe` with an argument array and no shell, and resolves `{ started: false }` or the exit code, the signal, `timedOut`, `aborted` and, when asked to capture, stdout and stderr. It never rejects. `appWslTransport(distribution)` is the app's transport. It is the only code that starts `wsl.exe`, apart from detection.
- **Share.** The share root is `\\wsl.localhost\<distro>`, or `\\wsl$\<distro>` when the first is missing, found once when the transport is made. `files` calls `node:fs` on the mapped path. Each Linux path must be absolute POSIX. A segment containing `\` or `:` is refused with `ENOENT`, so a name cannot leave the share. `realpath` and `readlink` map the result back to a Linux path by four rules, in order: a native absolute result inside the share root maps to its Linux path; a `/`-prefixed result is a Linux path and is returned unchanged only when the share root is not POSIX-absolute (a UNC root, as in the app); a relative result is kept as written; anything else, a host path outside the share, is `ENOENT`. `readFile` with a cap stats the file before it reads. `symlink` runs `ln -s -- <target> <path>` and `chmod` runs `chmod <octal> -- <path>` through the transport. A failed `symlink` is `EEXIST` when the path exists, `ENOENT` when its folder does not, and `EIO` otherwise. A failed `chmod` is `ENOENT` when the path is missing, and `EIO` otherwise.
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

## The SSH backend (D43)

A project on an SSH server lives in one remote folder, reached through one saved server. `createSshEnvironment({ server, transport })` in `src/main/env/ssh.ts` is the backend. The tests use a fake transport over a temp folder (`tests/support/fake-ssh-transport.ts`), so no connection is made in `pnpm test`. The live walk (`tests/live/ssh-walk.live.test.ts`) runs on a real server.

- **Connection.** `SshTransport` (`ssh-transport.ts`) is the seam. `appSshTransport(server, deps)` is the app's transport over `ssh2`: one client per saved server, with keepalives (15 s, 3 misses) and a 20 s handshake limit. It never reconnects by itself. Its state goes to `unreachable` when the session closes, ends or fails, and the listeners are told once.
- **Host keys and credentials.** A pinned `SHA256:` fingerprint is checked on each connect. An unpinned server fails with `host-key-unknown` and the offered fingerprint, and a different key fails with `host-key-changed` and leaves the pin alone. Passwords and key passphrases come from the secret store, and a key from its file, all read at connect time. Nothing is stored outside the secret store and the saved servers file.
- **Files.** SFTP calls over the session. Each Node code is mapped from the SFTP status: `NO_SUCH_FILE` is `ENOENT`, `PERMISSION_DENIED` is `EACCES`, and the session errors are `ENOTCONN`. A generic `FAILURE` is resolved by looking at the path (`EEXIST`, `ENOTDIR`, `EISDIR`, `ENOTEMPTY`, or `EIO`). `readFile` with a cap refuses a larger file with `EFBIG` without reading past `maxBytes + 1`. `rename` over an existing file uses `posix-rename@openssh.com` when the server offers it, and otherwise removes the target first. Every path must be absolute POSIX; any other path is `ENOENT`.
- **Programs.** Each program is one exec request built by `ssh-command.ts`: `cd -- <cwd> && exec env -- <NAME=value…> sh -c <LAUNCHER> sh <file> <args…>`, with every value quoted as one POSIX word (`shellQuote`). Only the variables the caller set or changed cross, and `PATH` never does. The first output line is the group marker, which is never passed on. A timeout or an abort runs `kill -KILL -- '-<pgid>'` on a second request, then closes the channel, then resolves. The platform is the one `uname -s` gave at connect. The limit: when a stop comes before the marker has arrived (the group id is unknown), only the channel is closed, as the contract says, so a program that has started but not yet printed its marker may keep running on the server.
- **Network.** `network: 'none'` on Linux probes `unshare --user --map-root-user --net true` once per connection: the level is `os` when it works, and `proxy-only` otherwise. On macOS the level is `proxy-only`. The dead proxy variables and offline flags cross as variables, and `networkLevel()` agrees with a spawn.
- **Watching.** The shared polling watcher (`poll-watch.ts`), about every second, as on WSL.
- **Git.** `createGit` with the SSH launcher: the same argument lists, environment, timeouts, parsing and codes as the local instance. Exit 127 is `git-missing`, and a timeout stops the remote git through the group kill.
- **Connection part.** `state()` follows the transport. `reconnect()` is one connect, and a failure gives a fixed reason from `SSH_RECONNECT_REASONS` (none names the server, its user or a key).
- **Failures.** A lost or unreachable server is a result for each call (`ENOTCONN`, `{ started: false }`, `failed`, or `onError` for the watcher). Nothing falls back to the local folder.

## Checklist for the WSL, SSH and container backends

Status: the WSL and SSH backends meet every item below (`p4-env-wsl`, D42; `p4-env-ssh`, D43). The container backend is a later subtask.

Each backend is its own subtask, and each one runs the phase 3 headless walk (`tests/unit/headless-e2e.test.ts`) on its backend before it is done.

- Detection, if any, is in the backend's own module, and it is not run at import time.
- `path` is the backend's flavour (`path.posix` for WSL and SSH; the container's path for a dev container). Its `sep` is `/`.
- `files` answers every method, with the Node codes listed above, and `readFile`'s byte cap is enforced on the remote side.
- `process.spawn` runs through the backend's transport with an argument array, with no shell; the timeout kills the tree on the remote side; `network` reports a level, and `networkLevel()` agrees with it.
- `process.platform` is the platform of the backend's own system (Linux for WSL and most containers).
- `watch.watchDir` reports changes in one folder, and `close()` stops them. A remote watcher that cannot report changes says so with `onError`, and the lock watcher re-arms on its next refresh.
- `git` runs git on the backend through the same functions and the same argument lists as `src/main/git/git.ts`, and it returns the same codes. Credentials are never passed in an argument or a log line.
- A failing connection is a result for each call (`{ started: false }`, a code, or an error code), never a throw that escapes, and never a fallback to the local folder. The unreachable and read-only project state is `p4-env-ssh`'s job.
- The backend's tests run on temp folders or a fake transport, and the recording backend (`tests/support/recording-env.ts`) shows that each step reaches its result through the interface. Where a temp folder stands in for the remote root, build it from `realpathSync(tmpdir())` and not from `tmpdir()`: the map back to a remote path compares what `realpath` returned against the root as the test wrote it, and a root behind a symlink — macOS `/var/folders/…`, whose real path is `/private/var/folders/…` — no longer matches it, so the map fails with `ENOENT` or `the root is not a readable directory`.
- The boundary scan (`tests/unit/env-boundary.test.ts`) still passes, and the backend's own module is the only new place that touches its transport.
