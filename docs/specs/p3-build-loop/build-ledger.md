# Build ledger: p3-build-loop

state: done
revision: 1
resume on approve: no
current round: 1 of 3, in revision 1
phase: reviewing
Implementor: a3898ff98879fb38d, haiku    Reviewer: a09d4158482a27287, sonnet
Data agent: none yet
Models: chosen by the user at the start of the build; reused on resume, not asked again.
Respawns: none

## Implementation, revision 0 (Mode 1)

- Done: T1–T10, all ticked. `pnpm test` gives 71 files, 1479 passed, 15 skipped; typecheck, lint and format:check pass. One full run hit a 5 s timeout in `spec-folders.test.ts` under load, and the rerun passed.
- Concerns reported:
  - A process deviation: one test append was made with a Bash heredoc.
  - The job runner does not forward the gate's Rule events (D30 logging), which is recorded as a follow-up.
  - The AC7 scan checks `'git'` strings and `child_process`, not the "Git state" heading.
  - The extra stale docs, `human-actions.md` and `workflow.md`, were updated.
- NEEDS-SPEC-CHANGE (provisional, decided in code): five gaps, listed under Spec problems.

## Implementation, revision 1 (Mode 3)

- Done: T2, T4, T7, T9 and T10, re-ticked. `pnpm test` gives 71 files, 1482 passed and 15 skipped. typecheck, lint and format:check pass.
- Concerns reported:
  - A process deviation: one `sed -i` edit to two workflow test files.
  - Readings of the revision, not spec changes:
    - "nothing left to run" also covers a change-round pause and a writer Mode 2 pause with nothing carried;
    - the Findings analysis heading accepts `(round U<k>)`, with the round as null;
    - a failed step raises END_BUILD.
  - The D30 Rule-event logging in the job runner is still open, recorded as a follow-up.

## Revision 1, round 1 (PASS)

| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| ------- | -------- | -------- | -------------------- | --------- | ------ |
| (none)  |          |          |                      |           |        |

The reviewer's judgements on the implementor's concerns:

- The missing Rule-event logging in the job runner is not asked for by the spec. It stays a follow-up.
- The three readings of the revision hold against the spec.
- The AC7 scan is a reasonable reading.

Its runtime-check notes, which are not defects:

- A change round that pauses or fails before its review records no entry, so a later change request reuses the same `U<k>` label.
- A continued Mode 3 adds a second Mode 3 entry to the ledger.
- Real-model report formatting is untested.

After the PASS, the orchestrator re-ran the checks. typecheck, lint and format:check pass. `pnpm test` passed 2 of 4 full runs (1482 passed, 15 skipped). The other runs had a 5 s timeout in older tests that pass alone in about 1 s: `policy-acceptance.test.ts` (F1 read tools in every state) and `spec-folders.test.ts` (this repo's finished folders). The implementor saw the second one once too. `build-loop.test.ts`, about 6.4 s, is now the third-heaviest file, which adds load. This is passed to the user as a risk for the CI-green criterion.

## User-requested change round U1 (PASS)

| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| U1-1: two file-heavy tests time out at the 5 s default under full parallel load | minor (test reliability) | tests/unit/policy-acceptance.test.ts:250, tests/unit/spec-folders.test.ts:78 | ACCEPT | Reproduced: they pass alone in about 100 ms and time out only with all 71 files in parallel. build-loop's slowest test is 57 ms alone, so it needs no timeout. | Added a 20 000 ms per-test timeout, with a comment, to the two tests. No logic, product or config change. Reviewer: PASS. Orchestrator re-run: typecheck, lint and format:check pass, and `pnpm test` passed 3 of 3 runs (1482 passed, 15 skipped). |

## Spec problems

- Revision 0 pause (from the implement step), five gaps:
  1. **Continuing a review pause whose findings are all spec-change leaves nothing to fix.** Implemented: the build ends with "Open issues remain".
  2. **CONTINUE enters implementing, but a review pause at the round limit must end in build-done.** Implemented: IMPLEMENTED, then REVIEW_PASSED, with no writer step.
  3. **The number for change-round headings.** Implemented: the prompts carry counter + 1, and the counter is unchanged.
  4. **Carried findings after a writer pause.** Implemented: the step's findings minus the NEEDS-flagged ones. Continue re-sends the step with them.
  5. **A failed writer run while implementing.** The node stays at `implementing`, because REVIEW_PASSED is illegal there, while the ledger and SUMMARY say done.

  The user chose **Revise the spec**. The revision 1 decisions are:
  - 5 and 2: a new app event, END_BUILD, from implementing, reviewing and paused to build-done, for a failed step and for a continue with nothing left to run.
  - 1: such a continue ends with "Open issues remain", the deviation listed.
  - 3: change rounds use the `U<k>` label in the prompts and in the reviewer's heading.
  - 4: carried findings as implemented.

  `SPECS.md` and `tasks.md` were revised; T2, T4, T7, T9 and T10 are unticked.

## Carried findings

none (no review has run yet)
