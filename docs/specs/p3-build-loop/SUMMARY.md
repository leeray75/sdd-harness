# Summary Report: p3-build-loop

Ticket: none Date: 2026-11-23
Outcome: Clean
Review rounds: 1 of 3 in revision 1 (no review ran in revision 0), plus 1 user-requested change round (U1); revisions: 1 (no cap in this spec; the plugin's cap is 2)
Models: implementor haiku; reviewer sonnet; data agent not used (all chosen by the user); respawns: none

## What was built

- **Build controller (G1–G4):** `src/main/workflow/build-loop.ts` runs one feature's build: writer Mode 1, review round n, then the decision. ISSUES sends every finding to the writer in Mode 2. Every node change goes through `transition()`.
  - **Round limit:** the default is 3. A build option may set 1–3, and anything else is refused.
  - **Spec problems** pause the build, with the other findings carried. `resume('continue' | 'revise' | 'stop')` and `approved()` drive the deviation, revise (Mode 3, the counter reset, no revision cap) and stop paths.
  - **User change rounds** use `U<k>` labels and are not counted against the limit.
- **Documents (G5):** the app writes `build-ledger.md` and `SUMMARY.md` through pure renderers (`src/shared/build-docs.ts`), which round-trip through `parseLedger` and `detectFolder`.
- **Gate:** the writer may write only its own feature's `tasks.md` and `changes.md` (amends D30).
- **Loop (G6):** `runAgentLoop` takes `maxTurns` and `history` and returns `messages`. An injected `JobRunner` with an in-process runner gates every tool call. The writer gets 40 turns and the reviewer 20.
- **Reports and tests (G7):** pure parsers read the three report formats (`src/shared/build-reports.ts`). A scripted provider runs the whole loop headless in the tests.
- **Events (G8):** CONTINUE, STOP_BUILD and END_BUILD are added to the table (amends D34). EDIT_SPEC is wired to `edit-approved-spec` through an optional hook. No new code runs git or commits.
- **Docs (G9):** updated in the same change, with D37.

## Files changed

Product files (group 1):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/agent/loop.ts | edited | Optional `maxTurns` and `history`, and the returned `messages`; the defaults are unchanged | T1 |
| tests/unit/agent-loop.test.ts | edited | Default cap, raised cap, history before the prompt, returned messages | T1 |
| src/shared/build-reports.ts | created | Pure parsers for the Implementation report, the Findings analysis and the Review, including the `U<k>` headings | T2, revision 1 |
| tests/unit/build-reports.test.ts | created | Every format, the bad cases, the caps, `U<k>` and the purity scan | T2, revision 1 |
| src/shared/build-docs.ts | created | Pure `renderLedger` and `renderSummary` | T3 |
| tests/unit/build-docs.test.ts | created | The ledger round trip through `parseLedger` and `detectFolder`, the SUMMARY sections, escaping and purity | T3 |
| src/shared/workflow.ts | edited | CONTINUE and STOP_BUILD (user), END_BUILD (app); 21 events, 26 legal transitions | T4, revision 1 |
| tests/unit/workflow-machine.test.ts | edited | The harness events, the 12 × 21 walk and the legal events of the paused, implementing and reviewing nodes | T4, revision 1 |
| tests/unit/workflow-events.test.ts | edited | The counts and the kind lists | T4, revision 1 |
| src/main/policy/path-areas.ts | edited | `changes.md` added to `SPEC_DOC_NAMES` | T5 |
| src/main/policy/gate.ts | edited | Once approved, the writer may write its own feature's `tasks.md` and `changes.md`; the planner never writes `changes.md` | T5 |
| tests/unit/policy-gate.test.ts | edited | The allowed pair, the denials for every job, and a denied `git commit` | T5 |
| tests/unit/policy-paths.test.ts | edited | `changes.md` and state-file classification | T5 |
| tests/support/scripted-provider.ts | created | Replays each job's scripted turns, records requests, throws when a script is exhausted | T6 |
| src/main/workflow/job-runner.ts | created | `JobRunner`, `createInProcessJobRunner`: gate check, turn caps, failures returned as `ok: false` | T6 |
| tests/unit/job-runner.test.ts | created | Gated calls, denied git, turn limit, provider error, exhausted script | T6 |
| src/main/workflow/build-loop.ts | created | The build controller; writes only the ledger and SUMMARY; END_BUILD and `U<k>` | T7, revision 1 |
| tests/unit/build-loop.test.ts | created | The AC1–AC7 paths on temp repos with the scripted provider | T7, revision 1 |
| src/main/human/spec-handlers.ts | edited | The optional `onEditRequested` hook | T8 |
| src/main/index.ts | edited | Passes the hook; no controller is created at startup, so behaviour is unchanged | T8 |
| tests/unit/spec-handlers.test.ts | edited | The hook allows, the hook refuses, the hook is not asked when the checks refuse | T8 |
| docs/decisions.md | edited | D37; amends D30 and D34 | T9, revision 1 |
| docs/workflow-engine.md | edited | The events table and counts, and the "Build loop" section | T9, revision 1 |
| docs/agent-jobs.md | edited | The writer's two files, turn caps, parsed formats, the `U<k>` label | T9, revision 1 |
| CHANGELOG.md | edited | Build loop entries under Unreleased (top-level bullets) | T9, revision 1 |
| CLAUDE.md | edited | D1–D37, the engine line, the writer's two spec files | T9 |
| README.md | edited | D1–D37 | T9 |
| docs/PRD.md | edited | F2 "After the last allowed round the build stops and asks the user" ticked | T9 |
| docs/workflow.md | edited | The pause choices, and CONTINUE, STOP_BUILD and END_BUILD | T9, revision 1 |
| docs/human-actions.md | edited | `edit-approved-spec` asks the build controller (stale-doc fix) | T9 |
| docs/phases/phase-03-workflow-engine.md | edited | Subtask note linking the Build loop section | T9 |
| docs/phases/phase-03-progress.md | edited | D37 under Decisions added; "From p3-build-loop" follow-ups | T9, revision 1 |
| tests/unit/policy-acceptance.test.ts | edited | An explicit 20 s timeout on the "read tool in every state" test, which timed out under full parallel load; its logic is unchanged | U1-1, round U1 |
| tests/unit/spec-folders.test.ts | edited | An explicit 20 s timeout on "the finished folders of this repo", for the same reason; its logic is unchanged | U1-1, round U1 |

Workflow files (group 2):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| docs/specs/p3-build-loop/PLAN.md | created | Approved plan | n/a |
| docs/specs/p3-build-loop/SPECS.md | created | Approved spec, revised in revision 1 | n/a |
| docs/specs/p3-build-loop/SUBTASK.md | created | Child-ticket draft (no tracker) | n/a |
| docs/specs/p3-build-loop/tasks.md | created | T1–T10, all ticked; T2, T4, T7, T9 and T10 redone in revision 1 | T1–T10 |
| docs/specs/p3-build-loop/build-ledger.md | created | Build ledger | n/a |
| docs/specs/p3-build-loop/changes.md | created | The implementor's file record and stale-doc check | n/a |
| docs/specs/p3-build-loop/SUMMARY.md | created | This report | n/a |

Git and `changes.md` agree: every changed or new file git shows is listed, and every listed file shows in git.

## Acceptance criteria

| AC | Status | Evidence |
| --- | --- | --- |
| AC1 | Pass | `build-loop.test.ts`: clean in round 1, a fix then clean in round 2, open issues at round 3 with no fourth review, each job continuing its own history. The reviewer checked `decideStep` and the transitions. |
| AC2 | Pass | `roundLimit` tests (3 by default, 1–3 accepted; 0, 4, 2.5, `'3'` and `null` refused), limit 1, and a refused limit running nothing. |
| AC3 | Pass | Pause from the writer and from the reviewer, with the carried findings; continue with no reset; stop; revise then `approved()` with Mode 3 and round 1; a second revision; wrong-time calls refused. Revision 1 adds END_BUILD for a continue with nothing left to run. |
| AC4 | Pass | `U1` rounds go to the same writer and reviewer, with the label in both prompts and the review heading. The counter is untouched after 3 rounds, and an empty list is refused. |
| AC5 | Pass | The ledger round trip and detection at each step, the SUMMARY sections, and the gate's allowed pair and denials for every job. |
| AC6 | Pass | The three events with their kinds, 26 legal transitions, illegal calls refused with nothing changed, and the EDIT_SPEC hook legal from spec-approved and refused during a build. |
| AC7 | Pass | No new module imports `child_process` or quotes `'git'`, and a scripted `git commit` is denied by the gate. The "## Git state" SUMMARY heading is required by the spec. |
| AC8 | Pass | The loop option tests; the parser tests, including the restate-once and unreadable-report paths. |
| AC9 | Pass | D37, the Build loop section, `agent-jobs.md`, the CHANGELOG (top-level bullets) and the stale-doc check recorded in `changes.md`, with the PRD item ticked. |
| AC10 | Pass locally | The purity scans pass. typecheck, lint and format:check pass. Before round U1, `pnpm test` timed out at 5 s in two older tests on 2 of 4 runs. After U1 gave them a 20 s timeout, it passed 3 of 3 orchestrator runs and 3 of 3 implementor runs (1482 passed, 15 skipped). CI is checked on the PR. |

## Needs a runtime check

- CI on the pull request: the `check` job, and `e2e` on Windows, macOS and Linux.
- Whether the 20 s timeouts from round U1 are enough on the CI `check` runner.
- Real models' report formatting against the parsers. The unit tests use scripted turns only.
- A change round that pauses or fails before its review records no entry, so a later change request reuses the same `U<k>` label.
- A continued Mode 3 adds a second Mode 3 entry to the ledger. This is cosmetic.

## Review ledger

Covers every revision, copied from `docs/specs/p3-build-loop/build-ledger.md`.

### Revision 0, implement step (paused before any review)

The implementor reported five NEEDS-SPEC-CHANGE gaps after Mode 1. No review ran. See Spec revisions.

### Revision 1, round 1 (PASS)

| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| ------- | -------- | -------- | -------------------- | --------- | ------ |
| (none)  |          |          |                      |           |        |

### User-requested change round U1 (PASS)

| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| U1-1: two file-heavy tests time out at the 5 s default under full parallel load | minor (test reliability) | tests/unit/policy-acceptance.test.ts:250, tests/unit/spec-folders.test.ts:78 | ACCEPT | They pass alone in about 100 ms and time out only with all files running in parallel. build-loop's slowest test is 57 ms, so it needs no timeout. | A 20 000 ms per-test timeout with a comment, and no logic change. Reviewer: PASS. 3 of 3 full runs green on re-run. |

## Spec revisions

- **Revision 1**, from the implement step of revision 0. The user chose **Revise the spec**:
  - A failed step, and a continue with nothing left to run, end with a new app event, END_BUILD, from implementing, reviewing or paused to build-done. The outcome is Open issues remain, and no fake IMPLEMENTED is raised.
  - Change rounds use the `U<k>` label in the prompts and in the reviewer's heading.
  - The carried findings after a writer pause are the step's findings minus the NEEDS-SPEC-CHANGE ones.

  The decisions are recorded under the spec's Open questions.

## Rejected findings

none

## Open issues

none. The load-sensitive timeouts found after review round 1 were fixed in the user-requested round U1.

Noted, not defects:

- The job runner checks every call through the gate but does not log the gate's Rule events (D30). It is recorded as a follow-up, and must be wired before a build runs in the app.
- No build controller is created in the app yet. The in-process runner is used by the tests only, and the agent-process wiring is `p3-headless-e2e`.
- The writer may rewrite all of its feature's `tasks.md`, not just tick boxes. `SPECS.md` stays protected by the hash.

## Git state

Branch `feature/p3-build-loop`; approved; committed and pushed in the commit that adds this report.

## Next steps

Approve, then commit and push. A pull request is merged only when CI is green on every job. Then run `/sdd:close`.
