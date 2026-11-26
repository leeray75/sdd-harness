# Make the WSL run_command fixture executable on Linux

**Parent:** none: no tracker configured
**Spec:** docs/specs/p4-ci-linux-fix-2/SPECS.md
**Repo and base branch:** sdd-harness, main, feature branch feature/p4-ci-linux-fix-2

## Context

`check (Linux)` still fails one case after `p4-ci-linux-fix`: `env-recording.test.ts:190`. Its `/usr/bin/tool` fixture is not executable on a Linux host.

## Required work

- T1 Executable fixture.
- T2 Docs.
- T3 Checks.

## Acceptance criteria

- AC1: the fixture is written with mode `0o755`, and no assertion changes.
- AC2: the CHANGELOG and the progress follow-up are updated.
- AC3: the local checks pass, and the pull request's CI is green on every job.

## Out of scope

- Product code, other tests, the CI workflow.

## Links

- Plan: docs/specs/p4-ci-linux-fix-2/PLAN.md
- Spec and tasks: docs/specs/p4-ci-linux-fix-2/SPECS.md, docs/specs/p4-ci-linux-fix-2/tasks.md
