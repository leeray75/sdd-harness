# Plan: p3-state-machine

Ticket: (none, vibe planning)
Status: approved
Date: 2026-11-22

## Objective

Port the sdd plugin's workflow states and events (`hooks/machine.ts`, v0.18.0) into the harness as a hand-written, typed transition table, so the Phase 3 engine can drive one feature through the workflow without a state-machine library. Each path node maps to one of the six user stages with a plain-language label, and each event is classified as human-only, user or app. Later subtasks use this table to tie events to the D33 handlers, the spec lock, the build loop and shipping.

## Scope

- **In:**
  - the 12 node ids and 18 event ids, in the plugin's order;
  - a plain-data transition table equal to the plugin's `MACHINE_CONFIG`;
  - `legalEvents`, `nextNode` and a transition result that reports illegal events;
  - stage mapping and plain-language labels;
  - event kinds, and the event-to-human-action map;
  - tests;
  - the docs task (see Approach step 3): CHANGELOG, every stale doc (`CLAUDE.md` and `README.md` included), decision D34, a new `docs/workflow-engine.md`, and the docs rule written into the phase docs so every future sdd subtask carries it.
- **Out:**
  - spec templates, state file, hash lock, file watching, build loop, git, commit or push;
  - registering D33 handlers (`p3-spec-lock` and `p3-ship`);
  - any UI;
  - tracker writes.

## Decisions

| Question                       | Decision                                                                                                                                                                                                                                                                                          | Alternatives considered                                                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subtask list for Phase 3       | Six subtasks: state machine, spec docs, spec lock, build loop, ship, headless e2e. Taken as the recommended default when the user went ahead with `/sdd:start`.                                                                                                                                  | The phase doc's five, with spec docs and lock as one subtask                                                                                                  |
| State machine implementation   | A hand-written typed table with pure functions and no new dependency                                                                                                                                                                                                                             | XState from npm, as the plugin uses (vendored there)                                                                                                         |
| Where the table lives          | `src/shared/workflow.ts`: pure, no Node, Electron or DOM imports, read by main and later by the renderer                                                                                                                                                                                         | `src/main/workflow/`, main only                                                                                                                               |
| Data-agent stage               | An overlay with no stage. It stays in the table so the port is exact; the stage functions cover the 11 path nodes, and callers show the stage of the path node it left.                                                                                                                         | Map it to Plan; drop it from the table                                                                                                                        |
| Event kinds                    | Three kinds. **human-only:** `APPROVE_SPEC`, `REAPPROVE`, `CLOSE`. **user:** `START`, `APPROVE_PLAN`, `START_BUILD`, `REVISE`, `REQUEST_CHANGES`, `START_NEXT`. **app:** `DRAFT_SPEC`, `EDIT_SPEC`, `IMPLEMENTED`, `REVIEW_ISSUES`, `REVIEW_PASSED`, `SPEC_PROBLEM`, `DATA_START`, `DATA_STOP`, `DATA_STOP_BUILD`. | `EDIT_SPEC` human-only as well; two kinds only, with user folded into app                                                                                    |
| Human-action map               | `APPROVE_SPEC` and `REAPPROVE` map to `approve-spec`; `CLOSE` maps to `mark-done`. `approve-result` has no event: the feature stays in `build-done`, and `p3-ship` handles it. `edit-approved-spec` and `change-rules` raise no event themselves; a saved spec change is seen as `EDIT_SPEC` by the app. | Add a result-approved node or event, which would break exact parity with the plugin                                                                           |
| Feature slug, branch, base     | `p3-state-machine` on `feature/p3-state-machine` from `main` (convention from Phases 0–2)                                                                                                                                                                                                        | n/a                                                                                                                                                           |
| Docs scope (user request at plan review) | The docs item is an explicit task and acceptance criterion: CHANGELOG, every stale doc including `CLAUDE.md` and `README.md`, a new `docs/workflow-engine.md`, and the docs rule copied into `docs/phases/README.md` and the Phase 3–9 briefs, so every future sdd subtask carries it | Rely only on the existing `CLAUDE.md` rule; also change the sdd plugin's own templates in the separate `repos/claude` repo (outside this repo; left as a possible follow-up) |
| New decision number            | D34                                                                                                                                                                                                                                                                                               | n/a                                                                                                                                                           |

## Approach

1. **`src/shared/workflow.ts`** (new, pure; imports only `HumanActionId` from `./human-actions`):
   - `NODE_IDS`, `NodeId`, `PATH_IDS`, `PathId`, `EVENT_IDS`, `EventId`, copied from the plugin, order included;
   - `TRANSITIONS: Record<NodeId, Partial<Record<EventId, NodeId>>>`, the plugin's `MACHINE_CONFIG.states` as plain readonly data, and `INITIAL_NODE = 'idle'`;
   - `legalEvents(node)`: events in `EVENT_IDS` order;
   - `nextNode(node, event)`: the target node, or the same node when the event is illegal;
   - `transition(node, event)`: `{ ok: true, node }` or `{ ok: false, node, reason }`, with a fixed reason text that never echoes caller input beyond the ids;
   - `isNodeId` and `isEventId` guards;
   - `STAGE_IDS` (`start`, `plan`, `spec`, `build`, `review`, `done`), `STAGE_LABELS` (Start, Plan, Spec, Build, Review, Done) and `PAUSED_LABEL` ("Build, paused");
   - `stageOf(node: PathId)`: `{ stage, paused }` per `docs/workflow.md`, with `paused` true only for `paused`, plus `stageLabel(view)`;
   - `isOverlay(node)`: true only for `data-agent`;
   - `EVENT_KINDS: Record<EventId, 'human-only' | 'user' | 'app'>` and `HUMAN_EVENT_ACTIONS` (`APPROVE_SPEC` and `REAPPROVE` to `approve-spec`, `CLOSE` to `mark-done`).
2. **Tests** in `tests/unit/workflow-*.test.ts`:
   - parity: node and event lists, and every (node, event) pair against a literal copy of the plugin's v0.18.0 config held in the test;
   - legal events, illegal transitions, stage mapping and labels;
   - the build-done gate (AC5);
   - event kinds and the human map;
   - an id-leak check: no label equals or contains an internal node id;
   - a purity check: the module imports nothing outside `src/shared/`.
3. **Docs** (a task and an acceptance criterion in the spec, done in the build on the feature branch, not after the merge):
   - `CHANGELOG.md`: an entry under `## [Unreleased]`.
   - **Stale docs, each checked and updated where the work makes it stale:**
     - `CLAUDE.md`: add the new doc to "Read before planning", and name `src/shared/workflow.ts` as the one workflow table;
     - `README.md`;
     - `docs/PRD.md` (F2);
     - `docs/workflow.md`: a note that the states and events live in `src/shared/workflow.ts`, the event kinds, and a link to the new doc;
     - `docs/phases/phase-03-workflow-engine.md` and the Phase 3 progress file's follow-ups.
   - **New doc, `docs/workflow-engine.md`:** the engine's reference, in the style of `docs/human-actions.md` and `docs/agent-commands.md`. It covers the nodes, events and transitions, the stage mapping and labels, the event kinds, and the human-action map. Later Phase 3 subtasks extend it with the spec lock, the build loop and shipping.
   - **D34** in `docs/decisions.md`: the hand-written table, its place, the stage mapping, the overlay, the event kinds and the human map.
   - **Docs rule for every future sdd subtask:** add one line to the subtask brief in `docs/phases/README.md` and in each phase doc that still has subtasks to run (Phases 3–9). It says the acceptance criteria include the docs item: the CHANGELOG, every stale doc (`CLAUDE.md`, `README.md`, the PRD, `workflow.md`, the phase doc, the progress follow-ups), and useful new docs named in the spec. This matches the rule already in `CLAUDE.md` (Conventions).

## Verified assumptions

| Assumption                                                                                     | Evidence                                                                                          |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| The plugin source is v0.18.0 and its machine has 12 nodes, 18 events and the listed transitions | `repos/claude/plugins/sdd-plugin/.claude-plugin/plugin.json` (`"version": "0.18.0"`); `hooks/machine.ts:12-89` |
| The plugin has no result-approval event; `build-done` accepts only `CLOSE` and `REQUEST_CHANGES` | `hooks/machine.ts:87`                                                                             |
| The D33 action ids include `approve-spec` and `mark-done`                                      | `src/shared/human-actions.ts:8-14`                                                                |
| Shared modules are pure and import only from `src/shared/`                                     | `src/shared/jobs.ts:1-7`, `src/shared/human-actions.ts:1-3`                                       |
| Stage mapping and the paused variant                                                           | `docs/workflow.md` (reference table); `docs/design-notes.md:84-90`                                |
| The last decision is D33                                                                       | `docs/decisions.md:318`                                                                           |

## Risks

- **The plugin moves on past v0.18.0.** The test pins a literal copy of the v0.18.0 config, so any change to the port is deliberate. The plugin itself is not read at test time, because CI doesn't have it.
- **Event kinds are a guess at wiring that doesn't exist yet.** Later subtasks may refine them. D34 records them as a starting classification that later subtasks may amend, as D19 was amended.

## Open questions

None.
