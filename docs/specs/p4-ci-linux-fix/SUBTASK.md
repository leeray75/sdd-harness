# Fix the Linux CI unit tests

**Parent:** none: no tracker configured
**Spec:** docs/specs/p4-ci-linux-fix/SPECS.md
**Repo and base branch:** sdd-harness, main, feature branch feature/p4-ci-linux-fix

## Context

`check (Linux)` has failed its Unit tests step since `p4-env-wsl` (PR #29). Two pieces of code assume a Windows host:

- the WSL backend's `linuxResult` treats every `/`-prefixed result as a Linux path;
- `environmentFor` checks the platform before the WSL distribution name.

This work fixes only those and any other `check (Linux)` failure on `main`, with no behaviour change on Windows and no existing assertion changed.

## Required work

- T1 linuxResult.
- T2 environmentFor order.
- T3 Other Linux failures.
- T4 Docs.
- T5 Checks.

## Acceptance criteria

- AC1: share results map back for a POSIX root, and a UNC root is unchanged.
- AC2: the WSL name is checked before the platform.
- AC3: every other `check (Linux)` failure on `main` is fixed.
- AC4: no existing assertion changes.
- AC5: docs: the CHANGELOG Fixed entry, `docs/environments.md` and the progress follow-up.
- AC6: the local checks pass, and the pull request's CI is green on every job.

## Out of scope

- Other cleanup, CI workflow changes, the live-walk leftovers and the earlier runtime checks.

## Links

- Plan: docs/specs/p4-ci-linux-fix/PLAN.md
- Spec and tasks: docs/specs/p4-ci-linux-fix/SPECS.md, docs/specs/p4-ci-linux-fix/tasks.md
