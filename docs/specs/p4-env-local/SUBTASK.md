# One environment interface for project files, programs, watching and git, with a local backend

**Parent:** none: no parent chosen
**Spec:** docs/specs/p4-env-local/SPECS.md
**Repo and base branch:** sdd-harness, base `main`, feature branch `feature/p4-env-local`

## Context

Every module that works in a project's folder calls Node directly: the file tools, the command runner, command detection, git, the spec lock and watcher, and ship. F3 needs projects in WSL, over SSH and in dev containers, where those calls don't reach the project.

This work adds one async `Environment` interface in main (paths, files, process, watching, git), chosen from the project's descriptor, with a local backend that behaves exactly as today. Every module moves onto it, taking the environment as a required parameter. Git stays inside `src/main/git/`, the tools get a view with no git part, and the headless walk runs through a project's environment from the registry. Then the later subtasks only add backends.

## Required work

- T1 Interface and local backend.
- T2 Atomic write, paths and walk.
- T3 File tools.
- T4 Commands and run-command.
- T5 Agent host and runners.
- T6 Spec folders, lock and watcher.
- T7 Ship.
- T8 Registry and app.
- T9 Boundary scan, recording backend and the headless walk.
- T10 Docs.
- T11 Full checks.

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

## Out of scope

- Any backend other than local, and any environment detection (WSL distributions, SSH servers, Docker).
- The app-data stores' own reads and set-aside renames (`src/main/projects/store.ts`, `src/main/secrets/store.ts`) stay on `node:fs`. Only their atomic save goes through the shared helper.
- The unreachable and read-only project state and Reconnect (`p4-env-ssh`), the project checks (`p4-project-checks`), and any UI or IPC.
- Any change in what a tool, command, lock, handler or ship step does, or in the reasons and messages they return.

## Links

- Plan: docs/specs/p4-env-local/PLAN.md
- Spec and tasks: docs/specs/p4-env-local/SPECS.md, docs/specs/p4-env-local/tasks.md
