---
status: done
ticket:
---

# p4-env-local

## Problem

Every module that works in a project's folder calls Node directly. The file tools, the command runner with its lock and revert, the command detection, the git module, the spec lock and watcher, and ship all import `node:fs`, `node:fs/promises` or `node:child_process` and build paths with `node:path` (20 modules, about 4,400 lines).

F3 needs projects in WSL, over SSH and in dev containers, where none of those calls reach the project. Adding each backend now would mean changing every one of these modules three times. Some of them are also synchronous (`detect`, `lookup`, the Windows tree kill, `commandPolicyFor`), and a remote backend cannot answer synchronously.

## Goals

- **G1:** One environment interface in main (`Environment`) covers everything the app does inside a project: paths, files, programs, watching and git. It is chosen from the project's environment descriptor (D40).
- **G2:** A local backend gives exactly today's behaviour: the same error codes, containment and symlink rules (D29), Windows shim, timeouts, tree kill and network limit (D31), and git calls (D38).
- **G3:** Every module that touches a project reaches it only through the interface, which it receives as a required parameter. Nothing falls back to local on its own.
- **G4:** Git can still be run only from `src/main/git/` (D38), and the tools and agent host get a narrower view with no git part.
- **G5:** The phase 3 headless walk runs through a project's environment taken from the registry.
- **G6:** The docs are updated in the same change, with D41 and a new `docs/environments.md` for the later backends.

## Non-goals

- Any backend other than local, and any environment detection (WSL distributions, SSH servers, Docker).
- The app-data stores' own reads and set-aside renames (`src/main/projects/store.ts`, `src/main/secrets/store.ts`) stay on `node:fs`. Only the project store's atomic save goes through the shared helper. The secret store keeps its own synchronous save, with mode `0o600`, unchanged (revision 1).
- The unreachable and read-only project state and Reconnect (`p4-env-ssh`), the project checks (`p4-project-checks`), and any UI or IPC.
- Any change in what a tool, command, lock, handler or ship step does, or in the reasons and messages they return.

## Design

### Interface (`src/main/env/types.ts`, no Electron import)

`Environment` (named so it does not clash with the store's descriptor type `ProjectEnvironment`) has five parts. Every method is async except the `path` helpers and the `platform` value.

- **`path`:** `join`, `resolve`, `relative`, `dirname`, `basename`, `isAbsolute`, `sep`, the helpers of the environment's flavour. Local uses `node:path`, and remote backends will use `path.posix`.
- **`files`:** these operations, in the meanings and with the error codes of `node:fs/promises`:
  - `stat`, `lstat`, `realpath`, `access`;
  - `readFile`, with an optional byte cap, and `open` for reads by byte range where a module needs it;
  - `writeFile`, `mkdir`, `readdir` (with file types), `rm`, `rename`, `chmod`.

  Each failure carries a Node-style `code` (`ENOENT`, `ENOTDIR`, `EACCES`, `EPERM`, `EBUSY`, `ELOOP`, `EISDIR`, `EEXIST` and so on), so the modules' error handling does not change.
- **`process`:**
  - `platform`: the platform of the environment;
  - `spawn(file, argv, { cwd, env, timeoutMs, network, signal })`, with an argument array and no shell. It streams stdout and stderr, kills the whole process tree on timeout or abort, and resolves with the exit code, the signal and whether it timed out;
  - `network: 'normal' | 'none'`: the writer's limit (D31). The backend applies it as well as its OS allows and reports which level it got (`os` or `proxy-only`), so the rule event is unchanged.
- **`watch`:** `watchDir(path, onEvent, onError)`, non-recursive, returning a handle with `close()`.
- **`git`:** `currentBranch`, `defaultBranch`, `changedPaths`, `stage`, `commit`, `push`, `aheadOfUpstream` and `ignoredEntries`. Each takes the project root and has the same results and failure codes as today's `src/main/git/git.ts` (`GitResult`, `GitStatus`, `GitFailure`).

`ToolEnvironment` is `{ path, files, process, ignoredEntries }`, with no `git` and no `watch` part. `toolEnvironment(env)` builds it, and its `ignoredEntries` calls `env.git.ignoredEntries`. Tools, commands and the agent host take only this type.

### Choosing a backend (`src/main/env/index.ts`)

- `environmentFor(descriptor)` returns the local backend for `{ kind: 'local' }`. Any other kind is refused with a fixed reason, and the type leaves room for the later kinds.
- `localEnvironment()` returns the local backend. Tests use it, and it is the same object `environmentFor` returns for local.

### Local backend (`src/main/env/local.ts`)

- `path` is `node:path`, and `files` and `watch` call `node:fs` and `node:fs/promises`, passing their errors through unchanged.
- `process.spawn` holds today's spawn, timeout and tree-kill code from `run-command.ts`: `detached` off Windows with a process-group kill, and `taskkill /T /F` on Windows, now run without `execFileSync`. It applies `network: 'none'` with today's probes and wrappers from `src/main/commands/network.ts`. That module is then used only by the local backend.
- `git` is today's functions in `src/main/git/git.ts`, bound into the backend. `execFile('git', …)` stays in `git.ts`, and the local backend has no `child_process` git call of its own.

### Shared helpers over the interface

- `writeFileAtomic(files, path, bytes, options?)` in `src/main/tools/atomic-write.ts` keeps today's temp-file, rename and retry steps, `RENAME_ATTEMPTS` and `RENAME_RETRY_MS`, over `files`. The project store calls it with `localEnvironment().files`. The secret store does not: its save is synchronous and sets mode `0o600`, which the helper does not offer, so it stays on `node:fs` (revision 1).
- `src/main/tools/paths.ts` (`resolveInRoot`, `isInside`, `hasGitSegment`, `hasNodeModulesSegment`, `areaMismatch`) and `walk.ts` (`walkFiles`, `globToRegExp`) use `env.path` and `env.files`. Their rules and reasons are unchanged.

### Modules moved onto the interface

Each takes the environment (`ToolEnvironment` or `Environment`) as its first parameter where it touches a project.

- **Tools** (`src/main/tools/`): `read-file`, `write-file`, `edit-file`, `list-files`, `search-text` and `run-command`. `run-command` spawns through `env.process.spawn` and gets the ignored entries through `env.ignoredEntries`.
- **Commands** (`src/main/commands/`):
  - `detect`: `rootMarkerFiles(env, root)` is async;
  - `lookup`: `resolveProgram(env, program, vars, platform)` is async, built on `files.stat` and `access`;
  - `protect`: snapshot, spec-folder lock and restore go through `files`, and ignored entries come from `env.ignoredEntries`.

  `cmdExeFor`, `cmdLineFor`, `isCommandScript`, `detectCommands` and `isStructurallyValidToml` stay pure.
- **Agent host** (`src/main/agent/host.ts`): `commandPolicyFor(env, root, live?)` is async, and the tool dispatch passes the environment to each tool.
- **Workflow** (`src/main/workflow/`):
  - `job-runner` and `app-runner` take the environment and pass it on;
  - `spec-folders`, `spec-lock` and `spec-watch` work over `files`, `path` and `watch`;
  - `ship` works over `files`, `path` and `git`.

  `build-loop.ts` uses no file or program call and changes only where a caller's signature makes it.
- **Handlers** (`src/main/human/spec-handlers.ts`, `ship-handlers.ts`): their deps gain `env`.
- **Registry** (`src/main/projects/registry.ts`):
  - its deps gain `environmentFor`;
  - each project's environment is made once and held next to its root;
  - `startLock`, the handlers and the runner wiring take it from there;
  - a new `environmentOf(projectId)` returns it, or `null` for an unknown project;
  - a project whose environment cannot be made is refused the same way as an unknown project.
- **App** (`src/main/index.ts`): passes `environmentFor` to the registry. The dev project is `{ kind: 'local' }`.

### Boundaries

- Only `src/main/env/`, `src/main/git/` and the two app-data stores import `node:fs`, `node:fs/promises` or `node:child_process` under `src/main/`. Only `src/main/env/` imports `src/main/commands/network`.
- No file under `src/main/tools/`, `src/main/commands/`, `src/main/agent/` or `src/agent/` names `.git.` on an environment, the `Environment` type's `git` part, or `src/main/git`. The ignored-entries query reaches them only as `ToolEnvironment.ignoredEntries`.
- `tests/unit/git-boundary.test.ts` passes unchanged.

## Acceptance criteria

- **AC1:** `src/main/env/types.ts` defines `Environment`, with the `path`, `files`, `process`, `watch` and `git` parts of the Design, and `ToolEnvironment`. `environmentFor({ kind: 'local' })` returns the local backend, and any other kind is refused with a fixed reason.
- **AC2:** A scan test (`tests/unit/env-boundary.test.ts`) shows the following:
  - no file under `src/main/` other than `src/main/env/**`, `src/main/git/**`, `src/main/projects/store.ts` and `src/main/secrets/store.ts` imports `node:fs`, `node:fs/promises` or `node:child_process`;
  - nothing outside `src/main/env/` and the network tests imports `src/main/commands/network`;
  - no file under `src/main/tools/`, `src/main/commands/`, `src/main/agent/` or `src/agent/` names `src/main/git` or a `.git.` member of an environment.
- **AC3:** Behaviour is unchanged. Every existing unit test and the e2e suite pass. A test may change only how it builds its dependencies (passing `localEnvironment()`, `toolEnvironment(...)` or a registry's environment, or awaiting a function that became async), never what it asserts. `git diff main -- tests/` shows no changed `expect` line except where a call inside it gained an environment argument or an `await`.
- **AC4:** `tests/unit/git-boundary.test.ts` passes with no change to the file.
- **AC5:** The local backend's own tests (`tests/unit/env-local.test.ts`) check the following on temp folders:
  - error codes pass through (`ENOENT`, `ENOTDIR`, `EISDIR`);
  - `writeFileAtomic` over the local `files` writes atomically and retries a busy rename;
  - `spawn` runs a program with an argument array and no shell, returns its exit code, and kills a child tree on timeout;
  - `watchDir` reports a change and stops after `close()`;
  - `environmentFor` refuses an unknown kind.
- **AC6:** A recording test backend (`tests/support/recording-env.ts`) wraps the local backend and records every call by part and method. Tests with it show the following, each step reaching its result only through recorded calls:
  - the file tools read, write, list and search through `files`;
  - `run_command` spawns through `process.spawn`;
  - the spec lock reads, hashes and writes the state through `files`, and the watcher watches through `watch`;
  - `approveResult` stages, commits and pushes through `git`, and reads and writes `SUMMARY.md` through `files`.
- **AC7:** The headless walk (`tests/unit/headless-e2e.test.ts`) builds a project registry holding one local project in its temp repo. It takes the environment with `environmentOf`, and runs the whole walk with it: the app runner, the handlers through `handlerFor`, and the lock watcher. It passes with its assertions unchanged, and CI is green on `check` and on `e2e` on Windows, macOS and Linux.
- **AC8:** The registry gives each project one environment from `environmentFor`, and `environmentOf` returns it, or `null` for an unknown project. A project whose descriptor `environmentFor` refuses is refused by `handlerFor` with `refused`, and nothing changes (registry tests).
- **AC9:** Docs, done in the build on the feature branch:
  - a `CHANGELOG.md` entry under `## [Unreleased]`;
  - D41 in `docs/decisions.md`, covering the interface and its parts, the local backend, git per backend inside `src/main/git/`, async only, path flavour per environment, the environment as a required parameter, `ToolEnvironment` with no git, and the one atomic writer. Short notes under D29, D31 and D38 point to D41;
  - a new `docs/environments.md`, covering:
    - each part of the interface;
    - the contract a backend must keep: error codes, no shell, timeout and tree kill, the network option and the levels it reports, the path flavour, and the git part living in `src/main/git/`;
    - how `environmentFor` and the registry pick and hold a backend;
    - a checklist for the WSL, SSH and container backends;
  - stale docs updated:
    - `docs/workflow-engine.md` (Spec lock, Ship and close, Headless run, Projects, code map);
    - `docs/agent-commands.md` (where commands run, and the network limit in the local backend);
    - `CLAUDE.md` (the read list and the rules point to D41 and `docs/environments.md`);
    - `README.md`, `docs/PRD.md` and `docs/workflow.md` where they are affected;
    - `docs/phases/phase-04-projects.md`;
    - row 2 and the follow-ups in `docs/phases/phase-04-progress.md`.
- **AC10:** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` and `pnpm e2e` pass.

## Open questions

- 2026-11-25, revision 1: the secret store's save. The build found that moving it onto the shared async helper would make the store async and drop its `0o600` file mode. Decision: the secret store keeps its own synchronous save, unchanged, and only the project store uses `writeFileAtomic`. Not taken: a `mode` option on the async helper with an async secret store, or a synchronous form of the helper in the local backend.
