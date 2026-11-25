# Changes: p3-headless-e2e

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| `src/main/workflow/app-runner.ts` | created | The app's job runner factory: `createAppJobRunner` builds the in-process runner with the root's command context read live, and every rule event to `logRuleEvent(log)` (D30, D31, D36, D39). | T1 |
| `tests/unit/app-runner.test.ts` | created | AC5: each gate decision reaches a recording logger as its `formatRuleEvent` line, no line holds file content, and a change in the live supplier is seen by the next call. | T1 |
| `docs/specs/p3-headless-e2e/tasks.md` | edited | Ticked T1 after its check passed. | T1 |
| `tests/fixtures/sdd-plugin/specs/p3-ship/PLAN.md` | created | Byte-for-byte copy of `docs/specs/p3-ship/PLAN.md` at `c580d56` (checked with `git show` and `cmp`). | T2 |
| `tests/fixtures/sdd-plugin/specs/p3-ship/SPECS.md` | created | Byte-for-byte copy of `docs/specs/p3-ship/SPECS.md` at `c580d56` (checked with `git show` and `cmp`). | T2 |
| `tests/fixtures/sdd-plugin/specs/p3-ship/tasks.md` | created | Byte-for-byte copy of `docs/specs/p3-ship/tasks.md` at `c580d56` (checked with `git show` and `cmp`). | T2 |
| `tests/fixtures/sdd-plugin/specs/p3-ship/SUBTASK.md` | created | Byte-for-byte copy of `docs/specs/p3-ship/SUBTASK.md` at `c580d56` (checked with `git show` and `cmp`). | T2 |
| `tests/fixtures/sdd-plugin/specs/p3-ship/build-ledger.md` | created | Byte-for-byte copy of `docs/specs/p3-ship/build-ledger.md` at `c580d56` (checked with `git show` and `cmp`). | T2 |
| `tests/fixtures/sdd-plugin/specs/p3-ship/changes.md` | created | Byte-for-byte copy of `docs/specs/p3-ship/changes.md` at `c580d56` (checked with `git show` and `cmp`). | T2 |
| `tests/fixtures/sdd-plugin/specs/p3-ship/SUMMARY.md` | created | Byte-for-byte copy of `docs/specs/p3-ship/SUMMARY.md` at `c580d56`. Written by the orchestrator, because the subagent Write tool refused a report-named file; verified with `cmp` against `git show`, round 1 of revision 1. | T2, revision 1 |
| `tests/fixtures/sdd-plugin/README.md` | edited | Adds the p3-ship folder: its source, the commit `c580d56`, the seven files, and the SHA-256 check that replaces `git show` in CI (shallow checkout). | T2, revision 1 |
| `docs/specs/p3-headless-e2e/tasks.md` | edited | Ticked T2 after its check passed (the seven copies match `git show c580d56`). | T2, revision 1 |
| `tests/unit/plugin-folder-states.test.ts` | created | AC6: the seven fixtures match the SHA-256 values recorded in the test (no git run, so CI's shallow checkout is fine), and one case per state in the Design's table (planning to closed) opens at its node and stage through the app's scanner, each built in a temp root with at most one line edit. Formatted with Prettier. | T3, revision 1 |
| `docs/specs/p3-headless-e2e/tasks.md` | edited | Ticked T3 after its check passed (11 passed). | T3 |
| `tests/unit/headless-e2e.test.ts` | created | The headless walk on a temp repo with a bare origin: the repo helper, the channel with the real spec and ship handlers and a gesture tracker, the app's job runner with the scripted provider, and the git snapshot. Steps 1 to 7 of the Design, with the node checked after each step, the gesture refusal, the denied SPECS.md write, the ISSUES fix, the spec-change pause, the refused edit at spec-changed, the direct edit, the re-approval, the resumed Mode 3, the change round, the one commit and push on approve-result, and the close commit and push on mark-done. Explicit timeout. | T4, T5, T6 (revision 1) |
| `docs/specs/p3-headless-e2e/tasks.md` | edited | Ticked T4 and T5 after their check passed. T6 is left unticked: its literal check `git diff --stat main -- src` cannot list the untracked `app-runner.ts`; `git status --short -- src` shows only that file. | T4, T5 |
| `CHANGELOG.md` | edited | Under [Unreleased], four top-level bullets in Added: the app runner factory, the headless walk, the plugin folders in every state, and where build jobs run (D39). | T7 |
| `docs/decisions.md` | edited | D39: build jobs run in the main process for v1, with the app's runner factory and its rule-event log; the alternatives and the date. | T7 |
| `docs/workflow-engine.md` | edited | New "Headless run" section (the walk, the steps, the git checks, where the job runner runs, and what the walk shows about revisions); the code map lists the factory and the three new tests. | T7 |
| `docs/agent-jobs.md` | edited | New "Where the jobs run" section (D39): main process, the factory, the spike loop in the agent process, no new IPC. | T7 |
| `CLAUDE.md` | edited | Decision range D1–D39; the engine reading names the Headless run section and where build jobs run (D39). | T7 |
| `README.md` | edited | The decisions range is D1–D39. The status line still says Phase 3 in progress, which is still true. | T7 |
| `docs/PRD.md` | edited | F2's three acceptance items each name the test that checks them. | T7 |
| `docs/workflow.md` | edited | One sentence: the build's jobs run in the main process and their decisions are logged (D39). | T7 |
| `docs/phases/phase-03-workflow-engine.md` | edited | Subtask 5 note (`p3-headless-e2e`, D39) and the three Definition of done items ticked, each with its evidence. | T7 |
| `docs/phases/phase-03-progress.md` | edited | D39 added under Decisions. The p3-build-loop and p3-ship follow-ups on IPC and the rule-event log are marked resolved as far as this phase goes; a "From p3-headless-e2e" follow-up block is added. The progress table row 6 stays pending until the merge. | T7 |
| `docs/specs/p3-headless-e2e/tasks.md` | edited | Ticked T6 at the orchestrator's instruction, round 1 of revision 1. The literal check `git diff --stat main -- src` is empty, because it cannot list the untracked `app-runner.ts`; `git status --short -- src` lists only that file. | T6, R1 (revision 1 round 1) |
| `tests/unit/headless-e2e.test.ts` | edited | R1-2: asserts that no logged line holds the denied SPECS.md text or the product file text (`tampered`, `value = `). | R1-2, round 1 |
| `docs/PRD.md` | edited | R1-1: the F2 round-limit item now names only `tests/unit/build-loop.test.ts`, because the walk never reaches the round limit. | R1-1, round 1 |
| `docs/phases/phase-03-workflow-engine.md` | edited | R1-1: the Definition of done evidence maps each F2 item to its own test. | R1-1, round 1 |

## Findings analysis, round 1 (revision 1)

- **R1-1 (ACCEPT).** The walk has no round-limit case (its reviews are ISSUES, spec-change, PASS, and a change round), so the walk was not evidence for the round-limit item. Fixed in PRD.md and the phase doc. The round-limit test is `build-loop.test.ts`.
- **R1-2 (ACCEPT).** The walk checked the allow and deny lines, but not that no line holds content. Added the assertion to the walk. It passes.
- **Bookkeeping: T6 (ticked on the orchestrator's instruction).** See the row above.
- **Bookkeeping: T8 (left unticked).** `tests/unit/tool-files.test.ts` is the flake outside this change; per the orchestrator, it is not touched.

## Stale-doc check (T7, AC8)

Checked against the AC8 list and the CLAUDE.md rule on docs:

- `CHANGELOG.md`: four bullets under [Unreleased], top-level, in Added.
- `docs/decisions.md`: D39 added after D38.
- `docs/workflow-engine.md`: the "Headless run" section, and where the job runner runs; the code map and the rule-event note are current.
- `docs/agent-jobs.md`: "Where the jobs run" (D39).
- `CLAUDE.md`: D1–D39, and the engine reading names the Headless run section.
- `README.md`: the decisions range is D1–D39. The status line is still accurate.
- `docs/PRD.md`: F2's three acceptance items each name their test.
- `docs/workflow.md`: one sentence on where the jobs run (D39). The rest was read and is accurate.
- `docs/phases/phase-03-workflow-engine.md`: the subtask 5 note, and the three Definition of done items ticked with evidence.
- `docs/phases/phase-03-progress.md`: D39 under Decisions; the IPC and rule-event follow-ups from p3-build-loop and p3-ship marked resolved as far as this phase goes; a "From p3-headless-e2e" block. Row 6 stays pending until the merge.
- `docs/roadmap.md`: not in the AC8 list. Its Phase 3 status is still "in progress", so no change. The phase summary is written after the merge.
- `tests/fixtures/sdd-plugin/README.md`: the p3-ship folder, its commit and the SHA-256 check (T2).
- `docs/agent-commands.md`: no reference to the job placement, so no change.
- Closed features' records under `docs/specs/`: history, left as written.
