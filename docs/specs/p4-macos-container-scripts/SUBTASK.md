# Skip the container stat scenarios where the host's stat rejects -c

**Parent:** none: no tracker configured
**Spec:** docs/specs/p4-macos-container-scripts/SPECS.md
**Repo and base branch:** sdd-harness, main, feature branch feature/p4-macos-container-scripts

## Context

PR #33 runs the unit tests on macOS, and `container-scripts.test.ts` fails 3 of 51 scenarios there. The container's stat scripts use `stat -c`, which macOS BSD `stat` rejects. In the product those scripts run inside a Linux container, so only the test is wrong.

## Required work

- T1 Probe and skip.
- T2 Linux run.
- T3 Docs.
- T4 Checks.

## Acceptance criteria

- AC1: only the probe, the skip condition and the comment change; no assertion changes.
- AC2: all 51 scenarios run on Linux, the 6 stat scenarios are skipped where `stat -c` fails, and the block is skipped without `/bin/sh`.
- AC3: a CHANGELOG Fixed line, and a progress follow-up for the `realpathSync.native` wording on PR #33.
- AC4: the local checks pass, and CI is green on every job.

## Out of scope

- Product code, the CI workflow, PR #33's files.

## Links

- Plan: docs/specs/p4-macos-container-scripts/PLAN.md
- Spec and tasks: docs/specs/p4-macos-container-scripts/SPECS.md, docs/specs/p4-macos-container-scripts/tasks.md
