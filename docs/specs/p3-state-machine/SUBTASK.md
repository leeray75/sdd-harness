# Port the sdd workflow states and events to a typed table with stages and event kinds

**Parent:** none: no parent chosen
**Spec:** docs/specs/p3-state-machine/SPECS.md
**Repo and base branch:** sdd-harness, main, feature branch feature/p3-state-machine

## Context

The harness has no model of the workflow yet. Phase 3's engine needs the states a feature can be in, the events that move it, which events only a person may trigger, and the six user stages. The sdd plugin defines these in `hooks/machine.ts` (v0.18.0) on a vendored XState. This work ports them to one pure, typed table in `src/shared/workflow.ts` with no state-machine dependency. It adds legal-event and transition functions, the stage mapping and labels, and the event kinds mapped to the D33 action ids. The docs are updated in the same change.

## Required work

- T1 Ids and table
- T2 Transitions
- T3 Stages
- T4 Event kinds
- T5 Docs
- T6 Full checks

## Acceptance criteria

- **AC1: Ids match the plugin.** `NODE_IDS` (12), `PATH_IDS` (11) and `EVENT_IDS` (18) equal the plugin's v0.18.0 lists, order included. A unit test compares them with a literal copy.
- **AC2: Transitions match exactly.** `TRANSITIONS` equals the plugin's `MACHINE_CONFIG.states`, and `INITIAL_NODE` is `idle`. A test walks all 12 × 18 pairs, and no other pair is legal.
- **AC3: Legal events and illegal transitions.**
  - `legalEvents` returns events in `EVENT_IDS` order.
  - `nextNode` returns the same node for an illegal event.
  - `transition` returns `{ ok: false, node, reason }` for an illegal event, with fixed reason text.
  - `isNodeId` and `isEventId` reject anything that isn't an id.
- **AC4: Stage mapping.**
  - The six stages and their labels.
  - `stageOf` maps the 11 path nodes per `docs/workflow.md`, with paused shown as "Build, paused".
  - `data-agent` is an overlay with no stage.
  - No label contains an internal id.
- **AC5: The build stops and waits.** `REVIEW_PASSED` leads from `reviewing` to `build-done`. From `build-done`, only `CLOSE` and `REQUEST_CHANGES` are legal, and neither is an app event. `build-done` is the Review stage.
- **AC6: Event kinds and the human map.**
  - All 18 events are classified:
    - human-only: `APPROVE_SPEC`, `REAPPROVE`, `CLOSE`;
    - user: `START`, `APPROVE_PLAN`, `START_BUILD`, `REVISE`, `REQUEST_CHANGES`, `START_NEXT`;
    - app: the rest.
  - `HUMAN_EVENT_ACTIONS` maps `APPROVE_SPEC` and `REAPPROVE` to `approve-spec`, and `CLOSE` to `mark-done`.
  - No human-only event is classified as app.
- **AC7: Pure shared module.** The module imports nothing outside `src/shared/`, and no Node, Electron or DOM API.
- **AC8: Docs.** Done in the build on the feature branch:
  - the CHANGELOG entry;
  - D34;
  - the new `docs/workflow-engine.md`;
  - stale docs checked and updated: `CLAUDE.md`, `README.md`, the PRD, `workflow.md`, the Phase 3 doc and the progress follow-ups, recorded in `changes.md`;
  - the docs rule added to the subtask briefs in `docs/phases/README.md` and the Phase 3–9 docs.
- **AC9: Checks pass.** `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test` pass. CI is checked on the PR.

## Out of scope

- Spec templates, the state file, the hash lock, file watching.
- The build loop, the round limit counter, the ledger.
- Git, commit, push and close.
- Registering D33 handlers or changing the human-only channel.
- Any UI, any IPC change, and tracker writes (D8).
- Changing the sdd plugin's own templates in the separate `repos/claude` repo.

## Links

- Plan: docs/specs/p3-state-machine/PLAN.md
- Spec and tasks: docs/specs/p3-state-machine/SPECS.md, docs/specs/p3-state-machine/tasks.md
