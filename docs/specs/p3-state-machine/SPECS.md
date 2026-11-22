---
status: approved
ticket:
---

# p3-state-machine

## Problem

The harness has no model of the workflow yet. Phase 3's engine needs to know which states a feature can be in, which events move it, which of those events only a person may trigger, and which of the six user stages to show. The sdd plugin defines this in `hooks/machine.ts` (v0.18.0) on top of a vendored XState. The harness must port the same states and events (D5) without that runtime, so later subtasks can build the spec lock, the build loop and shipping on one shared table.

## Goals

- **G1:** One pure, typed workflow table in `src/shared/workflow.ts`, equal to the plugin's v0.18.0 machine, with no state-machine dependency.
- **G2:** Functions for the legal next events and for transitions, including a result that reports an illegal event.
- **G3:** Every path node maps to one of the six stages (Start, Plan, Spec, Build, Review, Done), with the paused variant of Build and plain-language labels.
- **G4:** Every event is classified as human-only, user or app, with the human-only events mapped to the D33 action ids, as data later subtasks use.
- **G5:** The docs are updated in the same change, including a new engine reference and the docs rule copied into every future subtask brief.

## Non-goals

- Spec templates, the state file, the hash lock, file watching (`p3-spec-docs`, `p3-spec-lock`).
- The build loop, the round limit counter, the ledger (`p3-build-loop`).
- Git, commit, push and close (`p3-ship`).
- Registering D33 handlers or changing the human-only channel.
- Any UI, any IPC change, and tracker writes (D8).
- Changing the sdd plugin's own templates in the separate `repos/claude` repo.

## Acceptance criteria

- **AC1: Ids match the plugin.** `src/shared/workflow.ts` exports `NODE_IDS` (12), `PATH_IDS` (the 11 nodes other than `data-agent`) and `EVENT_IDS` (18). Each equals the plugin's v0.18.0 list, order included. A unit test compares them with a literal copy held in the test.
- **AC2: Transitions match exactly.** `TRANSITIONS` holds the plugin's `MACHINE_CONFIG.states` as plain readonly data, and `INITIAL_NODE` is `idle`. A unit test walks every (node, event) pair, 12 × 18, against the literal copy of the plugin's config. Every plugin transition is present with the same target, and no other pair is legal.
- **AC3: Legal events and illegal transitions.**
  - `legalEvents(node)` returns the node's events in `EVENT_IDS` order.
  - `nextNode(node, event)` returns the target, or the same node when the event is illegal.
  - `transition(node, event)` returns `{ ok: true, node }` for a legal event, and `{ ok: false, node, reason }` for an illegal one, where `node` is unchanged and `reason` is fixed text naming only the two ids.
  - `isNodeId` and `isEventId` reject anything that isn't an id.
- **AC4: Stage mapping.**
  - `STAGE_IDS` is `start`, `plan`, `spec`, `build`, `review`, `done`, and `STAGE_LABELS` gives Start, Plan, Spec, Build, Review, Done.
  - `stageOf(node)` maps each of the 11 path nodes per `docs/workflow.md`: idle is Start; planning and plan-approved are Plan; spec-drafted and spec-changed are Spec; spec-approved, implementing and reviewing are Build; paused is Build with `paused: true`; build-done is Review; closed is Done.
  - `stageLabel` gives "Build, paused" for the paused node.
  - `isOverlay(node)` is true only for `data-agent`, which has no stage.
  - A test shows that none of the six `STAGE_LABELS` equals or contains an internal node or event id, with case-sensitive matching. `PAUSED_LABEL` is exempt from this check. A test checks it by its exact value, "Build, paused": the word "paused" there is plain English matching `docs/workflow.md` and the design, not a leaked id. (Revised in revision 1.)
- **AC5: The build stops and waits.** `reviewing` reaches `build-done` with `REVIEW_PASSED`. From `build-done`, the only legal events are `CLOSE` and `REQUEST_CHANGES`, and `build-done` maps to the Review stage. So no app event leaves `build-done`: a test checks that both legal events there are human-only or user.
- **AC6: Event kinds and the human map.**
  - `EVENT_KINDS` classifies all 18 events:
    - human-only: `APPROVE_SPEC`, `REAPPROVE`, `CLOSE`;
    - user: `START`, `APPROVE_PLAN`, `START_BUILD`, `REVISE`, `REQUEST_CHANGES`, `START_NEXT`;
    - app: `DRAFT_SPEC`, `EDIT_SPEC`, `IMPLEMENTED`, `REVIEW_ISSUES`, `REVIEW_PASSED`, `SPEC_PROBLEM`, `DATA_START`, `DATA_STOP`, `DATA_STOP_BUILD`.
  - `HUMAN_EVENT_ACTIONS` maps `APPROVE_SPEC` and `REAPPROVE` to `approve-spec`, and `CLOSE` to `mark-done`. Its keys are exactly the human-only events, and every value is in `HUMAN_ACTION_IDS`.
  - No human-only event is classified as app.
- **AC7: Pure shared module.** `src/shared/workflow.ts` imports nothing outside `src/shared/`, and no Node, Electron or DOM API. A test scans its imports.
- **AC8: Docs.** Done in the build on the feature branch, with `pnpm exec prettier --write` run on the edited docs:
  - **CHANGELOG:** an entry under `## [Unreleased]`, naming the feature and D34.
  - **D34:** added to `docs/decisions.md`. It records the hand-written table, its place, the stage mapping, the data-agent overlay, the event kinds and the human map, with the alternatives not taken.
  - **New doc, `docs/workflow-engine.md`:** the nodes, events and transitions, the stage mapping and labels, the event kinds and the human map. It is written so later Phase 3 subtasks can extend it.
  - **Stale docs:** each of these is checked and updated where stale, and the check is recorded in `changes.md`:
    - `CLAUDE.md`: the new doc added to "Read before planning", and the workflow table named;
    - `README.md`;
    - `docs/PRD.md`;
    - `docs/workflow.md`: the table's location, the event kinds and a link to the new doc;
    - `docs/phases/phase-03-workflow-engine.md`;
    - the Phase 3 progress file's follow-ups, if the file exists.
  - **Docs rule in future briefs:** `docs/phases/README.md` and the subtask-brief instructions of the Phase 3–9 phase docs each state that a subtask's acceptance criteria include the docs item. That item covers the CHANGELOG, every stale doc (`CLAUDE.md`, `README.md`, the PRD, `workflow.md`, the phase doc, the progress follow-ups) and useful new docs named in the spec.
- **AC9: Checks pass.** `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test` pass. CI is checked on the pull request.

## Open questions

- 2026-11-22, revision 1: AC4's fixed label "Build, paused" contained the node id `paused`, which conflicted with its own no-internal-id check. The user chose to exempt `PAUSED_LABEL` from the id check and check it by exact value instead. The check still covers the six stage labels. Not taken: rewording the label (for example "Build, on hold"), and narrowing the check to multi-word ids.
