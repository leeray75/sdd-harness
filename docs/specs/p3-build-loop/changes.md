# Changes: p3-build-loop

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/agent/loop.ts | edited | Added optional `maxTurns` and `history` to `LoopInput`, `messages` to `LoopResult`; the default cap and requests are unchanged. | T1 |
| tests/unit/agent-loop.test.ts | edited | Added option tests (default cap, raised cap, history before prompt, returned messages). | T1 |
| docs/specs/p3-build-loop/tasks.md | edited | Ticked T1 after its check passed. | T1 |
| src/shared/build-reports.ts | created | Pure parsers for the implementation report, the findings analysis and the review (fixed reasons, caps, never throw). | T2 |
| tests/unit/build-reports.test.ts | created | Parser tests: every format, bad cases, caps, never-throw inputs and the purity scan. | T2 |
| docs/specs/p3-build-loop/tasks.md | edited | Ticked T2 after its check passed. | T2 |
| src/shared/build-docs.ts | created | Pure renderers for build-ledger.md (renderLedger) and SUMMARY.md (renderSummary), with TURN_CAPS and flattened free text. | T3 |
| tests/unit/build-docs.test.ts | created | Ledger round trip through parseLedger and detectFolder (implementing, reviewing, paused, done), SUMMARY sections, cell escaping and the purity scan. | T3 |
| docs/specs/p3-build-loop/tasks.md | edited | Ticked T3 after its check passed. | T3 |
| src/shared/workflow.ts | edited | Added CONTINUE and STOP_BUILD (kind user) to EVENT_IDS, EVENT_KINDS and paused's transitions; updated the count comments to twenty. | T4 |
| tests/unit/workflow-machine.test.ts | edited | Kept the plugin copy literal; added the two build-loop events as a harness list, the 12 x 20 walk (23 legal pairs) and the paused legal events. | T4 |
| tests/unit/workflow-events.test.ts | edited | Count is twenty; the user events now include CONTINUE and STOP_BUILD. | T4 |
| docs/specs/p3-build-loop/tasks.md | edited | Ticked T4 after its check passed. | T4 |
| src/main/policy/path-areas.ts | edited | Added changes.md to SPEC_DOC_NAMES (D37), with a comment that the planner never writes it. | T5 |
| src/main/policy/gate.ts | edited | Writer may write its own feature's tasks.md and changes.md once the spec is approved; the planner's own-doc rule excludes changes.md, so it stays out before and after approval. | T5 |
| tests/unit/policy-gate.test.ts | edited | Added the D37 block: the writer's allowed pair, denials for other files and features and by spec state, the planner, reviewer and reader, and a git commit denied. | T5 |
| tests/unit/policy-paths.test.ts | edited | Added changes.md (and its case folding) and the state file to the classification cases. | T5 |
| docs/specs/p3-build-loop/tasks.md | edited | Ticked T5 after its check passed. | T5 |
| tests/support/scripted-provider.ts | created | Scripted provider: replays each job's turns, picks the job from the system prompt, records requests, throws when a script is exhausted. | T6 |
| src/main/workflow/job-runner.ts | created | JobRunner and createInProcessJobRunner: gate check before each tool call, turn caps from TURN_CAPS, turn-limit and provider-error results as ok false. | T6 |
| tests/unit/job-runner.test.ts | created | Gated calls, denied git commit, denied write before approval, history and messages, default caps, turn limit, provider error and exhausted script. | T6 |
| docs/specs/p3-build-loop/tasks.md | edited | Ticked T6 after its check passed. | T6 |
| src/main/workflow/build-loop.ts | created | Build controller: roundLimit, createBuildController, start, resume, approved, requestChanges, requestEdit; writes only build-ledger.md and SUMMARY.md through writeAtomic; every event through transition(). | T7 |
| tests/unit/build-loop.test.ts | created | Controller tests on temp repos with an approved lock and the scripted provider: AC1 to AC7 paths, documents at each step, refusals, concurrency, restate-once and the no-git scan. | T7 |
| docs/specs/p3-build-loop/tasks.md | edited | Ticked T7 after its check passed. | T7 |
| src/main/human/spec-handlers.ts | edited | Added the optional onEditRequested hook (D37), called after the approval checks and before the state write; a refusal returns its reason. With no hook the behaviour is unchanged. | T8 |
| src/main/index.ts | edited | Passes an onEditRequested hook that asks the feature's build controller (none is created at startup, so the edit is allowed as before). | T8 |
| tests/unit/spec-handlers.test.ts | edited | Hook allows, hook refuses (nothing recorded), and the hook is not asked when the checks already refuse. | T8 |
| docs/specs/p3-build-loop/tasks.md | edited | Ticked T8 after its check passed. | T8 |
| docs/decisions.md | edited | Added D37 (controller, injected jobs, turn caps, round limit, pauses, change rounds, documents, writer's files); amends D30 and D34. | T9 |
| docs/workflow-engine.md | edited | Events table, count (twenty) and transitions (23), user kinds, a new "Build loop" section, the code map and the extension note. | T9 |
| docs/agent-jobs.md | edited | Writer's two spec files, the turn caps, the parsed report formats, the change-round label and the enforcement list. | T9 |
| CHANGELOG.md | edited | Build loop entries under ## [Unreleased] as top-level bullets. | T9 |
| CLAUDE.md | edited | Decision range D1–D37, the engine line (Build loop section), and the writer's two spec files in the read-only rule. | T9 |
| README.md | edited | Decision range D1–D37 in the docs table. | T9 |
| docs/PRD.md | edited | F2 acceptance item "After the last allowed round the build stops and asks the user" ticked. | T9 |
| docs/workflow.md | edited | Pause choices sentence; CONTINUE and STOP_BUILD in the events list. | T9 |
| docs/human-actions.md | edited | edit-approved-spec asks the build controller before it records the edit (stale-doc fix found in the check). | T9 |
| docs/phases/phase-03-workflow-engine.md | edited | Subtask 3 note linking the Build loop section. | T9 |
| docs/phases/phase-03-progress.md | edited | D37 added under Decisions added; "From p3-build-loop" follow-ups added. The table's status row is unchanged. | T9 |
| docs/specs/p3-build-loop/tasks.md | edited | Ticked T9 after its check passed. | T9 |
| docs/specs/p3-build-loop/tasks.md | edited | Ticked T10 after the full checks passed (typecheck, lint, format:check and the unit suite). | T10 |
| src/shared/build-reports.ts | edited | parseReview accepts `## Review round U<k>` and returns the round as the string U<k>; the analysis heading may name U<k> (round null). | T2, revision 1 |
| tests/unit/build-reports.test.ts | edited | Tests for the U<k> review heading (string round) and the U<k> analysis heading (null round). | T2, revision 1 |
| src/shared/workflow.ts | edited | Added END_BUILD (kind app) to EVENT_IDS, EVENT_KINDS and the transitions of implementing, reviewing and paused to build-done; count comments now twenty-one. | T4, revision 1 |
| tests/unit/workflow-events.test.ts | edited | Count is 21; the app list includes END_BUILD (ten app events). | T4, revision 1 |
| tests/unit/workflow-machine.test.ts | edited | END_BUILD added to the harness list and states; 12 x 21 walk with 26 legal pairs; legal events for implementing, reviewing and paused. | T4, revision 1 |
| src/main/workflow/build-loop.ts | edited | A failed step ends with END_BUILD; a continue with nothing left to run ends with END_BUILD from paused, with no IMPLEMENTED; no fake IMPLEMENTED anywhere; change rounds use the label U<k> in both prompts and the counter is untouched. | T7, revision 1 |
| tests/unit/build-loop.test.ts | edited | Restatement failure now ends at build-done; a continue with only spec-change findings ends with END_BUILD; change round prompts and reviewer heading use U1. | T7, revision 1 |
| docs/decisions.md | edited | D37: END_BUILD (ending without a verdict), the U<k> label, the nothing-left-to-run continue, and the amendment of D34 with END_BUILD; event and transition counts. | T9, revision 1 |
| docs/workflow-engine.md | edited | Events table (END_BUILD row), counts (21 events, 26 transitions), app count (ten), and the build loop's continue, failure and change-round text. | T9, revision 1 |
| docs/workflow.md | edited | END_BUILD in the events list; the pause sentence says a failed or nothing-left build ends with its open issues listed. | T9, revision 1 |
| docs/agent-jobs.md | edited | The U<k> label for change-round review and analysis headings. | T9, revision 1 |
| docs/phases/phase-03-progress.md | edited | The "From p3-build-loop" follow-ups recorded as settled in revision 1, with one pilot check kept. | T9, revision 1 |
| CHANGELOG.md | edited | Event count fixed (21 events, 26 transitions), and top-level bullets for END_BUILD and the U<k> label. | T9, revision 1 |
| docs/specs/p3-build-loop/tasks.md | edited | Ticked T2, T4, T7 and T9 (revision 1), then T10 after the revised full checks. | T2, T4, T7, T9, T10, revision 1 |
| tests/unit/policy-acceptance.test.ts | edited | Explicit 20 s timeout on "runs a read tool only for the jobs whose base set has it, in every state" (the test logic is unchanged); it timed out at the 5 s default under full parallel load. | U1-1, round U1 |
| tests/unit/spec-folders.test.ts | edited | Explicit 20 s timeout on "the finished folders of this repo (AC5)" for the same reason; the test logic is unchanged. | U1-1, round U1 |

Stale-doc check (AC9, T9): checked CLAUDE.md, README.md, docs/PRD.md, docs/workflow.md, docs/workflow-engine.md, docs/agent-jobs.md, docs/human-actions.md, docs/decisions.md, the phase-03 doc and the progress follow-ups, and the CHANGELOG under ## [Unreleased]. Every stale line in those files was updated. `docs/roadmap.md`, `docs/agent-commands.md` and `docs/design-notes.md` were searched for the changed facts and needed no change. `pnpm format:check` passes.
