# Summary Report: p2-fix-e2e-selfcheck
Ticket: none   Date: 2026-11-20
Outcome: Clean
Review rounds: 1 of 3 per revision; revisions: 0 of 2
Models: implementor haiku; reviewer sonnet; data agent not used (all chosen by the user); respawns: none

## What was built

- **G1 (test):** `tests/e2e/agent-process.spec.ts` now checks D30's behaviour:
  - main's `rule blocked` line for the writer's `write_file` self-check, with `target=selfcheck.txt` and the "edited only after the spec is approved" reason;
  - the agent's denied result with the same reason;
  - that `probe-body` never appears;
  - that no `rule` line contains the absolute repo root, in either slash form, with a guard that such lines exist.
- **G2 (green CI):** the test passes locally on Windows. It needs the pull request's CI run to show green on macOS and Linux.
- **G3 (no repeat):** `CLAUDE.md` Conventions and step 6 of the phase doc now say that a pull request is merged only when its CI run is green on every job, and that approval and close messages state the CI state with a link.

## Files changed

Product files (group 1):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| tests/e2e/agent-process.spec.ts | edited | New title and comments, the D30 Rule-line and agent-result patterns, the `probe-body` check and the no-absolute-root check. The `selfcheck.txt` ban is removed (AC1–AC4) | T1 |
| CHANGELOG.md | edited | A Fixed entry under `[Unreleased]` (AC6) | T3 |
| CLAUDE.md | edited | The CI-green merge rule in Conventions (AC6) | T3 |
| docs/phases/phase-02-tool-policy.md | edited | The same rule in step 6 (AC6) | T3 |
| docs/phases/phase-02-progress.md | edited | Row 3a (pending) and the follow-up: CI was red from PR #14 through #15 (AC6) | T3 |

`README.md`, `docs/PRD.md` and `docs/workflow.md` were checked and left unchanged. The reasons are in `changes.md`. The README's "D1–D20" line was already stale before this fix and is out of scope.

Workflow files (group 2):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| docs/specs/p2-fix-e2e-selfcheck/PLAN.md | created | Approved plan | planning |
| docs/specs/p2-fix-e2e-selfcheck/SPECS.md | created | Approved spec | planning |
| docs/specs/p2-fix-e2e-selfcheck/SUBTASK.md | created | Child-ticket draft, not published (no tracker) | planning |
| docs/specs/p2-fix-e2e-selfcheck/tasks.md | created | T1–T4, all ticked | T1–T4 |
| docs/specs/p2-fix-e2e-selfcheck/build-ledger.md | created | Build ledger | build |
| docs/specs/p2-fix-e2e-selfcheck/changes.md | created | Change rows, the T2 result and the stale-doc table | build |
| docs/specs/p2-fix-e2e-selfcheck/SUMMARY.md | created | This report | build |

## Acceptance criteria

| AC | Status | Evidence |
| --- | --- | --- |
| AC1 Rule line | Met | The pattern matches `gate.ts:37-38` (reason), `rule-event.ts:166` (format) and `log.ts` (prefix). The reviewer confirmed it against the source |
| AC2 agent result | Met | `src/agent/index.ts` prints the denied result, and `router.ts:90-98` passes the reason through |
| AC3 no leak | Met | The `probe-body` check is kept. The root check covers both slash forms and asserts that at least one `rule` line exists, so it isn't vacuous |
| AC4 wording | Met | New title and comments. The pid and clean-exit checks are unchanged |
| AC5 other specs | Met | Only `spike-agent.spec.ts` has log expectations, and `router.ts:118` still emits them. Local `pnpm e2e`: 15 passed, 2 skipped, 0 failed |
| AC6 docs | Met | CHANGELOG, `CLAUDE.md`, phase doc step 6, the progress row and follow-up, and the stale-doc table |
| AC7 checks | Met locally; CI pending | The orchestrator re-ran typecheck, lint, format:check and test: 46 files, 1030 passed, 12 skipped. The PR's CI must be green on all three OSes before the merge |

## Needs a runtime check

- **The PR's CI run:** the `e2e` job must be green on Windows, macOS and Linux. Only Windows was run locally. On macOS and Linux, a second failure could have been hidden behind the first one.

## Review ledger

### Revision 0, round 1  (PASS)

| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| (none) | | | | | |

The reviewer opened the changed test file in full and checked each expected line against the source.

## Spec revisions

none

## Rejected findings

none

## Open issues

none

## Git state

feature/p2-fix-e2e-selfcheck; approved; committed and pushed in the commit that adds this report

## Next steps

Approve, then commit and push, open the PR, and check that its CI is green before you merge. Or request changes, or say not yet.
