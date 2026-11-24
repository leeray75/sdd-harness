# Run the build loop: writer and reviewer rounds, round limit, spec-problem pause, change rounds, ledger and SUMMARY

**Parent:** none: no parent chosen
**Spec:** docs/specs/p3-build-loop/SPECS.md
**Repo and base branch:** sdd-harness, main, feature branch feature/p3-build-loop

## Context

The app can lock an approved spec (D36) and detect a folder's node (D35), but nothing runs a build (F2, D4). This work adds:

- **The build controller,** a main-side controller. It runs the writer in Mode 1, then review round n, then a decision. ISSUES goes to the writer in Mode 2 with every finding, and then a new review follows.
  - **Round limit:** 3 by default, and a build option can lower it but never raise it.
  - **Spec problems** pause the build, with the other findings carried. The person then chooses `continue`, `revise` (re-approval, then Mode 3 and a reset counter) or `stop`. There is no revision cap.
  - **User change rounds** are not counted against the limit.
- **The app's documents:** `build-ledger.md` and `SUMMARY.md` in the plugin's formats, read by `parseLedger` and `detectFolder`.
- **The writer's files:** the writer keeps `changes.md` and ticks `tasks.md`. The gate allows it only those two files of its own feature (amends D30).
- **Two workflow events,** CONTINUE and STOP_BUILD (amends D34). EDIT_SPEC is wired to `edit-approved-spec`.
- **The job runner:** an injected `JobRunner`, with an in-process runner. Each job keeps its history across rounds and has a larger turn cap. The report parsers read the writer's and reviewer's formats.
- **A scripted provider** for headless tests.

Agents never run git, and the loop commits nothing. The docs, with D37, are updated in the same change.

## Required work

- T1 Loop options
- T2 Report parsers
- T3 Build documents
- T4 Workflow events
- T5 Gate
- T6 Scripted provider and job runner
- T7 Build controller
- T8 EDIT_SPEC wiring
- T9 Docs
- T10 Full checks

## Acceptance criteria

- **AC1: Rounds.** PASS in round 1 ends Clean. ISSUES, then a fix, then PASS ends Clean in 2 rounds. ISSUES at round 3 ends with open issues, and there is no fourth review. The events follow the table, and each job continues its own history.
- **AC2: Round limit.** The default is 3, and 1–3 is honoured. 0, 4, 2.5, `'3'` and `null` are refused before anything runs.
- **AC3: Pause.** A spec problem from either job pauses the build, with the other findings carried. `continue` resumes without a counter reset. `stop` ends with "stopped by the user". `revise` waits for re-approval, then runs Mode 3 with the carried findings and restarts at round 1. There is no revision cap, and wrong-time calls are refused.
- **AC4: Change rounds.** U<n> rounds go to the same writer and reviewer, are recorded in the ledger, and are not counted against the limit.
- **AC5: Documents.**
  - The ledger detects as implementing or reviewing with the round, as paused, or as build-done, and round-trips through `parseLedger`.
  - SUMMARY has every section.
  - The writer may write only its feature's `tasks.md` and `changes.md`. No agent may write the ledger, SUMMARY, SPECS.md or the state file.
- **AC6: Events.** CONTINUE and STOP_BUILD are user events. Illegal calls are refused and change nothing. `edit-approved-spec` leads to EDIT_SPEC from `spec-approved`, and is refused during a build.
- **AC7: No git, no commit.** A scripted `git commit` is denied, and no new module runs git.
- **AC8: Loop and reports.** The loop's default of 4 turns is unchanged. `maxTurns`, `history` and `messages` work. The parsers cover every format, the bad input and the caps, and an unreadable report is asked for once again.
- **AC9: Docs.** In the build on the feature branch:
  - the CHANGELOG entry;
  - D37 (amending D30 and D34);
  - a "Build loop" section in `docs/workflow-engine.md`;
  - `docs/agent-jobs.md`;
  - stale docs checked and updated: `CLAUDE.md`, `README.md`, the PRD (the F2 round-limit item ticked), `workflow.md`, the phase-03 doc and the progress follow-ups, recorded in `changes.md`.
- **AC10: Checks.** The shared modules pass the import scan. typecheck, lint, format:check and test pass. CI on the PR is green on every job before the merge.

## Out of scope

- approve-result, commit, push, mark-done, and clearing the state on close (`p3-ship`).
- Agent-process IPC for jobs, and the full headless end-to-end test (`p3-headless-e2e`).
- Any UI.
- Storing the round limit in project settings.
- The data-agent overlay in builds.
- Tracker writes (D8).
- Changing the plugin.

## Links

- Plan: docs/specs/p3-build-loop/PLAN.md
- Spec and tasks: docs/specs/p3-build-loop/SPECS.md, docs/specs/p3-build-loop/tasks.md
