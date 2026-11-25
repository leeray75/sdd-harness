# Build ledger: p3-headless-e2e

state: done
revision: 1
resume on approve: no
current round: 2 of 3, in revision 1
phase: reviewing
Implementor: ad94fc684962e0932, haiku    Reviewer: ab952fd5294982c5a, sonnet
Data agent: none yet
Models: chosen by the user at the start of the build; reused on resume, not asked again.
Respawns: none

## Implementation, revision 0 (Mode 1)

- Done: T1 (ticked): `src/main/workflow/app-runner.ts` and `tests/unit/app-runner.test.ts`.
- Partial: T2. Six of the seven p3-ship fixtures are written and equal `git show c580d56` output (`cmp`). The subagent's Write tool refused `SUMMARY.md` ("subagents should return findings as text, not write report files"). The README is not updated yet.
- Not started: T3–T8.
- Checks: `pnpm typecheck` pass; `vitest run tests/unit/app-runner.test.ts` 1 passed.
- Concerns: none beyond the spec problems below. No product code changed apart from `app-runner.ts`.

## Implementation, revision 1 (Mode 3)

- Done: T1–T5 and T7, ticked. The orchestrator wrote the `SUMMARY.md` fixture (the subagent's Write tool refuses report-named files), and the implementor verified it.
- T6: the walk passes, ship and close included. The literal check `git diff --stat main -- src` lists nothing, because `app-runner.ts` is untracked. `git status --short -- src` lists only that file. Left unticked with a note.
- T8: typecheck, lint and format:check pass. In 3 full `pnpm test` runs: 1575 passed, 15 skipped, and 1–3 failed, all in `tool-files.test.ts`, the `list_files` 1,000-entry cap tests at the 5 s timeout. Alone, that file passes (44 passed, 2 skipped, 3.9 s). This is the known p3-ship flake, in a file outside this spec.
- Checks: app-runner 1, plugin-folder-states 11, headless-e2e 1 (120 s timeout), all passing. The orchestrator re-ran the three: 13 passed.
- Notes: after `resume('revise')` the folder scans as `paused` until SPECS.md is edited, while the controller reads `spec-changed`. This is recorded in the "Headless run" section and the progress follow-ups. `index.ts` does not call the factory, as the spec says.

## Revision 1, round 1 (ISSUES)

| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| R1-1 | minor | docs/PRD.md F2 item 1; phase-03 doc DoD item 1 | ACCEPT | The walk never reaches the limit; `build-loop.test.ts` covers it | The PRD item names only `build-loop.test.ts`; the DoD item maps each F2 item to its own test |
| R1-2 | minor | tests/unit/headless-e2e.test.ts:478-489 | ACCEPT | The spec and the "Headless run" text claim the property | Added: no line in `walk.log.info` or `walk.log.error` includes `tampered` or `value = ` |

Also: T6 ticked by the orchestrator's instruction (evidence in `changes.md`). T8 left unticked, and `tool-files.test.ts` untouched. Checks: headless-e2e and build-loop 35 passed; typecheck, eslint and prettier pass.

- R1-1: The F2 round-limit item cites the headless walk, which never reaches the limit; only `build-loop.test.ts` covers it.
- R1-2: The walk does not assert that no rule-log line holds file content (only `app-runner.test.ts` does).
- The reviewer's bookkeeping notes: T6's intent is met (the only `src` change is the untracked `app-runner.ts`). T8 and AC9 are blocked only by the out-of-scope `tool-files.test.ts` flake.
- Needs a runtime check: the walk on the macOS and Linux CI runners; the `tool-files` flake in CI.

## Revision 1, round 2 (PASS)

| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| ------- | -------- | -------- | -------------------- | --------- | ------ |
| (none)  |          |          |                      |           |        |

Both round 1 findings are fixed: the PRD and the phase doc cite only `build-loop.test.ts` for the round limit, and `headless-e2e.test.ts` lines 490–493 assert that no log line holds content. The reviewer confirmed T6's evidence. Needs a runtime check: the walk's 120 s timeout on the macOS and Linux runners; the `tool-files` flake under load.

After the PASS, the orchestrator re-ran the checks. typecheck, lint and format:check pass, and `pnpm test` gave 78 files, 1576 passed and 15 skipped, with no failure. T8 was ticked on that evidence. Git and `changes.md` agree.

## Spec problems

- Revision 0 pause, from the implement step (T2/T3, reported before T3 started; the orchestrator confirmed both items):
  1. AC6 and the Design say the fixtures "equal `git show c580d56` output" in a test. `.github/workflows/ci.yml` uses `actions/checkout@v7` with no `fetch-depth`, a shallow clone, so `c580d56` is absent in CI and the test would fail there. User chose: **Revise the spec**; revision 1 decision: recorded SHA-256 values. Candidates were: (a) compare against SHA-256 values recorded in the test, taken from `git show c580d56` now; (b) set `fetch-depth: 0` in the `check` job; (c) skip the comparison when the commit is absent.
  2. Design, step 4: "The person asks to edit through the channel's `edit-approved-spec` (spec-changed)". After `resume('revise')` the controller is at `spec-changed`; `edit-approved-spec` calls `requestEdit()`, which raises `EDIT_SPEC`, legal only from `spec-approved` (`src/shared/workflow.ts:98`), so it is refused. User chose: **Revise the spec**; revision 1 decision: the walk asserts the refusal and edits SPECS.md directly, and a successful `edit-approved-spec` is shown at spec-approved before the controller exists. Candidates were: (a) reword step 4: the test edits SPECS.md directly (the lock reads `changed` by hash, D36), and checks that `edit-approved-spec` is refused there; the channel edit is covered by a separate check at spec-approved before the build; (b) change the controller to allow the edit after a revise (a product change, against AC7); (c) the walk's `onEditRequested` answers ok, unlike `index.ts`.

## Carried findings

none (a Mode 1 pause carries none)
