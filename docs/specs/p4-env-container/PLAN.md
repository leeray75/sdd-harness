# Plan: p4-env-container

Ticket: none (vibe planning, Phase 4 subtask 5)
Status: approved
Date: 2026-11-26

## Objective

A project can live inside a dev container. A container backend implements the environment interface (D41) for one dev container and a root folder inside it. Programs, files and git all go through `docker exec`, and a polling watch covers the spec folder. The container is found each time by the dev container label that records the repo folder, so the project survives a rebuild. A stopped container or a stopped Docker engine makes the project unreachable and read-only (D43), and Reconnect brings it back. The phase 3 headless walk runs on a project in a container. How the app attaches to a dev container is recorded as D44.

## Scope

- **In:**
  - **Docker host:** where the `docker` command is reached. Either `{ kind: 'host' }`, which is `docker` on the host PATH (Docker Desktop, Linux, macOS), or, on Windows only, `{ kind: 'wsl', distribution }`, which is `wsl.exe -d <distro> --exec docker`. One argument prefix per host, and no shell either way.
  - **Descriptor:** `ProjectEnvironment` gains `{ kind: 'container', folder: string, docker: { kind: 'host' } | { kind: 'wsl', distribution } }`.
    - `folder` is the value of the container's `devcontainer.local_folder` label, kept exactly as the dev container tools wrote it. It is checked by a fixed pattern: 1 to 1024 characters, no control characters, no quotes, no leading `-`.
    - The root is an absolute, normalized POSIX path inside the container, checked as an existing folder through the environment at add time.
    - Duplicates compare the kind, the Docker host, the folder and the root exactly.
    - Loading starts nothing.
  - **The container transport** (`src/main/env/container-transport.ts`, the only code that starts `docker`):
    - `run(argv, options)` starts the docker command with an argument array, with optional stdin bytes, capture, timeout and abort. It resolves `{ started: false }` or the exit code, the signal, `timedOut`, `aborted` and the captured output. It never rejects.
    - **Lookup:** `docker ps -a --filter label=devcontainer.local_folder=<folder> --format …`. When several containers carry the label, a running one is preferred, then the newest. The lookup also reads the `devcontainer.metadata` label and inspects the container's state.
    - **Exec user:** `remoteUser` from `devcontainer.metadata`, else `containerUser`, else none (the image's default user). It is passed as `docker exec -u <user>` and checked by a POSIX user-name pattern.
    - **Exec form:** every program is `docker exec [-i] [-u <user>] -w <cwd> [-e NAME …] <id> sh -c <LAUNCHER> sh <file> <args…>`, with the shared launcher (`src/main/env/launcher.ts`). Values cross as `-e NAME` with the value in the docker process's environment, never in an argument. On the WSL host they cross through `WSLENV`.
    - The transport is injectable. Unit tests use a fake transport (`tests/support/fake-container-transport.ts`) that runs the commands over a temp folder, so no docker starts in `pnpm test`.
  - **The container backend** (`src/main/env/container.ts`, made by `createContainerEnvironment({ descriptor, transport })`):
    - `path` is `path.posix`, with `sep` `/`.
    - **`files`:** each method is one `docker exec` of a fixed POSIX command with the path as a positional argument (`sh -c '<fixed script>' sh <path>`): `stat -c`, `cat` or `head -c` for reads, `cat >` from stdin for writes, and `mkdir`, `rm`, `rmdir`, `mv`, `chmod`, `ln -s`, `readlink`, `realpath`, and a listing with types. The commands must work with GNU coreutils and with BusyBox.
      - Exit status and stderr map to the Node codes of the contract. Anything else is `EIO`.
      - `readFile` with a cap refuses a larger file with `EFBIG`, and never reads past `maxBytes + 1`.
      - `open` reads by byte range (`tail -c +N | head -c M`).
      - Every path must be absolute POSIX; any other path is `ENOENT`.
      - A lost container or engine gives `ENOTCONN`.
    - **`process`:**
      - `platform` is read at connect from `uname -s`; only Linux is accepted.
      - `spawn` uses the launcher above. On timeout or abort, a second exec runs `kill -KILL -- -<pgid>`, the docker process is stopped, and then the result resolves. As on SSH, a stop that comes before the marker stops only the docker process.
      - Only the variables the caller set or changed cross, and `PATH` never does.
      - At connect, `setsid` is checked inside the container (`command -v setsid`). A container without it is refused with a fixed reason.
    - **Network:** `network: 'none'` probes `unshare --user --map-root-user --net true` once per connection. When it works the level is `os`, with the Linux wrapper; otherwise it is `proxy-only`, as in most containers. `networkLevel()` agrees with a spawn.
    - **`watch`:** the shared polling watcher (`src/main/env/poll-watch.ts`), about every second.
    - **`git`:** `createGit(containerLauncher)` from `src/main/git/git.ts`, with git run through the group launcher, so a timeout kills it inside the container. Exit 127 maps to `git-missing`.
    - **`connection`:**
      - `state()` is `connected` after a successful connect, and `unreachable` when the lookup finds no container, the container is not running, the engine is down, or an exec reports that the container is gone or stopped.
      - `reconnect()` looks the container up again, runs `docker start` on a stopped one, and runs the connect checks (`uname`, `setsid`, user).
      - A failure gives a fixed reason from `CONTAINER_RECONNECT_REASONS`; no reason names the folder, the container or the user. Nothing reconnects by itself.
  - **Detection:** `detectDocker(host)` in `src/main/env/container-detect.ts`. It reports whether the docker CLI is found, whether the engine answers (`docker version`), and the dev containers that carry the label (folder, config file, name, state). It uses an argument array and a timeout, and never throws. It is not run at import time or at app start; the add wizard (`p4-add-project-wizard`) will call it.
  - **`environmentFor`** builds the backend for a valid container descriptor. The WSL Docker host is accepted only on Windows (`WSL_UNAVAILABLE` elsewhere), and a malformed descriptor is refused with `UNSUPPORTED_ENVIRONMENT`. Making the backend starts nothing.
  - **Store and registry** accept the descriptor. The registry's existing unreachable, read-only and `reconnect(id)` behaviour (D43) applies unchanged.
  - **Tests:**
    - **Unit tests on every OS, with the fake transport:**
      - descriptor validation;
      - lookup: preferring a running container, then the newest;
      - user selection from the metadata label;
      - the exec argument arrays for both Docker hosts;
      - every files method and its codes, and the cap;
      - the variables (never in an argument), the group kill on timeout and abort, and the network level;
      - watching and the git codes;
      - the lost container on every part;
      - reconnect, including `docker start`;
      - `environmentFor`, and the store and registry container cases;
      - detection parsing.
    - **The headless walk** (`tests/unit/headless-e2e.test.ts` or its own case) on the fake container transport, and the recording backend over the container backend: a tool, `run_command`, the lock and `approveResult` reach their results through the interface.
    - **Boundary scans:** they still pass, with a new check that only the container transport and detection modules name the `docker` program.
    - **Opt-in live walk** (`tests/live/container-walk.live.test.ts`, in `pnpm test:live`):
      - It runs the headless walk in a real container named by `HARNESS_CONTAINER_FOLDER` (the label value) and `HARNESS_CONTAINER_ROOT` (a parent folder inside the container), with optional `HARNESS_CONTAINER_WSL_DISTRO` (Docker through WSL).
      - It is skipped without them, and never runs in CI.
      - It is run here against Docker in WSL Ubuntu, with a throwaway container that carries the labels and has git and `setsid`.
  - **Docs:**
    - **Decisions:** D44 in `docs/decisions.md`.
    - **`docs/environments.md`:** a container section, the descriptor, and the checklist status, which marks every backend done.
    - **`docs/agent-commands.md`:** the network level inside a container.
    - **`CHANGELOG.md`:** the `[Unreleased]` entry.
    - **`CLAUDE.md`:** the read list names D44; `test:live` names the container walk and its variables.
    - **`README.md` and `docs/PRD.md`:** F3 progress.
    - **`docs/workflow-engine.md`:** the descriptor, if the Projects section lists kinds.
    - **Phase files:** `docs/phases/phase-04-projects.md` (the decided item), and row 5 and the follow-ups in `docs/phases/phase-04-progress.md`.
- **Out:**
  - Building or creating a container from `devcontainer.json`, the devcontainer CLI, and `docker compose`.
  - Plain containers without the dev container label.
  - Remote Docker hosts (`DOCKER_HOST` over SSH or TCP) beyond what the docker CLI itself picks up from its own environment and context.
  - The projects screen, the Reconnect button and the read-only look (`p4-projects-screen`).
  - The add wizard UI and its call to `detectDocker` (`p4-add-project-wizard`).
  - IPC for containers, detection or Reconnect.
  - Automatic reconnect.
  - Windows containers.
  - A change to the local, WSL or SSH backends' behaviour.

## Decisions

| Question | Decision | Alternatives considered |
| --- | --- | --- |
| How dev containers are attached (D44) | The docker CLI: every call is `docker exec` with an argument array through the shared setsid launcher. The user starts the container first, and Reconnect runs `docker start` on a stopped one | The devcontainer CLI (`devcontainer up` and `exec`; needs `@devcontainers/cli`, slower, still needs docker for kills); docker exec plus `devcontainer up` on Reconnect (two tools to detect and test) |
| Container identity | The `devcontainer.local_folder` label value, looked up on each connect, so a rebuild keeps the project. Plain containers are not supported | Container name or id (turns unreachable after each rebuild); label, else name (two lookup paths) |
| Files | One `docker exec` of a fixed POSIX command per files call, with stdin for writes; works with bind mounts and volumes | The host folder behind the workspace bind mount (fails for volume workspaces; path mapping per Docker host) |
| Docker host | `docker` on the host PATH, or `wsl.exe -d <distro> --exec docker` on Windows | Host PATH only (the live walk here would need Docker Desktop) |
| Exec user | `remoteUser`, else `containerUser`, from the `devcontainer.metadata` label, as `-u`; else the image's default user | Always the image's default user (often root, wrong file owners) |
| Defaults stated, not asked | Feature `p4-env-container` on `feature/p4-env-container` from `main`. Linux containers only, from `uname -s`. `setsid` is required in the container. The network level is probed with `unshare`, usually `proxy-only`. Watching uses the shared poll. Git goes through the group launcher. Detection is not wired. The live walk mirrors the SSH one | — |

## Approach

1. Add the descriptor to `src/main/projects/store.ts` (validation, duplicates, the root check through the environment), and the Docker host type.
2. Add `container-transport.ts`: the real transport, lookup, metadata and the exec argument builder. Add the fake transport in `tests/support/`, which runs the fixed scripts on a temp folder through a local `sh`. On Windows, Git Bash's `sh` is used, as the SSH fake does; this is checked first, and if it is not workable, the fake interprets the fixed commands itself.
3. Add `container.ts`: path, files (fixed scripts and code mapping), process (launcher, variables, kill, network), watch, git and connection, with their unit tests.
4. Add `container-detect.ts` (`detectDocker`) and its parsing tests.
5. `environmentFor` for the container kind (`src/main/env/index.ts`), then the registry tests for the container kind (`src/main/projects/registry.ts`, expected to need no logic change).
6. The recording backend and the headless walk on the fake container, and the boundary check for `docker`.
7. The live walk in `tests/live/container-walk.live.test.ts`, run here against a throwaway labelled container in WSL Docker.
8. Docs (D44 and the rest), then `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test`.

## Verified assumptions

| Assumption | Evidence |
| --- | --- |
| The environment interface has six parts with `connection`, and a backend contract and checklist for the container backend | `docs/environments.md` "The interface", "Checklist" |
| The setsid launcher and marker reader are shared and pure | `src/main/env/launcher.ts` |
| The polling watch is shared | `src/main/env/poll-watch.ts` (D43) |
| `environmentFor` takes a descriptor and injectable deps, and refuses unknown kinds | `src/main/env/index.ts` |
| The store's descriptor union is extended per backend | `src/main/projects/store.ts:34`, `:146-166` |
| The registry keeps unreachable projects listed and read-only, with `reconnect(id)` | `src/main/projects/registry.ts:45`, `:98`, `:379` |
| git takes an injected launcher | `createGit` in `src/main/git/git.ts` (D42, D43) |
| Docker exists on this machine only inside WSL Ubuntu (engine 28.1.1), with `setsid` there; there is no Windows docker CLI | `which docker` in Git Bash: not found; `wsl -e bash -lc 'which docker; docker version'`: `/usr/bin/docker`, `28.1.1`; `/usr/bin/setsid` |
| The design's container card reads "Runs inside Docker from the repo's devcontainer.json" and "Docker not running: start it to use this" | `docs/design/screens/Projects2Env.dc.html` |
| D44 is the next decision number | `docs/decisions.md`: last is D43 |

## Risks

- **Files over exec are slow.** Each files call starts a docker process (about 50–150 ms). The build loop and the lock make many calls. The headless live walk time shows the cost, which is recorded as a follow-up if it matters. Batching is a later change.
- **BusyBox differences** (`stat -c` formats, `realpath`, `head -c`). Mitigation: the fixed scripts use the common subset, and the fake runs them through a real `sh`. The live container is Debian-based, so BusyBox is checked only by review, recorded as a runtime check.
- **The label value from the dev container tools** may be a Windows path, a WSL path or a Linux path, depending on how the container was made. It is stored and matched verbatim, so the add wizard must offer the values that detection found.
- **wsl.exe argument quoting** for the docker host on WSL (the D42 follow-up). Mitigation: the folder pattern forbids quotes and control characters, and values cross through the environment, never through arguments.
- **The fake transport on Windows** needs a POSIX `sh` (Git Bash). CI's Windows runner has Git Bash, but the unit `check` job runs on Linux only, so this is fine in CI. Locally it is checked in step 2.
- **The live walk needs Docker in WSL and an image with git.** If the image cannot be pulled, the live run is reported as not run, and the unit walk still covers the backend.

## Open questions

None.
