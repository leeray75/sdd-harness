# Summary Report: p3-state-machine

Ticket: none Date: 2026-11-22
Outcome: Clean
Review rounds: 1 of 3 per revision; revisions: 1 of 2
Models: implementor haiku; reviewer sonnet; data agent not used (all chosen by the user); respawns: none

## What was built

`src/shared/workflow.ts` is a pure, typed workflow table equal to the sdd plugin's v0.18.0 machine (G1):

- 12 nodes, 18 events and 21 transitions, with no state-machine dependency;
- `legalEvents`, `nextNode`, and `transition`, which reports an illegal event with fixed text (G2);
- each of the 11 path nodes maps to one of the six stages with plain-language labels, including "Build, paused", and `data-agent` is an overlay with no stage (G3);
- every event is classified as human-only, user or app, and the human-only events map to the D33 action ids (G4).

The docs were updated in the same change (G5):

- D34 and a new reference, `docs/workflow-engine.md`;
- the CHANGELOG, plus stale-doc fixes in `CLAUDE.md`, `README.md`, the PRD and `workflow.md`;
- the docs rule copied into `docs/phases/README.md` and the Phase 3–9 subtask briefs.

## Files changed

Product files (group 1):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/shared/workflow.ts | created | The workflow table: ids, 21 transitions, `legalEvents`, `nextNode`, `transition`, guards, stages and labels, `stageOf`, `stageLabel`, `isOverlay`, `EVENT_KINDS`, `HUMAN_EVENT_ACTIONS` | T1–T4 |
| tests/unit/workflow-machine.test.ts | created | Literal copy of the plugin's v0.18.0 ids and config; id parity, the 12 × 18 pair walk, legal events, next node and transition (AC1–AC3); 15 tests | T1, T2 |
| tests/unit/workflow-stages.test.ts | created | Stage mapping, labels, overlay, id-leak check over the six stage labels, `PAUSED_LABEL` by exact value, the build-done gate (AC4, AC5); 11 tests | T3 |
| tests/unit/workflow-events.test.ts | created | Event kinds, the human-action map, the purity import scan (AC6, AC7); 9 tests | T4 |
| docs/workflow-engine.md | created | New engine reference: nodes, events, transitions, functions, stages, event kinds, human map; later subtasks extend it | T5 |
| docs/decisions.md | edited | D34 | T5 |
| CHANGELOG.md | edited | Entry under `## [Unreleased]` | T5 |
| CLAUDE.md | edited | New doc in "Read before planning", the table named, decisions line D1–D34 (it said D1–D13) | T5 |
| README.md | edited | Status line (said Phase 0), decisions count D1–D34, docs-table row | T5 |
| docs/PRD.md | edited | F2 names the table (D34) and links the reference | T5 |
| docs/workflow.md | edited | Table location, event kinds, link to the reference | T5 |
| docs/phases/README.md | edited | Docs item required in every subtask brief | T5 |
| docs/phases/phase-03-workflow-engine.md | edited | Docs rule in step 4.3; "Decided during planning" | T5 |
| docs/phases/phase-04-projects.md | edited | Docs rule in step 4.3 | T5 |
| docs/phases/phase-05-workspace-shell-chat.md | edited | Docs rule in step 4.3 | T5 |
| docs/phases/phase-06-workspace-docs-next.md | edited | Docs rule in step 4.3 | T5 |
| docs/phases/phase-07-build-view.md | edited | Docs rule in step 4.3 | T5 |
| docs/phases/phase-08-models-agents-ui.md | edited | Docs rule in step 4.3 | T5 |
| docs/phases/phase-09-usage-and-pilot.md | edited | Docs rule in step 4.3 | T5 |
| docs/phases/phase-03-progress.md | edited | D34 listed; follow-up on the plugin's own templates | T5 |

Workflow files (group 2):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| docs/specs/p3-state-machine/PLAN.md | created | Approved plan | n/a |
| docs/specs/p3-state-machine/SPECS.md | created | Approved spec, revised once (AC4) | n/a |
| docs/specs/p3-state-machine/SUBTASK.md | created | Child-ticket draft (no tracker) | n/a |
| docs/specs/p3-state-machine/tasks.md | created | Tasks T1–T6, all ticked | T1–T6 |
| docs/specs/p3-state-machine/build-ledger.md | created | Build ledger | n/a |
| docs/specs/p3-state-machine/changes.md | created | Implementor's file record and stale-doc check | n/a |
| docs/specs/p3-state-machine/SUMMARY.md | created | This report | n/a |

Git and `changes.md` agree. Every changed file is listed, and every listed file shows in git.

## Acceptance criteria

| AC | Status | Evidence |
| --- | --- | --- |
| AC1 | Pass | `workflow-machine.test.ts` compares the ids with the literal v0.18.0 lists; the reviewer checked the lists against the plugin |
| AC2 | Pass | 12 × 18 pair walk against the literal config; 21 transitions, `INITIAL_NODE` is `idle` |
| AC3 | Pass | Legal-event order, same node on an illegal event, fixed reason text, and guards, all tested |
| AC4 | Pass (as revised) | Mapping and labels tested; the id-leak check covers the six stage labels case-sensitively; `PAUSED_LABEL` is checked by exact value; `data-agent` is the only overlay |
| AC5 | Pass | `build-done` allows only `REQUEST_CHANGES` and `CLOSE`, neither of them an app event; it maps to Review |
| AC6 | Pass | 3, 6 and 9 kinds; the human map's keys are exactly the human-only events, and every value is in `HUMAN_ACTION_IDS` |
| AC7 | Pass | The module's only import is a type import from `./human-actions`, checked by an import scan |
| AC8 | Pass | D34, the new reference, the CHANGELOG and the stale-doc check in `changes.md`; the docs rule is in all eight phase files (grep) |
| AC9 | Pass locally | typecheck, lint and format:check pass; `pnpm test` gives 57 files, 1208 passed, 12 skipped (re-run by the orchestrator). CI is checked on the PR |

## Needs a runtime check

- CI on the pull request (the `check` job, and `e2e` on Windows, macOS and Linux). This change adds no e2e test, but the merge rule needs every job green.

## Review ledger

Covers every revision, copied from `docs/specs/p3-state-machine/build-ledger.md`.

### Revision 0

No review ran. The build paused during implementation on a spec problem (below).

### Revision 1, round 1 (PASS)

| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| ------- | -------- | -------- | -------------------- | --------- | ------ |
| (none)  |          |          |                      |           |        |

## Spec revisions

- **Revision 1:** AC4 fixed the label "Build, paused" and also forbade any label containing an internal id, but `paused` is a node id. You chose **Revise the spec**: the id check covers the six `STAGE_LABELS`, and `PAUSED_LABEL` is exempt and checked by its exact value. Not taken: rewording the label, and narrowing the check to multi-word ids.

## Rejected findings

none

## Open issues

none

Left alone on purpose, and recorded in `changes.md`:
- `docs/roadmap.md` still shows Phase 3 as "not started". That status is updated when a phase starts and ends.
- The progress row's status and commit are filled in after the merge.

## Git state

Branch `feature/p3-state-machine`; approved; committed and pushed in the commit that adds this report.

## Next steps

Approve, then commit and push, and open a pull request; merge only when CI is green on every job. Or request changes.
