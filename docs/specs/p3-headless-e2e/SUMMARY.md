# Summary Report: p3-headless-e2e

Ticket: none Date: 2026-11-25
Outcome: Clean
Review rounds: 2 of 3 in revision 1 (no review ran in revision 0); revisions: 1 of 2
Models: implementor haiku; reviewer sonnet; data agent not used (all chosen by the user); respawns: none

## What was built

- **The headless walk (G1, G2):** `tests/unit/headless-e2e.test.ts` drives one feature from planning to closed, on a temp git repo with a local bare `origin`, and with no network.
  - **What runs:** the real channel, spec handlers, ship handlers and build controller, the scripted provider, the real gate and real tools.
  - **The build:** an ISSUES round and its fix, a spec-problem pause that is revised and re-approved, a passing review, and one change round.
  - **The ship:** `approve-result` makes one pushed commit, and `mark-done` makes the pushed close.
  - **The git state:** it is unchanged after every step before `approve-result`.
- **The app runner factory (G3):** `createAppJobRunner` builds the in-process runner with the root's live policy context and `logRuleEvent(log)`. Every runner the app builds then logs every rule event. Nothing in `index.ts` calls it yet.
- **Plugin folders in every state (G4):** p3-ship's seven plugin-written files are copied byte for byte from `c580d56` and checked by recorded SHA-256 values. Each detector state, from planning to closed, opens at its node and stage through the scanner.
- **D39 (G5):** build jobs run in the main process for v1.
- **Docs (G6):** updated in the same change. Phase 3's Definition of done is ticked, with the evidence for each item.

## Files changed

Product files (group 1):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/main/workflow/app-runner.ts | created | `createAppJobRunner`: the in-process runner with the root's command context read live, and every rule event to `logRuleEvent(log)` (D39) | T1 |
| tests/unit/app-runner.test.ts | created | AC5: each decision reaches the logger as its `formatRuleEvent` line, no line holds content, and the live supplier is read per call | T1 |
| tests/fixtures/sdd-plugin/specs/p3-ship/PLAN.md | created | Byte copy from `c580d56` | T2 |
| tests/fixtures/sdd-plugin/specs/p3-ship/SPECS.md | created | Byte copy from `c580d56` | T2 |
| tests/fixtures/sdd-plugin/specs/p3-ship/tasks.md | created | Byte copy from `c580d56` | T2 |
| tests/fixtures/sdd-plugin/specs/p3-ship/SUBTASK.md | created | Byte copy from `c580d56` | T2 |
| tests/fixtures/sdd-plugin/specs/p3-ship/build-ledger.md | created | Byte copy from `c580d56` | T2 |
| tests/fixtures/sdd-plugin/specs/p3-ship/changes.md | created | Byte copy from `c580d56` | T2 |
| tests/fixtures/sdd-plugin/specs/p3-ship/SUMMARY.md | created | Byte copy from `c580d56`, written by the orchestrator, because the subagent's Write tool refuses a report-named file; verified with `cmp` | T2, revision 1 |
| tests/fixtures/sdd-plugin/README.md | edited | The p3-ship folder, its commit and the SHA-256 check | T2, revision 1 |
| tests/unit/plugin-folder-states.test.ts | created | AC6: the recorded SHA-256 values, and one case per state from planning to closed | T3, revision 1 |
| tests/unit/headless-e2e.test.ts | created | The walk, steps 1–7 (AC1–AC4), with a 120 s timeout; R1-2 adds the no-content log check | T4–T6, R1-2 |
| CHANGELOG.md | edited | Four Added bullets: the factory, the walk, the plugin folders, and where jobs run (D39) | T7 |
| docs/decisions.md | edited | D39 | T7 |
| docs/workflow-engine.md | edited | The "Headless run" section and the code map | T7 |
| docs/agent-jobs.md | edited | "Where the jobs run" (D39) | T7 |
| CLAUDE.md | edited | D1–D39, and the engine line names "Headless run" | T7 |
| README.md | edited | D1–D39 | T7 |
| docs/PRD.md | edited | Each F2 acceptance item names its test; the round-limit item names only `build-loop.test.ts` (R1-1) | T7, R1-1 |
| docs/workflow.md | edited | One sentence: where the build's jobs run (D39) | T7 |
| docs/phases/phase-03-workflow-engine.md | edited | The subtask note; the three Definition of done items ticked, each mapped to its tests (R1-1) | T7, R1-1 |
| docs/phases/phase-03-progress.md | edited | D39; the IPC and rule-log follow-ups resolved as far as this phase goes; the "From p3-headless-e2e" block | T7 |

Workflow files (group 2):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| docs/specs/p3-headless-e2e/PLAN.md | created | Approved plan | n/a |
| docs/specs/p3-headless-e2e/SPECS.md | created | Approved spec, revised in revision 1 | n/a |
| docs/specs/p3-headless-e2e/SUBTASK.md | created | Child-ticket draft (no tracker) | n/a |
| docs/specs/p3-headless-e2e/tasks.md | created | T1–T8 ticked; T2–T5 revised in revision 1; T6 and T8 ticked on the orchestrator's evidence | T1–T8 |
| docs/specs/p3-headless-e2e/build-ledger.md | created | Build ledger | n/a |
| docs/specs/p3-headless-e2e/changes.md | created | The implementor's file record, the round 1 analysis and the stale-doc check | n/a |
| docs/specs/p3-headless-e2e/SUMMARY.md | created | This report | n/a |

Git and `changes.md` agree: every changed or new file git shows is listed, and every listed file shows in git.

## Acceptance criteria

| AC | Status | Evidence |
| --- | --- | --- |
| AC1 | Pass | `headless-e2e.test.ts` runs the seven steps and checks each node from planning to closed. It runs on a temp repo with a bare remote and a scripted provider. |
| AC2 | Pass | All four human actions go through `createHumanActionChannel` with a gesture. `approve-spec` without one returns `no-gesture`, and the spec and the lock are unchanged (reviewer). |
| AC3 | Pass | The base snapshot (HEAD, commit count, remote refs) is compared after every step before `approve-result`. After it: one commit on the remote, with the `{ticket}: {summary}` message, and only allowed paths. After `mark-done`: one more commit (SPECS.md modified, the lock deleted), and the folder detects as closed. |
| AC4 | Pass | The scripted write to the approved SPECS.md is denied, and the file is unchanged. The allow and deny log lines are asserted, and no line holds content (R1-2). |
| AC5 | Pass | `app-runner.test.ts`: the `formatRuleEvent` lines, and the live supplier read on each call. |
| AC6 | Pass | `plugin-folder-states.test.ts`: the seven recorded SHA-256 values (the reviewer recomputed them against `git show c580d56`), and 10 states at their node and stage. |
| AC7 | Pass | `git diff --stat -- src` is empty. The only new `src` file is `app-runner.ts`. |
| AC8 | Pass | Every listed doc is updated, the CHANGELOG entries are top-level bullets, D39 matches the spec, and the stale-doc check is in `changes.md`. |
| AC9 | Pass locally | Orchestrator re-run: typecheck, lint and format:check pass, and `pnpm test` gave 78 files, 1576 passed and 15 skipped. In the implementor's three earlier full runs, 1–3 `tool-files.test.ts` tests timed out at 5 s under load (out of scope; see Open issues). CI is checked on the PR. |

## Needs a runtime check

- CI on the pull request: `check`, and `e2e` on Windows, macOS and Linux. The walk (120 s timeout) and the temp-repo git defaults have run only on Windows so far.
- The `tool-files.test.ts` 1,000-entry `list_files` tests under full-suite load, locally and in CI.
- After `resume('revise')`, the folder scans as `paused` until SPECS.md is edited, while the controller reads `spec-changed`. This is documented in "Headless run". A UI built on the scanner should allow for it.

## Review ledger

Covers every revision, copied from `docs/specs/p3-headless-e2e/build-ledger.md`.

### Revision 0, implement step (paused before any review)

The implementor finished T1 and part of T2, then reported two spec problems before T3. No review ran. See Spec revisions.

### Revision 1, round 1 (ISSUES)

| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| R1-1 | minor | docs/PRD.md F2 item 1; phase-03 doc DoD item 1 | ACCEPT | The walk never reaches the round limit; `build-loop.test.ts` covers it | The PRD item names only `build-loop.test.ts`; the DoD item maps each F2 item to its own test |
| R1-2 | minor | tests/unit/headless-e2e.test.ts:478-489 | ACCEPT | The spec and "Headless run" claim no log line holds content | Added an assertion that no logged line includes `tampered` or `value = ` |

### Revision 1, round 2 (PASS)

| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| ------- | -------- | -------- | -------------------- | --------- | ------ |
| (none)  |          |          |                      |           |        |

## Spec revisions

- **Revision 1**, from the implement step of revision 0. The user chose **Revise the spec**:
  - **The fixture check:** CI's checkout is shallow, so `c580d56` is absent there. The test compares each fixture with a SHA-256 recorded from `git show c580d56`, and runs no git.
  - **The revise edit:** `edit-approved-spec` is refused at spec-changed, because `EDIT_SPEC` is legal only from spec-approved. The walk asserts the refusal and edits SPECS.md directly, and the lock reads `changed` by hash. A successful `edit-approved-spec` and re-approval are shown before the controller exists. No product code changed.

  The decisions are under the spec's Open questions.

## Rejected findings

none

## Open issues

none

Noted, not defects:

- **The flaky `tool-files.test.ts` tests:** 1–3 of the 1,000-entry `list_files` cap tests timed out at 5 s in each of the implementor's three full runs. The file passes alone, and the orchestrator's final full run had no failure. The file is outside this spec and was not changed. This is the same flake the p3-ship progress follow-up names.
- **The `SUMMARY.md` fixture** was written by the orchestrator, because the subagent's Write tool refuses report-named files. It is verified byte for byte.
- **No runner in the app:** `index.ts` builds no runner or controller, so the factory is used only by tests until the build start.

## Git state

Branch `feature/p3-headless-e2e`; approved; committed and pushed in the commit that adds this report.

## Next steps

Approve, then commit and push. A pull request is merged only when CI is green on every job. Then run `/sdd:close`. After the merge, the phase is closed: the roadmap, and the phase summary in the progress file.
