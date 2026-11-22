# Build ledger: p3-spec-lock

state: done
revision: 0
resume on approve: no
current round: 1 of 3, in revision 0
phase: reviewing
Implementor: ae1db9ca11e4c9876, haiku    Reviewer: a5f84abf1926e4b64, sonnet
Data agent: none (not used)
Models: chosen by the user at the start of the build; reused on resume, not asked again.
Respawns: none

## Implementation, revision 0 (Mode 1)

- Done: T1–T7, all ticked. typecheck, lint, format:check and build pass. `pnpm test` gives 67 files, 1380 passed, 15 skipped. The watcher test passed twice in a row.
- Concerns reported:
  - The gate reads the watcher's cached value. A missed event leaves it stale until the next event or refresh (recorded in the Limits section of workflow-engine.md and in the progress follow-ups).
  - e2e `tests/e2e/human-action.spec.ts` (c), (d) and (e) expect `not-available` for approve-spec. They pass because the e2e launch sets no `HARNESS_SPIKE_ROOT`.
  - An unreadable state file gives `unchecked` for every folder. approve-spec replaces it.
  - Not tested: the watcher's error-then-re-arm path, and `docs/specs` being created after startup.
- Readings, not spec changes:
  - a tie in `currentFeature` goes to the smaller slug;
  - `now` is `() => Date`;
  - `commandPolicyFor` returns `contextNow()`;
  - `spec-state.ts` imports the `Approval` type, type-only, from `./spec-detect`;
  - the handlers await the refresh;
  - the clock is read before SPECS.md is written.

## Revision 0, round 1 (PASS)

| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| ------- | -------- | -------- | -------------------- | --------- | ------ |
| (none)  |          |          |                      |           |        |

The reviewer's runtime-check notes, which are not defects:

- A Windows rename can fail with EPERM or EBUSY while a file is held, and the handler would then refuse.
- The cached `approved` value can go stale.
- The re-arm path, and `docs/specs` created later, are untested.
- The e2e human-action tests depend on `HARNESS_SPIKE_ROOT` being unset.

After the PASS, the orchestrator re-ran the check job: typecheck, lint and format:check pass, and `pnpm test` gives 67 files, 1380 passed, 15 skipped.

The orchestrator also found a doc defect the review missed. In `CHANGELOG.md`, the Spec lock bullet was inserted between the Document layer bullet and its four sub-bullets, so they now read as part of Spec lock. It went to the user, who chose to request changes.

## User-requested change round U1 (PASS)

| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| U1: the Spec lock bullet split the Document layer bullet from its sub-bullets | minor (docs) | CHANGELOG.md, Unreleased, Added | ACCEPT | Before the fix, line 114 was the Spec lock bullet, and lines 115–118 were the Document layer sub-bullets | Moved Spec lock after the last sub-bullet and updated the changes.md row. `pnpm format:check` passes. The reviewer checked it: PASS. |

## Spec problems

none

## Carried findings

none
