# Summary Report: p4-ci-linux-fix

Ticket: none   Date: 2026-11-26
Outcome: Clean
Review rounds: 1 of 3 per revision; revisions: 0 of 2
Models: implementor haiku; reviewer sonnet; data agent not used (all chosen by the user); respawns: none

## What was built

The two pieces of code that assumed a Windows host are fixed, so `check (Linux)` should pass again (G1):
- **`linuxResult`** in `src/main/env/wsl.ts` now maps a `realpath` or `readlink` result that lies inside the share root back to its Linux path first. It returns a `/`-prefixed result unchanged only for a UNC share root, and gives `ENOENT` for any other host path. On Windows with a UNC root, every result is the same as before.
- **`environmentFor`** checks the WSL distribution name before the platform.

The newest main runs (`4965bb1`, `026c76c`) show the same seven Linux failures and no others, and these two fixes cover all seven (G2).

## Files changed

Product files (group 1):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/main/env/wsl.ts | edited | `linuxResult` applies the four rules in order, and is exported for the AC1 cases; `shareFor` and `linuxFor` are unchanged | T1 |
| src/main/env/index.ts | edited | `environmentFor` checks the WSL name before the platform; the doc comment states the order | T2 |
| tests/unit/env-wsl.test.ts | edited | The import line adds `linuxResult`; new AC1 cases for a POSIX root and a UNC root, and new AC2 cases; no existing assertion changed | T1, T2 |
| CHANGELOG.md | edited | `[Unreleased]` Fixed entry | T4 |
| docs/environments.md | edited | The WSL Share bullet states the share-result rules | T4 |
| docs/phases/phase-04-progress.md | edited | A `p4-env-wsl` follow-up line: the Linux CI failures are fixed by this work | T4 |

Workflow files (group 2):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| docs/specs/p4-ci-linux-fix/PLAN.md | created | The approved plan | plan |
| docs/specs/p4-ci-linux-fix/SPECS.md | created | The approved spec | plan |
| docs/specs/p4-ci-linux-fix/SUBTASK.md | created | Child-ticket draft (no tracker) | plan |
| docs/specs/p4-ci-linux-fix/tasks.md | created | T1–T5, all ticked | plan, all |
| docs/specs/p4-ci-linux-fix/build-ledger.md | created | The build ledger | build |
| docs/specs/p4-ci-linux-fix/changes.md | created | The implementor's record, with the T3 annotation review | build |
| docs/specs/p4-ci-linux-fix/SUMMARY.md | created | This report | build |

Git and `changes.md` agree. `bash.exe.stackdump` is untracked, predates the work, and is left out of the commit.

## Acceptance criteria

| AC | Status | Evidence |
| --- | --- | --- |
| AC1 share results | Met | The new `env-wsl.test.ts` cases for a POSIX root and a UNC root |
| AC2 name before platform | Met | The new `env-wsl.test.ts` cases; the `env-local` and `env-wsl` cases pass unchanged |
| AC3 other Linux failures | Met | Runs `45859481598` (`4965bb1`) and `45859620722` (`026c76c`) report the same seven failures and nothing else; all are covered by T1 and T2 |
| AC4 no assertion changed | Met | `git diff main -- tests/` shows only an import line and added cases; the reviewer confirmed it |
| AC5 docs | Met | CHANGELOG, `docs/environments.md`, `phase-04-progress.md` |
| AC6 checks | Met locally; CI pending | typecheck, lint, format:check; `pnpm test` 1892 passed, 18 skipped. The `check (Linux)` job on the pull request is the evidence for G1, checked after the push |

## Needs a runtime check

- The pull request's `check (Linux)` job. On a Linux host, the `env-recording` run_command case and the two symlink cases were reasoned about, not run: the symlink cases skip on this Windows machine, and nothing here runs the Linux job.

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

feature/p4-ci-linux-fix; approved; committed and pushed in the commit that adds this report.

## Next steps

Approve, commit and push; or request changes; or not yet. After the push, open the pull request and check that `check (Linux)` is green.
