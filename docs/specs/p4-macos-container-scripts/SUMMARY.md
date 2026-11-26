# Summary Report: p4-macos-container-scripts

Ticket: none   Date: 2026-11-26
Outcome: Clean
Review rounds: 1 of 3 per revision; revisions: 0 of 2
Models: implementor haiku; reviewer sonnet; data agent not used (all chosen by the user); respawns: none

## What was built

`tests/unit/container-scripts.test.ts` now probes the host's `stat -c %s` once, through the same POSIX `sh` and on a temp file. Where that fails, it skips only the 6 scenarios that run the stat scripts. This happens on macOS, whose BSD `stat` rejects `-c`. The other 45 scripts and the connect check still run through the host shell, which meets G1. Where `stat -c` works (Linux), all 51 scenarios run as before, which meets G2. No product code changed, and no assertion changed. This unblocks PR #33's macOS unit step.

## Files changed

Product files (group 1):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| tests/unit/container-scripts.test.ts | edited | The `STAT_C` probe, `it.skipIf(!STAT_C)` on the six stat scenarios, and the header comment. No scenario, name, body or `expect` line changed | T1, T4 |
| CHANGELOG.md | edited | `[Unreleased]` Fixed line | T3 |
| docs/phases/phase-04-progress.md | edited | Follow-up: the `realpathSync.native(tmpdir())` wording on PR #33, and the macOS check still to run | T3 |

Workflow files (group 2):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| docs/specs/p4-macos-container-scripts/PLAN.md | created | The approved plan | plan |
| docs/specs/p4-macos-container-scripts/SPECS.md | created | The approved spec | plan |
| docs/specs/p4-macos-container-scripts/SUBTASK.md | created | Child-ticket draft (no tracker) | plan |
| docs/specs/p4-macos-container-scripts/tasks.md | created | T1–T4, all ticked | plan, all |
| docs/specs/p4-macos-container-scripts/build-ledger.md | created | The build ledger | build |
| docs/specs/p4-macos-container-scripts/changes.md | created | The implementor's record | build |
| docs/specs/p4-macos-container-scripts/SUMMARY.md | created | This report | build |

Git and `changes.md` agree. `bash.exe.stackdump` is untracked, predates the work, and is left out of the commit.

## Acceptance criteria

| AC | Status | Evidence |
| --- | --- | --- |
| AC1 scope | Met | `git diff main -- tests/` shows only the probe, the skip and the comment; the reviewer confirmed it |
| AC2 behaviour | Met on Linux and Windows; macOS pending | On Linux (a `node:24` container), 51 of 51 ran with 0 skipped. With a shadow `stat` that refuses `-c`, 45 passed and exactly the 6 stat scenarios were skipped. On Windows the block is skipped as before. The real macOS proof is PR #33's macOS job after this merges |
| AC3 docs | Met | CHANGELOG Fixed line; the progress follow-up |
| AC4 checks | Met locally; CI pending | typecheck, lint, format:check; `pnpm test` 1967 passed, 69 skipped. The pull request's CI is checked after the push |

## Needs a runtime check

- PR #33's macOS unit job, after this merges.
- The Linux run came before a whitespace-only Prettier re-wrap of one line. This pull request's `check (Linux)` job covers that.

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

feature/p4-macos-container-scripts; approved; committed and pushed in the commit that adds this report.

## Next steps

Approve, commit and push. Open the pull request and merge it when every job is green. Then re-run PR #33's CI, and merge #33 when all four of its jobs pass.
