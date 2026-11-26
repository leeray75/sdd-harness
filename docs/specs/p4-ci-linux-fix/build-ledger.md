# Build ledger: p4-ci-linux-fix

state: done
revision: 0
resume on approve: no
current round: 1 of 3, in revision 0
phase: reviewing
Implementor: a4cba106a45d8f786, haiku    Reviewer: a79f86b4295994670, sonnet
Data agent: none yet
Models: chosen by the user at the start of the build; reused on resume, not asked again.
Respawns: none

## Implementation (revision 0)

T1 to T5 are done and ticked.
- **Checks:** typecheck, lint and format:check pass. `pnpm test`: 1892 passed, 18 skipped. `git diff main -- tests/` shows only added cases and one import line.
- **T3:** the newest main run, 45859620722 (026c76c, job 140050027176), has the same seven Linux failures as 4965bb1. T1 and T2 cover all of them, so no other fix was needed.
- **Not shown locally:** the Linux job itself, which waits for the pull request's CI run.
- **Deviations:** `linuxResult` is now exported, for the AC1 cases.

## Revision 0, round 1  (PASS)

No findings. The runtime check is the pull request's `check (Linux)` job. It also covers the `env-recording` run_command case and the symlink cases, which the reviewer reasoned about rather than ran.

## Spec problems

- none

## Carried findings

- none
