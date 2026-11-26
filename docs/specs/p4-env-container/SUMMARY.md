# Summary Report: p4-env-container

Ticket: none   Date: 2026-11-26
Outcome: Clean
Review rounds: 1 of 3 per revision (revision 1; revision 0 paused before any review); revisions: 1 of 2
Models: implementor haiku; reviewer sonnet; data agent not used (all chosen by the user); respawns: none

## What was built

A dev container backend implements the whole `Environment` interface for one dev container and a POSIX root inside it (G1).

- **Attach (D44):** every call is a `docker exec`, run with an argument array through the shared setsid launcher. Each files call runs one fixed POSIX script, with paths passed as positional arguments.
- **Finding the container:** it is looked up by its `devcontainer.local_folder` label on each connect, so a rebuild keeps the project. Programs run as the dev container's `remoteUser`, then `containerUser`, then the image default (G2).
- **Docker host:** Docker is reached on the host PATH or through `wsl.exe` on Windows, with no host shell and no variable value in an argument (G3).
- **Unreachable state:** a missing or stopped container, or a stopped engine, makes the project unreachable and read-only through the existing connection part and registry. `reconnect()` starts a stopped container. Only docker's own error lines count as "gone", which is revision 1 (G4).
- **Store and registry:** both accept container projects (G5).
- **Headless walk:** it runs on a container project over a fake transport in `pnpm test`, and live in a real container through WSL Docker, where it passed in 735 s (G6).
- **Docs:** D44 and the docs are current (G7).

## Files changed

Product files (group 1):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/main/env/container-transport.ts | created | The docker seam: transport, host and WSL invocation with `WSLENV`, `findContainer`, the metadata user rule, the folder rule and the exec argument builder | T1, T2 |
| src/main/env/container.ts | created | The backend. It has the fixed files scripts and code words, and the connect check. The kill is `kill -s KILL -- "$1"`, and `goneIn` reads docker's own lines only. It also covers process, network, git, watch and connection | T3–T5, revision 1 |
| src/main/env/container-detect.ts | created | `detectDocker`: the CLI, the engine and the labelled containers. Never throws, and is not wired | T6 |
| src/main/env/index.ts | edited | `environmentFor` builds the container backend. It refuses a malformed descriptor, and the WSL host off Windows | T7 |
| src/main/env/wsl.ts | edited | Exports `WSL_EXE` (value unchanged) for the container transport | T1 |
| src/main/projects/store.ts | edited | Container descriptor, exact keys, folder rule, duplicate rule | T7 |
| src/main/projects/registry.ts | edited | `addProject` reconnects a container project before the root check | T7 |
| tests/support/fake-container-transport.ts | created | Fake docker over temp folders, answering the fixed scripts by their exact text | T2–T8 |
| tests/unit/env-container.test.ts | created | AC2–AC8 cases, including the revision 1 cases | T2–T8 |
| tests/unit/container-scripts.test.ts | created | The fixed scripts through a real POSIX `sh`, compared with the fake. 51 of 51 on Linux; skipped on Windows | T3 |
| tests/unit/container-detect.test.ts | created | AC10 cases | T6 |
| tests/live/container-walk.live.test.ts | created | AC13 live walk; skipped without its variables and in CI | T9 |
| tests/unit/project-store.test.ts | edited | AC1 cases appended | T7 |
| tests/unit/project-registry.test.ts | edited | AC9 cases appended | T7 |
| tests/unit/env-recording.test.ts | edited | AC11 cases appended | T8 |
| tests/unit/headless-e2e.test.ts | edited | Headless walk on a container project appended | T8 |
| tests/unit/env-boundary.test.ts | edited | AC12 docker-name and import checks appended | T8 |
| CHANGELOG.md | edited | Unreleased entry | T10 |
| CLAUDE.md | edited | Read list names D44; `test:live` names the container walk | T10 |
| README.md | edited | Phase 4 status, `test:live` variables | T10 |
| docs/PRD.md | edited | F3 progress | T10 |
| docs/decisions.md | edited | D44, and a note under D41 | T10 |
| docs/environments.md | edited | The dev container section, the descriptor, the checklist status | T10 |
| docs/agent-commands.md | edited | Network level inside a container | T10 |
| docs/workflow-engine.md | edited | Environment kinds | T10 |
| docs/phases/phase-04-projects.md | edited | The attach item is decided (D44) | T10 |
| docs/phases/phase-04-progress.md | edited | Row 5, D44, follow-ups | T10 |

Workflow files (group 2):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| docs/specs/p4-env-container/PLAN.md | created | The approved plan | plan |
| docs/specs/p4-env-container/SPECS.md | created | The approved spec, revision 1 | plan, revision 1 |
| docs/specs/p4-env-container/SUBTASK.md | created | Child-ticket draft (no tracker) | plan |
| docs/specs/p4-env-container/tasks.md | created | T1–T11, all ticked (T4 and T5 revised in revision 1) | plan, all |
| docs/specs/p4-env-container/build-ledger.md | created | The build ledger | build |
| docs/specs/p4-env-container/changes.md | created | The implementor's record | build |
| docs/specs/p4-env-container/SUMMARY.md | created | This report | build |

Git and `changes.md` agree. `bash.exe.stackdump` is untracked, predates the work, and is left out of the commit.

## Acceptance criteria

| AC | Status | Evidence |
| --- | --- | --- |
| AC1 descriptor | Met | project-store cases; the reviewer confirmed exact keys, the folder rule and the duplicate rule |
| AC2 lookup and user | Met | env-container cases |
| AC3 docker command | Met | env-container cases. Values appear only in the docker process environment, and `WSLENV` carries names only |
| AC4 path and files | Met | env-container cases; container-scripts 51 of 51 on Linux dash (found and fixed the GNU `realpath` missing-component case) |
| AC5 process | Met | env-container cases, including the exact `kill -s KILL -- -<pgid>` form (revision 1) |
| AC6 watch and git | Met | env-container cases; git.test.ts and git-boundary.test.ts unchanged and passing |
| AC7 connection | Met | env-container cases, including seven revision 1 gone-check cases |
| AC8 environmentFor | Met | env-container cases |
| AC9 registry | Met | project-registry cases |
| AC10 detection | Met | container-detect cases |
| AC11 walk and recording | Met | headless walk and env-recording container cases |
| AC12 boundary | Met | env-boundary cases |
| AC13 live walk | Met | Passed in 735 s through WSL Docker (Ubuntu) in a throwaway labelled container, which was removed afterwards; skips without the variables |
| AC14 docs | Met | All listed docs updated; the reviewer checked each |
| AC15 checks | Met locally; CI pending | typecheck, lint, format:check; `pnpm test` 1967 passed and 69 skipped on Windows; 2029 passed on Linux Node 24 (one root-only failure in `command-protect`, which passes as non-root); e2e 21 passed and 2 skipped (one flaky run while the live walk shared the machine, green on rerun); `git diff main -- tests/` additions only, plus import lines that gained names. The pull request's CI run is checked after the push |

## Needs a runtime check

- **Error codes:** on a real dash or BusyBox container, a write into a read-only parent folder gives `ENOENT`, and a failed rename gives `EIO`. Both fall inside "any other failure is `EIO`".
- **Marker order:** the marker must be the first line under real `docker exec` output ordering. This is the same shared design as WSL and SSH, and the live walk passed.
- **UTF-16 errors:** docker started through `wsl.exe` might emit UTF-16 error text when the engine is down, which could defeat the line-start match.
- **CI:** the pull request's `check (Linux)` job, which runs `container-scripts.test.ts` for real.

## Review ledger

### Revision 1, round 1 (PASS)

No findings.

## Spec revisions

- **Revision 1**, raised by the implementor at T4 before any review. The user chose to revise the spec.
  - **Group kill:** `kill -s KILL -- -<pgid>`. Dash, the `/bin/sh` of Debian and Ubuntu images, refuses `kill -KILL -- -<pgid>`. Not taken: `kill -KILL -<pgid>`, which was not verified; running the kill through bash.
  - **Gone-container check:** only docker's own message lines count, matched by line start. For a launched program, only the stderr before the marker is checked. Not taken: the phrases plus the exit code; the literal substring patterns.

## Rejected findings

None.

## Open issues

None.

- **Recorded follow-up:** the live walk is slow (about 12 minutes), because each docker call through `wsl.exe` takes about 0.5 s. It is in `docs/phases/phase-04-progress.md`.
- **Orchestrator note, not in the progress file:** the WSL and SSH backends still use `kill -KILL -- -<pgid>`, which the reviewer left unchanged because those backends are out of scope. Whether that form reaches dash there (for example, an SSH server whose login shell is dash) is worth a check in a later subtask.

## Git state

feature/p4-env-container; approved; committed and pushed in the commit that adds this report.

## Next steps

Approve, commit and push; or request changes; or not yet. After the push, open the pull request and merge only when every CI job is green, including `check (Linux)`.
