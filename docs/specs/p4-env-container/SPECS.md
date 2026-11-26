---
status: approved
ticket:
---

# p4-env-container

## Problem

The app reaches projects on this computer, in WSL and on SSH servers (D41–D43), but not in a dev container. That is the fourth environment of F3 and of the add wizard's "where" step ("Runs inside Docker from the repo's devcontainer.json"). The environment interface and its checklist (`docs/environments.md`) are ready for this backend. How the app attaches to a dev container is still undecided (`docs/phases/phase-04-projects.md`, "Decide during planning").

## Goals

- **G1:** A container backend implements the whole `Environment` interface for one dev container and a POSIX root inside it, with the same contract as the other backends.
- **G2:** The container is found on each connect by its `devcontainer.local_folder` label, so a rebuilt container keeps the project. Programs run as the dev container's `remoteUser` (else `containerUser`, else the image's default user).
- **G3:** Docker is reached on the host PATH or, on Windows, through a WSL distribution, always with argument arrays and no shell on the host.
- **G4:** A missing or stopped container, or a stopped engine, makes the project unreachable and read-only through the existing connection part and registry (D43). `reconnect()` finds the container again and starts a stopped one.
- **G5:** The project store and the registry accept container projects, with the root checked through the environment.
- **G6:** The phase 3 headless walk runs on a container project: in the unit suite on a fake transport, and in an opt-in live test on a real container.
- **G7:** The attach method is recorded as D44, and the docs are current.

## Non-goals

- Building or creating containers from `devcontainer.json`, the devcontainer CLI, or `docker compose`.
- Plain containers without the `devcontainer.local_folder` label.
- Remote Docker hosts beyond what the docker CLI picks up from its own environment and context.
- Windows containers, or a container platform other than Linux.
- The projects screen, the Reconnect button, the read-only look, the add wizard and its call to `detectDocker` (`p4-projects-screen`, `p4-add-project-wizard`).
- IPC for containers, detection or Reconnect, and automatic reconnect.
- Any change to the local, WSL or SSH backends' behaviour.

## Design

### D44: how dev containers are attached

The app uses the docker CLI. Every call is a `docker exec`, with an argument array and through the shared setsid launcher. The user starts the container (with VS Code or the devcontainer CLI), and the app never builds one. The container is identified by the value of its `devcontainer.local_folder` label, which is looked up on each connect. Not taken:

- the devcontainer CLI (`@devcontainers/cli`, which is slower and still needs docker for kills);
- docker exec plus `devcontainer up`;
- a container name or id (which turns unreachable on each rebuild);
- the host folder behind the bind mount for files (which fails for volume workspaces);
- Docker on the host PATH only;
- the image's default user always.

### The descriptor (`src/main/projects/store.ts`)

`ProjectEnvironment` gains `{ kind: 'container'; folder: string; docker: DockerHost }`, where `DockerHost` is `{ kind: 'host' } | { kind: 'wsl'; distribution: string }`.

- **Keys:** exactly these, and `docker` exactly its keys. The distribution must pass `isDistributionName`.
- **`folder`:** 1 to 1024 characters, with no control character (U+0000–U+001F, U+007F), no `"` or `'`, and no leading `-`. It is stored and matched verbatim.
- **Root:** an absolute, normalized POSIX path, checked as an existing folder through the environment when the project is added. When the container cannot be reached, the add is refused with the store's existing unreachable reason.
- **Duplicates:** two container projects are the same folder when they have the same Docker host (kind and distribution), the same `folder` and the same root, compared exactly.
- **Loading:** reads the descriptor and starts no process.

### The container transport (`src/main/env/container-transport.ts`)

This module is the only code that starts the docker program (the detection module also names it).

- **`ContainerTransport`:**
  - `run(argv, options)` runs the docker command with the given docker arguments. The options are `stdin` (bytes, optional), `capture`, `timeoutMs`, `signal`, `env` (extra variables for the docker process) and `onOutput`.
  - It resolves `{ started: false }` or `{ started: true, code, signal, timedOut, aborted, stdout?, stderr? }`, and never rejects.
  - `appContainerTransport(host)` is the app's transport.
- **Docker command:** `{ kind: 'host' }` runs `docker <args…>`. `{ kind: 'wsl', distribution }` runs `wsl.exe -d <distro> --exec docker <args…>`, and the names of the variables in `env` cross through `WSLENV` with no path flags. Neither form uses a shell.
- **Lookup (`findContainer`):**
  - `docker ps -a --no-trunc --filter label=devcontainer.local_folder=<folder> --format '{{json .}}'` lists the candidates.
  - A running container is preferred, then the newest by creation time.
  - `docker inspect --format '{{json .Config.Labels}}' <id>` reads the `devcontainer.metadata` label: a JSON array of objects, where the last `remoteUser`, else the last `containerUser`, is the user.
  - A user that fails the POSIX user-name pattern (`^[a-z_][a-z0-9_-]{0,31}$`, as in D43) is ignored, and the image's default user is used.
  - The outcome is `{ ok: true, id, running, user | null }`, or `{ ok: false, cause }` with `cause` one of `engine-down`, `not-found` or `docker-missing`.
- **Exec form:** `exec [-i] [-u <user>] -w <cwd> [-e <NAME> …] <id> sh -c <LAUNCHER> sh <file> <args…>`.
  - `-i` only when stdin bytes are given.
  - Each crossing variable is passed as `-e NAME` with no `=value`. The value is set in the docker process's own environment (and through `WSLENV` on the WSL host), so no value appears in an argument array.
  - `LAUNCHER` and the marker reader are the shared ones (`src/main/env/launcher.ts`), unchanged.
- **Container gone (revised in revision 1):** only docker's own messages mean the container is gone. Those are stderr lines that start with one of these:
  - `Error response from daemon: ` and contain `No such container` or `is not running`;
  - `Error: No such container`;
  - `Cannot connect to the Docker daemon`.

  When the backend sees one, it moves to `unreachable`. These lines are not read from just anywhere:
  - For a launched program (`spawn` and git), only the stderr that arrives before the launcher's marker line is checked, because from the marker on, stderr is the program's own.
  - For the files scripts and the connect checks, whose own stderr is a fixed code word or nothing, the whole stderr is checked.

  Text that merely contains one of these phrases elsewhere (for example a program that prints "is not running") never changes the state.

### The container backend (`src/main/env/container.ts`)

`createContainerEnvironment({ descriptor, transport, pollMs? })` returns a backend. Making it starts nothing, and its state is `unreachable` until the first successful `reconnect()`.

- **`path`:** `path.posix`, with `sep` `/`.
- **`files`:** each method is one exec of a fixed script, `sh -c '<script>' sh <path> [<arg>]`. Paths and arguments are positional, never in the script text. The scripts are constants in the module and use only commands that exist in both GNU coreutils and BusyBox:
  - `stat` and `lstat` use `stat [-L] -c '%f %s %Y %X %W %u %g %h %i'`, which yields the type and mode (hex), the size and the times.
  - `access` uses `test -e` and `test -x`.
  - `realpath` and `readlink`.
  - `readFile` uses `cat`, or, with a cap, `head -c <maxBytes+1>`, which refuses a larger file with `EFBIG` and never reads past `maxBytes + 1`.
  - `open` returns a handle whose reads use `tail -c +<offset+1> | head -c <length>`.
  - `writeFile` uses `cat > "$1"` with the bytes on stdin.
  - `mkdir [-p]`, `rm [-r] [-f]`, `rmdir` and `mv -f`.
  - `chmod <octal>`.
  - `ln -s -- <target> <path>`.
  - `readdir` with types: `ls -1A` plus a type per entry, in a fixed script whose output is one `<type> <name>` per line, NUL-free.
  - **Codes:** each script prints a fixed code word on stderr for the cases it tests itself (`ENOENT`, `ENOTDIR`, `EISDIR`, `EEXIST`, `ENOTEMPTY`, `EACCES`). The backend maps the word to the Node code. Any other failure is `EIO`.
  - **Bad paths:** a relative or non-normalized path is `ENOENT` and starts no process.
  - **Lost container:** while the backend is `unreachable`, every method is `ENOTCONN` and starts no process.
- **`process`:**
  - `platform` is `linux`, read at connect from `uname -s`. Another system is refused at connect.
  - `spawn` uses the exec form above.
  - Only the variables the caller set or changed relative to the app's own environment cross, and `PATH` never does.
  - The marker line is hidden.
  - On timeout or abort, a second exec runs `kill -s KILL -- -<pgid>` (revised in revision 1: the POSIX form, because dash, the `/bin/sh` of Debian and Ubuntu images, refuses `kill -KILL -- -<pgid>` with `Illegal number: -`), then the docker process is stopped, then the result resolves. A stop that comes before the marker stops only the docker process (the same limit as SSH, documented).
  - `{ started: false }` when the backend is unreachable or docker cannot start.
- **Network:** `network: 'none'` probes `unshare --user --map-root-user --net true` inside the container once per connection. When it works, the level is `os` with the Linux wrapper (`src/main/commands/network.ts`). Otherwise it is `proxy-only`, with the dead proxy variables and offline flags crossing as variables. `networkLevel()` agrees.
- **`watch`:** the shared polling watcher (`src/main/env/poll-watch.ts`).
- **`git`:** `createGit(containerLauncher)` from `src/main/git/git.ts`, with the same argument lists, environment, timeouts, parsing and codes. Git runs through the group launcher, so a timeout kills it inside the container. Exit 127 is `git-missing`.
- **`connection`:**
  - **Connect checks:** a successful `reconnect()` runs `findContainer`, then `docker start <id>` when the container is stopped. It then checks, in one exec, `uname -s` and `command -v setsid`, as the chosen user.
  - **Failures:** each one gives a fixed reason from `CONTAINER_RECONNECT_REASONS`:
    - docker missing;
    - engine down;
    - no container with the label;
    - the container would not start;
    - not Linux;
    - no `setsid`.
    No reason names the folder, the container, the image or the user.
  - **State:** `onChange` tells the listeners once per change. A gone-container result from any call moves the backend to `unreachable`. Nothing reconnects by itself.

### Detection (`src/main/env/container-detect.ts`)

`detectDocker(host, deps?)` runs `docker version --format '{{json .}}'` and the label listing, with a timeout. It returns `{ cli: false }`, or `{ cli: true, engine: false }`, or `{ cli: true, engine: true, containers: [{ folder, configFile, name, running }] }`. Containers whose folder fails the pattern are left out. It never throws, and it is not called at import time or at app start.

### environmentFor (`src/main/env/index.ts`)

- **Valid descriptor:** `{ kind: 'container', folder, docker }` builds the backend with `appContainerTransport(docker)`, or with `deps.containerTransportFor` in tests.
- **Refusals:**
  - a malformed descriptor is refused with `UNSUPPORTED_ENVIRONMENT`;
  - the WSL Docker host off Windows is refused with `WSL_UNAVAILABLE`.
- Making the backend starts nothing.

### Registry

No logic change is expected. The container kind uses the existing connect-on-start, `PROJECT_UNREACHABLE`, `stateOf`, `onStateChange` and `reconnect(id)` (D43). Tests show it for a container project.

### Tests

- **The fake transport** (`tests/support/fake-container-transport.ts`) never starts docker.
  - It holds labelled containers (id, folder, metadata, running) over temp folders, each standing for a container's `/`.
  - It answers the lookup, inspect and start shapes, and recognises each fixed files script by its exact text. It performs that script's operation with `node:fs` on the mapped path and returns the script's code word.
  - It runs launched programs locally in the mapped folder, as the SSH fake does, with the group marker and the kill.
  - It records every argument array and the docker process's variables, and can be told that the engine is down or a container stopped.
- **Real-shell script test:** a test runs every fixed files script through a real POSIX `sh` on a temp folder where one exists. On Linux CI it always runs, and elsewhere it is skipped when no `sh` is found. It shows that the scripts and their code words match the fake.

## Acceptance criteria

- **AC1 descriptor:** `project-store.test.ts` shows a container project added with its root checked through the environment, and refused for:
  - each bad key set, folder (control character, quote, leading `-`, empty, over 1024) and distribution;
  - a relative or non-normalized root;
  - a missing root folder;
  - an unreachable container;
  - a duplicate.

  Loading starts no process. The existing store tests pass unchanged.
- **AC2 lookup and user:** with the fake transport:
  - a running container is chosen over a stopped one, and the newest among equals;
  - `remoteUser` wins over `containerUser`, and the last entry of each wins;
  - an invalid user falls back to no `-u`;
  - the engine down, docker missing and no container with the label give their causes.
- **AC3 docker command:** the host form starts `docker` with the docker arguments, and the WSL form starts `wsl.exe -d <distro> --exec docker` with the same arguments, both with no shell. On every spawn and files call, no crossing variable's value appears in any argument array, and on the WSL form the crossing names are in `WSLENV`.
- **AC4 path and files:**
  - `path.posix`.
  - Every files method over the fake gives the Node codes of the contract: `ENOENT`, `ENOTDIR`, `EISDIR`, `EEXIST`, `ENOTEMPTY`, `EACCES`, and `EIO` for an unknown failure.
  - `readFile` with a cap gives `EFBIG` without reading past `maxBytes + 1`.
  - `open` reads byte ranges.
  - `writeFile` sends the bytes on stdin.
  - A relative path is `ENOENT` and starts no process.
  - The real-shell test passes on Linux (CI's `check` job), and is skipped where no POSIX `sh` exists.
- **AC5 process:**
  - The spawn argument array is exactly the exec form above, with `-u` from the lookup.
  - Only changed variables cross, never `PATH`.
  - The marker is hidden.
  - Timeout and abort run the group kill before resolving, and the kill exec runs `kill -s KILL -- -<pgid>` (revision 1).
  - `{ started: false }` when unreachable.
  - The platform comes from the connect check.
  - The network level comes from a once-per-connection probe, and `networkLevel()` agrees.
- **AC6 watch and git:**
  - The shared polling watcher gives the same events as for SSH.
  - The git part sends the same argument lists as the local one, through the launcher, and returns the same values and codes.
  - Exit 127 is `git-missing`, and a timeout runs the group kill.
  - `git.test.ts` and `git-boundary.test.ts` pass unchanged.
- **AC7 connection:**
  - A new backend is `unreachable` and starts nothing.
  - `reconnect()` connects a running container, starts a stopped one with `docker start`, and refuses with the fixed reason for each failure: docker missing, engine down, no container, start failed, not Linux, no `setsid`.
  - A gone-container result from any call moves it to `unreachable` and tells the listeners once.
  - Revision 1:
    - a program whose own stderr, after the marker, prints `is not running`, `No such container` or `Cannot connect to the Docker daemon` leaves the backend `connected`;
    - docker's own message before the marker, or in a files or connect call, moves it to `unreachable`.
  - While unreachable, every files method is `ENOTCONN`, `spawn` is `{ started: false }`, git is `failed`, `watchDir` calls `onError`, nothing throws, and no call reaches a local path.
  - No reason holds the folder, a container id, the image or the user.
- **AC8 environmentFor:**
  - It builds the backend for a valid descriptor without starting a process.
  - It refuses a malformed descriptor with `UNSUPPORTED_ENVIRONMENT`, and the WSL Docker host off Windows with `WSL_UNAVAILABLE`.
  - Local, WSL and SSH are unchanged.
- **AC9 registry:** a container project whose container is stopped is listed as `unreachable` and removable at start, and its requests are refused with `PROJECT_UNREACHABLE`. `reconnect(id)` starts it and brings the watcher back. The existing registry tests pass unchanged.
- **AC10 detection:** `detectDocker` parses the version and the label listing, reports the CLI missing, the engine down and the dev containers, leaves out a bad folder, and never throws. Nothing calls it at import time or at start.
- **AC11 walk and recording backend:**
  - The headless walk passes on a container project over the fake transport in `pnpm test`.
  - Over the container backend, the recording backend shows that a tool, `run_command`, the lock and `approveResult` reach their results through the interface.
- **AC12 boundary:**
  - The existing scans pass.
  - Only `src/main/env/container-transport.ts` and `src/main/env/container-detect.ts` name the `docker` program.
  - No new module under `src/main/` imports `node:fs`, `node:fs/promises` or `node:child_process` other than the transport and detection modules inside `src/main/env/`.
- **AC13 live walk:**
  - `tests/live/container-walk.live.test.ts` runs the shared walk in a real labelled container named by `HARNESS_CONTAINER_FOLDER` and `HARNESS_CONTAINER_ROOT`, with optional `HARNESS_CONTAINER_WSL_DISTRO`.
  - It passes on this machine against Docker in WSL Ubuntu, or the summary says it was not run and why.
  - It is skipped without its variables, and never runs in CI.
- **AC14 docs:**
  - `CHANGELOG.md` (Unreleased).
  - D44 in `docs/decisions.md`, with a note under D41.
  - `docs/environments.md`: the container section, the descriptor, and the checklist status for all backends.
  - `docs/agent-commands.md`: the network level inside a container.
  - `docs/workflow-engine.md`: the container descriptor where the Projects section lists kinds.
  - `CLAUDE.md`: the read list names D44; `test:live` names the container walk and its variables.
  - `README.md` and `docs/PRD.md`: F3 progress.
  - `docs/phases/phase-04-projects.md`: the decided item.
  - `docs/phases/phase-04-progress.md`: row 5 and the follow-ups.
- **AC15 checks:** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` and `pnpm e2e` pass, and no existing assertion changes (`git diff main -- tests/`).

## Open questions

- 2026-11-26, revision 1, the group kill: `kill -s KILL -- -<pgid>`, the POSIX form. It was verified in dash on a live group in the throwaway container. Not taken:
  - `kill -KILL -<pgid>`, which was not verified on a live group;
  - running the literal form through bash, which fails on slim images.
- 2026-11-26, revision 1, the gone-container check: match only docker's own messages, by line prefix. For a launched program, only the stderr before the marker is checked. Not taken:
  - phrases plus docker's exit code and no marker;
  - the literal substring patterns, which a program's own output could match.
