# Phase 4 progress: Projects and environments (F3)

Status: in progress · Started: 2026-11-25

Remote: `origin` = https://github.com/leeray75/sdd-harness.git. Feature branches come into `main` through pull requests, and a pull request is merged only when CI is green on every job. The user merges each pull request on GitHub and says when it is done; Claude then fills in this file. No tracker is configured, so child tickets stay as `SUBTASK.md` drafts in `docs/specs/`.

The phase doc suggested five subtasks; the user chose a split into eight. Today every file tool, the command runner (lock and revert), the git module and the spec watcher call Node `fs` and `child_process` directly on one local root (`HARNESS_SPIKE_ROOT`). So `p4-env-local` first moves that code behind one environment interface with a local backend and no behaviour change. Then each remote backend is its own subtask, and each one runs the phase 3 headless walk on its backend. Every subtask's spec has a docs task and acceptance criterion (CHANGELOG, stale docs including `CLAUDE.md` and `README.md`, useful new docs), done in the build.

| #   | Feature               | Goal                                                                                                                                                                                                                                 | Status  | Spec                                            | Commit                                              |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | ----------------------------------------------- | --------------------------------------------------- |
| 1   | p4-project-store      | Persisted projects in app data (add, remove without deleting files) and per-project rules (round limit, model policy, commit format) feeding the engine; the spec and ship handlers work per project instead of `HARNESS_SPIKE_ROOT` | done    | [SUMMARY](../specs/p4-project-store/SUMMARY.md) | `080d4d2` (PR #27; work `905ba03`, close `811c206`) |
| 2   | p4-env-local          | One environment interface for files, commands, git and watching; the tools, the command runner, the git module and the spec lock moved onto it with a local backend, with no behaviour change                                        | pending |                                                 |                                                     |
| 3   | p4-env-wsl            | WSL backend (distribution detection, files, commands, git, watching) that runs the phase 3 headless walk                                                                                                                             | pending |                                                 |                                                     |
| 4   | p4-env-ssh            | SSH backend with saved servers, credentials, reconnect and the unreachable, read-only project state; runs the headless walk                                                                                                          | pending |                                                 |                                                     |
| 5   | p4-env-container      | Dev container backend (Docker detection, attach, files and commands) that runs the headless walk                                                                                                                                     | pending |                                                 |                                                     |
| 6   | p4-project-checks     | Automatic checks and their results: git repository, code host from origin, tracker, test command, earlier specs                                                                                                                      | pending |                                                 |                                                     |
| 7   | p4-projects-screen    | Projects screen: cards with environment, path, six-segment stage bar, state and one action; Needs you, Running and Shipped panel; no-projects and unreachable (Reconnect) states                                                     | pending |                                                 |                                                     |
| 8   | p4-add-project-wizard | Add project wizard: where (four environments with detected details and disabled options with their fix), folder and checks, rules and models                                                                                         | pending |                                                 |                                                     |

## Decisions added

- D40: projects. The store in `projects.json` in app data, the rules model (round limit, model policy, commit format; spec approval and review are not rules), the per-project registry with the dev project from `HARNESS_SPIKE_ROOT`, and the amendment of D33's request to `{ action, project, feature }` (`p4-project-store`).

## Decide during planning

- SSH library and how credentials are handled: in the `p4-env-ssh` plan, recorded as a new D-number.
- How dev containers are attached (docker exec or the devcontainer CLI): in the `p4-env-container` plan, recorded as a new D-number.

## Follow-ups

- From `p4-project-store`:
  - Nothing calls `buildOptionsFor` yet. The build start (D39, with its UI or IPC, in `p4-projects-screen` or the phase 7 build view) must pass the project's round limit and commit format, and must not build a runner without the project.
  - No UI or IPC reaches the store: `change-rules` keeps no handler and answers `not-available`. `p4-projects-screen` and `p4-add-project-wizard` add the list, add, rename, rules and remove calls, each with the user gesture check.
  - The model policy is stored and validated, and nothing routes on it yet (phase 8).
  - A stored project whose folder has moved or been removed stays listed until a request for it is refused by its handlers. `p4-project-checks` reports it.
  - The e2e launch has no projects, so the e2e suite covers only the refusal of an unknown project. A test that adds a project through the store belongs with `p4-projects-screen`.
  - The `dev` project exists only in an unpackaged run with `HARNESS_SPIKE_ROOT` set. A packaged app has no dev project and no project until the add wizard exists.
  - The build was clean: review round 1 passed with no findings, with no spec revisions. The reviewer listed two runtime checks:
    - a saved project and the `dev` project that share a root get two watchers;
    - the filesystem-dependent store tests, which run with 15 s and 20 s timeouts, plus a case-only duplicate test that runs on Windows and macOS only.
  - The work and the close commit came in together as PR #27 (`080d4d2`), which also carried the `docs: phase 4 plan` commit. When this row was written, the PR run (45712145120) and the main run (45712159042) were green on `check` and on Linux `e2e`, and their Windows and macOS `e2e` jobs were still running.

## Phase summary

(written when the phase is done)
