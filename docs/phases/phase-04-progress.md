# Phase 4 progress: Projects and environments (F3)

Status: in progress · Started: 2026-11-25

Remote: `origin` = https://github.com/leeray75/sdd-harness.git. Feature branches come into `main` through pull requests, and a pull request is merged only when CI is green on every job. The user merges each pull request on GitHub and says when it is done; Claude then fills in this file. No tracker is configured, so child tickets stay as `SUBTASK.md` drafts in `docs/specs/`.

The phase doc suggested five subtasks; the user chose a split into eight. Today every file tool, the command runner (lock and revert), the git module and the spec watcher call Node `fs` and `child_process` directly on one local root (`HARNESS_SPIKE_ROOT`). So `p4-env-local` first moves that code behind one environment interface with a local backend and no behaviour change. Then each remote backend is its own subtask, and each one runs the phase 3 headless walk on its backend. Every subtask's spec has a docs task and acceptance criterion (CHANGELOG, stale docs including `CLAUDE.md` and `README.md`, useful new docs), done in the build.

| #   | Feature               | Goal                                                                                                                                                                                                                                 | Status  | Spec | Commit |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | ---- | ------ |
| 1   | p4-project-store      | Persisted projects in app data (add, remove without deleting files) and per-project rules (round limit, model policy, commit format) feeding the engine; the spec and ship handlers work per project instead of `HARNESS_SPIKE_ROOT` | pending |      |        |
| 2   | p4-env-local          | One environment interface for files, commands, git and watching; the tools, the command runner, the git module and the spec lock moved onto it with a local backend, with no behaviour change                                        | pending |      |        |
| 3   | p4-env-wsl            | WSL backend (distribution detection, files, commands, git, watching) that runs the phase 3 headless walk                                                                                                                             | pending |      |        |
| 4   | p4-env-ssh            | SSH backend with saved servers, credentials, reconnect and the unreachable, read-only project state; runs the headless walk                                                                                                          | pending |      |        |
| 5   | p4-env-container      | Dev container backend (Docker detection, attach, files and commands) that runs the headless walk                                                                                                                                     | pending |      |        |
| 6   | p4-project-checks     | Automatic checks and their results: git repository, code host from origin, tracker, test command, earlier specs                                                                                                                      | pending |      |        |
| 7   | p4-projects-screen    | Projects screen: cards with environment, path, six-segment stage bar, state and one action; Needs you, Running and Shipped panel; no-projects and unreachable (Reconnect) states                                                     | pending |      |        |
| 8   | p4-add-project-wizard | Add project wizard: where (four environments with detected details and disabled options with their fix), folder and checks, rules and models                                                                                         | pending |      |        |

## Decisions added

- (none yet)

## Decide during planning

- SSH library and how credentials are handled: in the `p4-env-ssh` plan, recorded as a new D-number.
- How dev containers are attached (docker exec or the devcontainer CLI): in the `p4-env-container` plan, recorded as a new D-number.

## Follow-ups

- (none yet)

## Phase summary

(written when the phase is done)
