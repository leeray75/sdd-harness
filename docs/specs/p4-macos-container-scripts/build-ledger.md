# Build ledger: p4-macos-container-scripts

state: done
revision: 0
resume on approve: no
current round: 1 of 3, in revision 0
phase: reviewing
Implementor: a5b7a16c19e2e56b7, haiku    Reviewer: a1af8bbbf50b4f5ac, sonnet
Data agent: none yet
Models: chosen by the user at the start of the build; reused on resume, not asked again.
Respawns: none

## Implementation (revision 0)

T1 to T4 are done and ticked.

- **Windows:** typecheck, lint, format:check and `pnpm test` pass (1967 passed, 69 skipped). The file shows 1 passed and 50 skipped on Windows.
- **Linux, a `node:24` container:** 51 of 51, with 0 skipped.
- **A shadow `stat` that refuses `-c`:** 45 passed and 6 skipped, exactly the stat scenarios.
- **The diff:** only the probe, the skip and the comment.
- **The Linux run** came before a whitespace-only Prettier re-wrap of one line.

## Revision 0, round 1  (PASS)

No findings. Runtime check: the macOS skip is confirmed only by PR #33's macOS job after this merges.

## Spec problems

- none

## Carried findings

- none
