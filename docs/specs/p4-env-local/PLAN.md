# Plan: p4-env-local

Ticket: none (vibe planning, Phase 4 subtask 2)
Status: approved
Date: 2026-11-25

## Objective

Everything the app does inside a project's folder (files, programs, git and watching) goes through one environment interface in main, chosen from the project's environment descriptor (D40: `{ kind: 'local' }` today). The existing code moves onto that interface with a local backend and no change in behaviour. Then the WSL, SSH and container subtasks (`p4-env-wsl`, `p4-env-ssh`, `p4-env-container`) only add a backend: they change no tool, command, lock or ship code.

## Scope

- **In:**
  - **The interface** (`src/main/env/types.ts`): one `Environment` type with five parts (named so it does not clash with the store's descriptor type `ProjectEnvironment`). Everything is async (see Decisions).
    - `path`: the path helpers of the environment's flavour (`join`, `resolve`, `relative`, `dirname`, `basename`, `isAbsolute`, `sep`). For local this is `node:path`, and later remote backends give `path.posix`.
    - `files`: `stat`, `lstat`, `realpath`, `readFile` (with an optional byte cap), `open` for reads by byte range where the modules need it, `writeFile`, `mkdir`, `readdir` (with file types), `rm`, `rename`, `chmod`, `access`. Each one fails with Node-style error codes (`ENOENT`, `ENOTDIR`, `EACCES`, `EPERM`, `EBUSY`, `ELOOP` and so on), so the modules' error handling stays as it is.
    - `process`: `spawn(file, argv, { cwd, env, timeoutMs, network })` with an argument array and no shell. It streams output, kills the whole tree on timeout or abort, and returns the exit code and signal. It also has `platform`, the platform of the environment, used for the Windows shim (D31) and for comparing environment variable names. Program lookup on PATH stays in `src/main/commands/lookup.ts`, built on `files`.
    - `watch`: `watchDir(path, onEvent, onError)`, non-recursive, returning a handle with `close()`. That is what `spec-watch.ts` needs.
    - `git`: the fixed git operations of `src/main/git/git.ts` (`currentBranch`, `defaultBranch`, `changedPaths`, `stage`, `commit`, `push`, `aheadOfUpstream`, `ignoredEntries`), each taking the project root. Each backend's git part is provided by code inside `src/main/git/` (see Decisions).
  - **The local backend** (`src/main/env/local.ts`, plus `src/main/env/index.ts` with `environmentFor(descriptor)`, which returns the local backend for `{ kind: 'local' }` and refuses any other kind with a fixed reason). It does exactly what the code does today:
    - `files` and `watch` call `node:fs`;
    - `process` calls `child_process.spawn`, with `taskkill /T /F` on Windows and process-group kill elsewhere, and applies the writer's network limit through today's `src/main/commands/network.ts` probes and wrappers (D31);
    - `git` is `src/main/git/git.ts`'s existing functions, unchanged, with `execFile('git', …)` staying in `git.ts`.
  - **Shared helpers built on the interface, not on Node:**
    - `writeFileAtomic(files, path, bytes)` in `src/main/tools/atomic-write.ts`, the same temp-file, rename and retry steps over `files`. The two app-data stores (`src/main/projects/store.ts`, `src/main/secrets/store.ts`) call it with the local backend's `files`, so there is still one atomic writer. The stores keep their own `node:fs` reads.
    - `walkFiles`, `resolveInRoot` and the path checks in `src/main/tools/paths.ts`, built on `env.path` and `env.files`, with the same containment, symlink, `.git` and `node_modules` rules (D29).
  - **Modules moved onto the interface.** Each takes the environment as a required first parameter (see Decisions):
    - tools (`src/main/tools/`): `paths`, `read-file`, `write-file`, `edit-file`, `list-files`, `search-text`, `walk`, `run-command`, `atomic-write`;
    - commands (`src/main/commands/`): `detect` (marker files read through `files`, now async), `lookup` (PATH lookup through `files.stat`/`access`, now async), `protect` (snapshot, lock and revert through `files`, ignored entries through `git.ignoredEntries`). `network` becomes the local backend's helper: only `src/main/env/local.ts` and its tests use it;
    - the agent host (`src/main/agent/host.ts`): `commandPolicyFor` and the tool dispatch take the environment, and `commandPolicyFor` becomes async (see Decisions);
    - workflow (`src/main/workflow/`): `spec-folders`, `spec-lock`, `spec-watch`, `ship` (git through `env.git`, files through `env.files`), `app-runner` (takes the environment and passes it to the job runner and host), `job-runner` as far as it passes the environment on. `build-loop.ts` uses no file or program call today (checked), so it changes only if a caller needs it;
    - human handlers (`src/main/human/spec-handlers.ts`, `ship-handlers.ts`) and the registry (`src/main/projects/registry.ts`): each project gets its environment from `environmentFor(project.environment)`, held next to its root. `startLock`, the handlers and `buildOptionsFor` take the environment from there, and the registry has `environmentOf(projectId)` for the build start (D39) and the tests;
    - `src/main/index.ts`: passes `environmentFor` into the registry. The dev project is `{ kind: 'local' }`.
  - **Who can reach git.** The tools and the agent host get a narrower type with no `git` part (`ToolEnvironment`). `protect` gets only the `ignoredEntries` query, passed in by `run-command`. Only `ship.ts` (and the registry that builds it) holds the full environment with `git`. A type check and a scan test show that no file under `src/main/tools/`, `src/main/agent/` or `src/agent/` names `env.git` or `Environment['git']`.
  - **Tests:**
    - a scan test (`tests/unit/env-boundary.test.ts`) showing that no file under `src/main/tools/`, `src/main/commands/`, `src/main/workflow/`, `src/main/human/`, `src/main/projects/registry.ts` or `src/main/agent/` imports `node:fs`, `node:fs/promises` or `node:child_process`. The allowed importers are `src/main/env/`, `src/main/git/` and the two app-data stores. It also shows that nothing outside `src/main/env/` imports `src/main/commands/network`.
    - `git-boundary.test.ts`, unchanged, still passes: `git.ts` keeps `execFile('git'`, and no other file starts git.
    - a recording test backend (`tests/support/recording-env.ts`) that wraps the local backend and records each call. Tests use it to show that the tools (read, write, list, search, run a command), the spec lock (read, hash, write state, watch) and ship (stage, commit, push, and the `SUMMARY.md` and `changes.md` reads and writes) call the interface.
    - the existing tests, changed only in how they build their dependencies: they pass `localEnvironment()` (or the registry's environment) where they passed only a root. No assertion changes.
    - the headless walk (`tests/unit/headless-e2e.test.ts`) builds a registry with one local project in its temp repo, takes that project's environment with `environmentOf`, and runs the whole walk through it: the app runner, the handlers and the lock watcher.
  - **Docs** (in the build, on the feature branch):
    - a `CHANGELOG.md` entry under `## [Unreleased]`;
    - D41 in `docs/decisions.md`: the interface and its parts, the local backend, git per backend inside `src/main/git/`, async only, path flavour per environment, the environment as a required parameter, and the narrower tool type with no git. Short notes under D29, D31 and D38 point to D41;
    - a new `docs/environments.md`: the interface part by part, the contract a backend must keep (error codes, the no-shell rule, timeouts and tree kill, the network option, the path flavour, the git part living in `src/main/git/`), how `environmentFor` picks a backend, and a checklist for the WSL, SSH and container backends;
    - stale docs updated: `docs/workflow-engine.md` (Spec lock, Ship and close, Headless run, Projects, code map), `docs/agent-commands.md` (where commands run, the network limit now in the local backend), `CLAUDE.md` (read list and rules pointing to `docs/environments.md` and D41), `README.md` if it names the module layout, `docs/PRD.md` and `docs/workflow.md` if they are affected, and `docs/phases/phase-04-progress.md` (row 2 and its follow-ups).
- **Out:**
  - Any backend other than local, and any environment detection (WSL distributions, SSH servers, Docker).
  - The app-data stores' own reads and set-aside renames: they stay on `node:fs`. Only their atomic save goes through the shared helper with the local `files`.
  - The unreachable and read-only state and Reconnect (`p4-env-ssh`), the checks (`p4-project-checks`), and any UI or IPC.
  - Any change to what a tool, command, lock or ship step does, or to the messages and reasons it returns.

## Decisions

| Question | Decision | Alternatives considered |
| --- | --- | --- |
| Feature slug, repo, branch | `p4-env-local`, sdd-harness, base `main`, branch `feature/p4-env-local` | (none, from the phase plan) |
| Git in the interface | A `git` part per backend, provided by code inside `src/main/git/`. The local git part is today's `git.ts`, which keeps `execFile('git'`, so `git-boundary.test.ts` holds unchanged. Later backends add their git runner inside `src/main/git/`. | Git through the process part (one path for every environment, but the boundary test's assertion would change and the process part could start git) |
| Sync callers | Everything async. `detect`, `lookup`, the Windows tree kill and `commandPolicyFor` (with its callers in `host.ts` and `app-runner.ts`) become async, and `src/main/agent/host.ts` joins the scope. | Keep a sync local path (less change now, but each remote backend would face the same problem) |
| Paths | Each environment gives its own path helpers: `node:path` for local, `path.posix` for the remote backends later. Modules call `env.path`. | Keep `node:path` and leave translation to the later backends (smallest change, but wrong separators for a WSL project opened from Windows) |
| Passing the environment | A required first parameter wherever a module touches a project. Tests pass the local backend. | Optional, defaulting to local (fewer test edits, but a call that forgets it would run locally for a remote project without anyone noticing) |
| One atomic writer | `writeFileAtomic` works over `files`, and the app-data stores call it with the local `files` | A second Node-only writer for app data (two copies of the retry logic) |
| Where git can be reached | Tools and the agent host get `ToolEnvironment` with no `git` part. `protect` gets only `ignoredEntries`, and only ship holds the full environment. | Hand the full environment everywhere (simpler types, but tool code could reach git) |
| A new doc | `docs/environments.md` describing the interface and backend contract for the three later backends | Only D41 (too little for three backend subtasks to build on) |

## Approach

Work in layers, keeping the suite green after each one:

1. **Interface and local backend.** `src/main/env/types.ts`, `local.ts` and `index.ts`, with unit tests of the local backend against temp folders: error codes, atomic rename retry, spawn with tree kill on timeout, watch events.
2. **Tools.** `atomic-write`, then `paths` and `walk`, then `read`, `write`, `edit`, `list` and `search`. Each takes the environment first, and the tool tests pass `localEnvironment()`.
3. **Commands and run-command.** `lookup` and `detect` become async over `files`. `protect` works over `files` and the `ignoredEntries` query. `run-command` spawns through `env.process` with the `network` option, and the local backend uses `network.ts`.
4. **Agent host and app runner.** `commandPolicyFor` becomes async and the tool dispatch passes the environment. `app-runner` and `job-runner` take it.
5. **Workflow and handlers.** `spec-folders`, `spec-lock`, `spec-watch` and `ship` move over, then the handlers and the registry (`environmentFor` and `environmentOf`), then `index.ts`.
6. **Boundary tests, the recording backend and the headless walk through the registry.**
7. **Docs, then the full checks** (`pnpm typecheck`, `lint`, `format:check`, `test`, and `pnpm e2e` once).

## Verified assumptions

| Assumption | Evidence |
| --- | --- |
| These files import `node:fs` or `node:child_process` today: the tools, commands, git, ship, spec-folders, spec-lock, spec-watch, and the two stores | `grep -rln "node:fs\|node:child_process" src` lists exactly `src/main/commands/{detect,lookup,network,protect}.ts`, `src/main/git/git.ts`, `src/main/projects/store.ts`, `src/main/secrets/store.ts`, `src/main/tools/{atomic-write,edit-file,list-files,paths,read-file,run-command,search-text,walk,write-file}.ts`, `src/main/workflow/{ship,spec-folders,spec-lock,spec-watch}.ts` |
| `build-loop.ts`, `job-runner.ts`, `app-runner.ts`, `registry.ts` and `host.ts` import no fs | Not in that list |
| The git boundary test asserts `execFile('git'` in `git.ts` and that `protect.ts` has no `child_process` | `tests/unit/git-boundary.test.ts`, the "only src/main/git runs git" case |
| `protect.ts` takes ignored entries from the git module | `src/main/commands/protect.ts:9` imports `ignoredEntries` from `../git/git` |
| The sync callers are `detect` (`lstatSync`, `readFileSync`), `lookup` (`accessSync`, `statSync`), the Windows tree kill (`execFileSync('taskkill'…)`) and `commandPolicyFor` (calls `rootMarkerFiles` synchronously) | `src/main/commands/detect.ts:5`, `lookup.ts:5`, `src/main/tools/run-command.ts:130`, `src/main/agent/host.ts:118` |
| `app-runner.ts` calls `commandPolicyFor(options.root)` | `src/main/workflow/app-runner.ts:32` |
| The stores use `writeFileAtomic` from the tools | `src/main/projects/store.ts:23`, `src/main/secrets/store.ts:141` |
| `spec-watch.ts` uses non-recursive `fs.watch` plus `lstat` | `src/main/workflow/spec-watch.ts:1-11` |
| The headless walk builds its runner with `createAppJobRunner` on a temp repo | `tests/unit/headless-e2e.test.ts:31` and `makeRepo` |

## Risks

- **A changed error path.** The modules match on Node error codes. If the local backend wraps an error, a refusal reason could change. The unchanged tool and command tests catch it, and the backend's own tests check that the codes pass through.
- **Async ripple through the host.** `commandPolicyFor` becoming async touches the agent host's setup and `app-runner`. `policy-acceptance`, `tool-command` and the headless walk show it early (step 4).
- **Timing in `run-command`.** Moving spawn and tree kill into the backend could change timeout or kill behaviour on one OS. `tool-command.test.ts` and CI on all three systems show it.
- **Path flavour.** Using `env.path` wherever a module used `node:path` is mechanical but easy to miss in a helper. The scan test covers imports, and a missed `node:path` import is harmless for local. Remaining `node:path` imports in the moved modules are listed in the build report for the later backends.
- **Size.** About 4,400 lines across 20 modules, plus test wiring. The ordered layers keep each step checkable, and the build may use more than one review round.

## Open questions

none
