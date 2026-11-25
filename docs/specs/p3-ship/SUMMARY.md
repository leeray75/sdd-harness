# Summary Report: p3-ship

Ticket: none Date: 2026-11-24
Outcome: Clean
Review rounds: 1 of 3 in revision 1 (no review ran in revision 0); revisions: 1 of 2
Models: implementor haiku; reviewer sonnet; data agent not used (all chosen by the user); respawns: none

## What was built

- **Git module (G1):** `src/main/git/git.ts` is now the only code that runs git.
  - It uses `execFile` with no shell, `GIT_TERMINAL_PROMPT=0`, timeouts and four fixed failure codes, and never returns or logs git's output.
  - The D31 `ls-files` query moved into it from `protect.ts` (revision 1).
- **approve-result (G2, G3):** it commits the approved work with `<ticket>: <summary>` or `<summary>`, from SUBTASK.md's title, and pushes the feature branch.
  - It refuses off build-done, without the lock, while a build runs, on a detached HEAD or the default branch, and with changes outside the allowed set.
  - The Git state line is rewritten before the commit.
  - A failed push keeps the commit, and approving again only pushes.
- **mark-done (G4):** it raises CLOSE through `transition()` once the work is pushed. It sets SPECS.md to `done`, removes this feature's state file, and commits and pushes `Close <feature> spec`. The folder then reads as closed.
- **No early commit (G5):** a scan shows only `git.ts` runs git, and no agent tool or job reaches it. A build run on a temp repo commits nothing.
- **Rule events (G6):** the job runner sends every gate decision, and the revert and network events, to `onRuleEvent`.
- **Docs (G7):** updated in the same change, with D38.

## Files changed

Product files (group 1):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/main/git/git.ts | created | The git module: `runGit` via `execFile` with no shell, plus `currentBranch`, `defaultBranch`, `changedPaths`, `stage`, `commit`, `push` and `aheadOfUpstream`, and `ignoredEntries` (moved from `protect.ts`) | T1, T6, revision 1 |
| tests/unit/git.test.ts | created | Temp-repo tests: each function, a rename and a deletion, the stage refusals, a bare and a missing remote, a non-repo, `ignoredEntries` | T1 |
| src/main/commands/protect.ts | edited | `gitIgnoredEntries` delegates to `ignoredEntries`, and the `child_process` import is removed; the behaviour is unchanged | T1, revision 1 |
| src/main/workflow/ship.ts | created | `approveResult` and `markDone`: the message, the Git state line, the allowed set, the push retry, the rollbacks with re-staging, and the SUMMARY refusals | T2, T3 |
| tests/unit/ship.test.ts | created | Every AC1 refusal with an unchanged state, the commit and message cases, the push failure and retry, the rollbacks with a clean index, mark-done and closed detection, the other-feature close retry | T2, T3 |
| src/main/human/ship-handlers.ts | created | `createShipHandlers`: fixed refusals, never throws, `onLockChanged` after every call | T4 |
| src/main/index.ts | edited | Registers `approve-result` and `mark-done` in `startSpecLock`, with `controllerNode` from `buildControllers` | T4 |
| tests/unit/ship-handlers.test.ts | created | The refusals, a thrown error, the controller check, the lock refresh, through the channel with and without a gesture | T4 |
| src/main/workflow/job-runner.ts | edited | `onRuleEvent`: every decision, passed to `makeToolRunner`, a throwing callback caught | T5 |
| tests/unit/job-runner.test.ts | edited | Four AC6 tests | T5 |
| tests/unit/build-loop.test.ts | edited | A build-loop run on a temp git repo: `git commit` denied, and the log and index unchanged | T6 |
| tests/unit/git-boundary.test.ts | created | AC3 scans: only `git.ts` runs git, no agent or shared file names it, no git tool | T6, revision 1 |
| CHANGELOG.md | edited | Git module, Ship and close, Rule events (Added); the `protect.ts` move (Changed) | T7 |
| docs/decisions.md | edited | D38 | T7 |
| docs/workflow-engine.md | edited | The "Ship and close" section and related cross-references | T7 |
| docs/human-actions.md | edited | The status, the registration, and a "The ship handlers" section | T7 |
| CLAUDE.md | edited | D1–D38, the engine line, the git rule cites D38 | T7 |
| README.md | edited | D1–D38 | T7 |
| docs/PRD.md | edited | F2 "Nothing is committed before the user approves the result" ticked | T7 |
| docs/workflow.md | edited | The push retry after approval | T7 |
| docs/phases/phase-03-workflow-engine.md | edited | The p3-ship subtask note | T7 |
| docs/phases/phase-03-progress.md | edited | D38; the p3-build-loop Rule-event follow-up resolved (its wiring part still open); the "From p3-ship" follow-ups | T7 |

Workflow files (group 2):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| docs/specs/p3-ship/PLAN.md | created | Approved plan | n/a |
| docs/specs/p3-ship/SPECS.md | created | Approved spec, revised in revision 1 | n/a |
| docs/specs/p3-ship/SUBTASK.md | created | Child-ticket draft (no tracker) | n/a |
| docs/specs/p3-ship/tasks.md | created | T1–T8 ticked; T1–T4 and T6 redone in revision 1 | T1–T8 |
| docs/specs/p3-ship/build-ledger.md | created | Build ledger | n/a |
| docs/specs/p3-ship/changes.md | created | The implementor's file record and stale-doc check | n/a |
| docs/specs/p3-ship/SUMMARY.md | created | This report | n/a |

Git and `changes.md` agree: every changed or new file git shows is listed, and every listed file shows in git.

## Acceptance criteria

| AC | Status | Evidence |
| --- | --- | --- |
| AC1 | Pass | `ship.test.ts`: each refusal leaves the tree, the index, HEAD and SUMMARY unchanged. `ship-handlers.test.ts` reaches the handlers through the D33 channel, and they are refused without a gesture. |
| AC2 | Pass | `ship.test.ts`: the committed SUMMARY has the approved line, only the allowed paths are committed, the message is tested with and without a ticket and with each fallback, and the bare remote has the commit with its upstream set. |
| AC3 | Pass | `git-boundary.test.ts` (only `git.ts` imports `child_process` to run git, and `protect.ts` no longer does; no agent or shared file names it; no git tool). The `build-loop.test.ts` temp-repo run is unchanged, and a scripted `git commit` is denied. |
| AC4 | Pass | `ship.test.ts`: a missing remote gives the fixed `pushKept` reason with the commit kept, and the retry pushes with no new commit. The reviewer found no reason or log line that echoes a value. |
| AC5 | Pass | `ship.test.ts`: refused before approval and before the push; the close commit holds only SPECS.md and the state-file removal, and is pushed; the folder detects as closed; the other-feature state is untouched in the close retry; a failed close commit restores both files with a clean index. |
| AC6 | Pass | `job-runner.test.ts`: allow and deny events with the target, and a throwing callback does not fail the run. |
| AC7 | Pass | CLOSE goes through `transition('build-done','CLOSE')`, approve-result raises no event, other nodes refuse, and `src/shared/workflow.ts` is unchanged. |
| AC8 | Pass | Every listed doc is updated (see Files changed). CHANGELOG entries are top-level bullets, and the stale-doc check is in `changes.md`. A cosmetic note: the three p3-ship bullets sit between the Build loop bullet and the other D37 bullets in [Unreleased]. |
| AC9 | Pass locally | Orchestrator re-run: typecheck, lint and format:check pass, and `pnpm test` gave 75 files, 1562 passed and 15 skipped. The temp-repo tests use local bare remotes only. CI is checked on the PR. |

## Needs a runtime check

- CI on the pull request: `check`, and `e2e` on Windows, macOS and Linux. The temp-repo tests need git on every runner.
- A close retry pushes any unpushed commit without checking that it is the close commit.
- In a project that gitignores `docs/specs/.sdd-state.json`, staging the removed state file may fail, and the close would roll back with "the commit failed".
- `logRuleEvent(log)` is not wired in the app until a job runner is built there.
- The 1,000-entry `list_files` test (`tool-files.test.ts`) timed out once at 5 s under load in revision 0's full run. It passed in both later full runs.

## Review ledger

Covers every revision, copied from `docs/specs/p3-ship/build-ledger.md`.

### Revision 0, implement step (paused before any review)

The implementor finished T1–T5 and reported a NEEDS-SPEC-CHANGE at T6. No review ran. See Spec revisions.

### Revision 1, round 1 (PASS)

| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| ------- | -------- | -------- | -------------------- | --------- | ------ |
| (none)  |          |          |                      |           |        |

## Spec revisions

- **Revision 1**, from the implement step of revision 0. AC3's scan failed on the existing read-only `git ls-files` in `src/main/commands/protect.ts` (D31). The user chose **Revise the spec**:
  - the query moves into `git.ts` as `ignoredEntries`, with the same behaviour, so AC3 holds as written;
  - AC5's other-feature case is reworded to the close-retry path;
  - three of the implementor's decisions are recorded in the Design: a missing SUMMARY or Git state line refuses; a failed commit restores and re-stages; `onLockChanged` runs after every ship call.

  The decisions are under the spec's Open questions.

## Rejected findings

none

## Open issues

none

Noted, not defects:

- `index.ts` builds no job runner, so the Rule events are not logged in the app yet (progress follow-up).
- The handlers are registered only with a project root (`HARNESS_SPIKE_ROOT`), like the spec handlers.
- A process slip in revision 0: the implementor appended tests to `job-runner.test.ts` with a Bash heredoc. The content was reviewed and passes.

## Git state

Branch `feature/p3-ship`; approved; committed and pushed in the commit that adds this report.

## Next steps

Approve, then commit and push. A pull request is merged only when CI is green on every job. Then run `/sdd:close`.
