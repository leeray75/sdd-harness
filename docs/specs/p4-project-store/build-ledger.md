# Build ledger: p4-project-store

state: done
revision: 0
resume on approve: no
current round: 1 of 3, in revision 0
phase: reviewing
Implementor: afd0ae07436f46484, haiku    Reviewer: ab53671ba357b5622, sonnet
Data agent: none (not needed)
Models: chosen by the user at the start of the build; reused on resume, not asked again.
Respawns: none

## Implementation (Mode 1)

- T1 to T8 completed; no tasks left open, no NEEDS-SPEC-CHANGE, no NEEDS-DATA-AGENT.
- The implementor's notes:
  - `removeProject` closes the watcher, then removes the project from the store. If the save fails, it restarts the watcher.
  - The registry rebuilds a stored project's handlers when its rules change.
  - `hasLineBreak` and `isProjectId` are exported, and `buildOptionsFor` returns null for an unknown id.
  - The case-only duplicate-root test is skipped on Linux.
  - Two store tests have explicit 15 s and 20 s timeouts.
  - The e2e expectations (c), (d) and (e) changed from `not-available` to `refused`.

## Revision 0, round 1 (PASS)

| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| ------- | -------- | -------- | -------------------- | --------- | ------ |
| (none)  |          |          |                      |           |        |

The reviewer listed two runtime checks:

- a stored project and the dev project that share a root get two watchers;
- the filesystem-dependent store tests (the timeouts, and the case-only duplicate on Windows and macOS).

## Spec problems

- none

## Carried findings

- none
