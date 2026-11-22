# Changes: p3-state-machine

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/shared/workflow.ts | created | The hand-written workflow table: 12 node ids, 18 event ids, the 21 transitions from the plugin's v0.18.0 config, `legalEvents`, `nextNode`, `transition` with fixed reasons, the id guards, the stage ids, labels and `PAUSED_LABEL`, `stageOf`, `stageLabel`, `isOverlay`, `EVENT_KINDS` and `HUMAN_EVENT_ACTIONS`. | T1, T2, T3, T4 |
| tests/unit/workflow-machine.test.ts | created | Literal copy of the plugin's ids and config; parity of ids, the 12 x 18 pair walk, legal events, next node and transition tests (AC1 to AC3). 15 tests pass. | T1, T2 |
| tests/unit/workflow-stages.test.ts | created | Stage mapping, labels, overlay, the build-done gate (AC4, AC5). The id-leak check covers the six `STAGE_LABELS` only, case-sensitive; `PAUSED_LABEL` is checked by its exact value "Build, paused". 11 tests pass. | T3, T3 revision 1 |
| tests/unit/workflow-events.test.ts | created | Event kinds, the human-action map and the purity import scan (AC6, AC7). 9 tests pass. | T4 |
| docs/specs/p3-state-machine/tasks.md | edited | Ticked T1, T2, T3 and T4 after their checks passed, then T5 and T6 after their checks passed. | T1, T2, T3, T4, T5, T6 |
| docs/specs/p3-state-machine/changes.md | created | This record of the files touched in the build, and the stale-doc check. | n/a |
| docs/decisions.md | edited | Added D34 (hand-written table, stage mapping, data-agent overlay, event kinds, human map, alternatives, date 2026-11-22). | T5 |
| CHANGELOG.md | edited | Entry under `## [Unreleased]` for the workflow table (`p3-state-machine`, D34) and `docs/workflow-engine.md`. | T5 |
| docs/workflow-engine.md | created | New engine reference: nodes, events, the 21 transitions, the functions, stages and labels, event kinds, the human-action map, where the code and tests are, and how later subtasks extend it. | T5 |
| CLAUDE.md | edited | Added `docs/workflow-engine.md` to "Read before planning" and named `src/shared/workflow.ts` as the one table. The decisions line said D1–D13; now D1–D34. | T5 |
| README.md | edited | Status line said Phase 0 in progress; now Phase 3 in progress with Phases 0–2 done. The decisions row said D1–D33; now D1–D34. Added a docs-table row for `docs/workflow-engine.md`. | T5 |
| docs/PRD.md | edited | F2 bullet: the table lives in `src/shared/workflow.ts` (D34), with a link to `workflow-engine.md`. | T5 |
| docs/workflow.md | edited | Added a paragraph after the reference table: the table's location, a link to `workflow-engine.md`, and the three event kinds with the D33 actions for the human-only events. | T5 |
| docs/phases/phase-03-workflow-engine.md | edited | Step 4.3 carries the docs rule. "Decide during planning" became "Decided during planning" (hand-written table, D34; state file left to `p3-spec-lock`). | T5 |
| docs/phases/phase-04-projects.md | edited | Step 4.3 carries the docs rule (CHANGELOG, stale docs, useful new docs). | T5 |
| docs/phases/phase-05-workspace-shell-chat.md | edited | Step 4.3 carries the docs rule. | T5 |
| docs/phases/phase-06-workspace-docs-next.md | edited | Step 4.3 carries the docs rule. | T5 |
| docs/phases/phase-07-build-view.md | edited | Step 4.3 carries the docs rule. | T5 |
| docs/phases/phase-08-models-agents-ui.md | edited | Step 4.3 carries the docs rule. | T5 |
| docs/phases/phase-09-usage-and-pilot.md | edited | Step 4.3 carries the docs rule. | T5 |
| docs/phases/README.md | edited | Step 4 states that each subtask's brief includes the docs item in its acceptance criteria. | T5 |
| docs/phases/phase-03-progress.md | edited | Decisions added: D34. Follow-up: the sdd plugin's templates in `repos/claude` are outside this repo. The status row and commit stay for after the merge. | T5 |

## Stale-doc check (AC8, T5)

| Doc | Result |
| --- | --- |
| CLAUDE.md | Updated: new doc in "Read before planning", the table named, decisions line D1–D34. |
| README.md | Updated: status line (it said Phase 0, though Phases 0–2 are done), decisions count D1–D34, docs-table row. |
| docs/PRD.md | Updated: F2 names the table and the new reference. |
| docs/workflow.md | Updated: table location, event kinds, link to the new doc. |
| docs/phases/phase-03-workflow-engine.md | Updated: docs rule in step 4.3; the decided item moved to "Decided during planning". |
| docs/phases/phase-03-progress.md (follow-ups) | Updated: decision D34 listed; follow-up on the plugin templates added. |

Left unchanged, with reasons:
- `docs/roadmap.md` still says Phase 3 is "not started". The roadmap says its status changes when a phase starts and ends, which is the orchestrator's step, not this subtask's.
- The progress file's row for `p3-state-machine` still says "planning". CLAUDE.md says only the status and commit are filled in after the merge.
- `docs/design-notes.md` and `docs/design/` are not named in AC8 and do not describe the table.

## Checks (T6)

- `pnpm typecheck` -> pass
- `pnpm lint` -> pass
- `pnpm format:check` -> pass
- `pnpm test` -> pass (57 files, 1208 tests passed, 12 skipped)
- `grep -l "CHANGELOG" docs/phases/README.md docs/phases/phase-0[3-9]-*.md` -> all eight files listed
