# Summary Report: p4-ci-linux-fix-2

Ticket: none   Date: 2026-11-26
Outcome: Clean
Review rounds: 1 of 3 per revision; revisions: 0 of 2
Models: implementor haiku; reviewer sonnet; data agent not used (all chosen by the user); respawns: none

## What was built

The last `check (Linux)` failure (`env-recording.test.ts:190`, the WSL `run_command` case) came from a fixture that is not executable on a Linux host. The WSL `beforeAll` now writes `share/usr/bin/tool` with mode `0o755`, so the program lookup's `X_OK` check passes on Linux as it already did on Windows (G1). No product code and no assertion changed.

## Files changed

Product files (group 1):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| tests/unit/env-recording.test.ts | edited | The WSL `beforeAll` writes `share/usr/bin/tool` with `{ mode: 0o755 }`; no assertion changed | T1 |
| CHANGELOG.md | edited | `[Unreleased]` Fixed line for the last Linux CI case | T2 |
| docs/phases/phase-04-progress.md | edited | The "Linux CI failures" follow-up names `p4-ci-linux-fix-2` for the `run_command` case | T2 |

Workflow files (group 2):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| docs/specs/p4-ci-linux-fix-2/PLAN.md | created | The approved plan | plan |
| docs/specs/p4-ci-linux-fix-2/SPECS.md | created | The approved spec | plan |
| docs/specs/p4-ci-linux-fix-2/SUBTASK.md | created | Child-ticket draft (no tracker) | plan |
| docs/specs/p4-ci-linux-fix-2/tasks.md | created | T1–T3, all ticked | plan, all |
| docs/specs/p4-ci-linux-fix-2/build-ledger.md | created | The build ledger | build |
| docs/specs/p4-ci-linux-fix-2/changes.md | created | The implementor's record | build |
| docs/specs/p4-ci-linux-fix-2/SUMMARY.md | created | This report | build |

Git and `changes.md` agree. `bash.exe.stackdump` is untracked, predates the work, and is left out of the commit.

## Acceptance criteria

| AC | Status | Evidence |
| --- | --- | --- |
| AC1 executable fixture, no assertion changed | Met | `git diff main -- tests/` shows the one setup line; the reviewer confirmed it. The temp base is fresh (`mkdtempSync`), so the mode always applies |
| AC2 docs | Met | CHANGELOG Fixed line; the progress follow-up |
| AC3 checks | Met locally; CI pending | typecheck, lint, format:check; `pnpm test` 1892 passed, 18 skipped. The pull request's `check (Linux)` job is checked after the push |

## Needs a runtime check

- The pull request's `check (Linux)` job.

## Review ledger

### Revision 0, round 1 (PASS)

No findings.

## Spec revisions

None.

## Rejected findings

None.

## Open issues

None.

## Git state

feature/p4-ci-linux-fix-2; approved; committed and pushed in the commit that adds this report.

## Next steps

Approve, commit and push; or request changes; or not yet. After the push, open the pull request and merge only when `check (Linux)` is green.
