# Build ledger: p3-state-machine

state: done
revision: 1
resume on approve: no
current round: 1 of 3, in revision 1
phase: reviewing
Implementor: a6f9f5a97233f90c1, haiku    Reviewer: a50c260cf505c196d, sonnet
Data agent: none (not used)
Models: chosen by the user at the start of the build; reused on resume, not asked again.
Respawns: none

## Implementation, revision 0 (Mode 1)

- Done: T1, T2, T4 (typecheck pass; workflow-machine 15 passed; workflow-events 9 passed).
- Not done: T3 (blocked by the spec problem below), T5, T6.

## Implementation, revision 1 (Mode 3)

- Done: T3, T5, T6 (all six tasks ticked). typecheck, lint, format:check pass; pnpm test 57 files, 1208 passed, 12 skipped.
- Not changed, by design: docs/roadmap.md Phase 3 status; the progress row's status (filled in after the merge).

## Revision 1, round 1 (PASS)

| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| ------- | -------- | -------- | -------------------- | --------- | ------ |
| (none)  |          |          |                      |           |        |

Needs a runtime check: AC9 rests on the implementor's report; CI on the pull request still to be checked. The orchestrator re-ran the check job locally: typecheck, lint, format:check pass; pnpm test 57 files, 1208 passed, 12 skipped.

## Spec problems

- Revision 0 pause (from the Mode 1 implementation step): AC4 says "`stageLabel` gives "Build, paused" for the paused node." and also "A test shows that no label equals or contains an internal node or event id." The label "Build, paused" contains the node id `paused`, so the two rules conflict. The implementor's candidates: (1) exempt `PAUSED_LABEL` from the id check; (2) change the label to something like "Build, on hold"; (3) narrow the check to multi-word ids. User chose: Revise the spec (revision 1): exempt `PAUSED_LABEL` from the id check and check it by its exact value; the check covers the six stage labels.

## Carried findings

none
