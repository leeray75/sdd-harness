# Tasks: p3-state-machine

Work in order. After each task, run its check, then tick the box.

- [x] **T1: Ids and table.** Create `src/shared/workflow.ts` with `NODE_IDS`, `PATH_IDS`, `EVENT_IDS`, their types, `INITIAL_NODE`, `TRANSITIONS`, `isNodeId` and `isEventId`. Add `tests/unit/workflow-machine.test.ts`, which holds a literal copy of the plugin's v0.18.0 lists and config and checks the ids and every (node, event) pair (AC1, AC2). **Check:** `pnpm typecheck && pnpm exec vitest run tests/unit/workflow-machine.test.ts` passes.
- [x] **T2: Transitions.** Add `legalEvents`, `nextNode` and `transition`, with fixed reason text, and their tests (AC3). **Check:** `pnpm exec vitest run tests/unit/workflow-machine.test.ts` passes.
- [x] **T3: Stages.** Add `STAGE_IDS`, `STAGE_LABELS`, `PAUSED_LABEL`, `stageOf`, `stageLabel` and `isOverlay`. Add `tests/unit/workflow-stages.test.ts`, covering the mapping, the labels, the overlay, the id-leak check and the `build-done` gate (AC4, AC5). Revised in revision 1: the id-leak check covers the six `STAGE_LABELS`, and `PAUSED_LABEL` is checked by its exact value "Build, paused". **Check:** `pnpm exec vitest run tests/unit/workflow-stages.test.ts` passes.
- [x] **T4: Event kinds.** Add `EVENT_KINDS` and `HUMAN_EVENT_ACTIONS`. Add `tests/unit/workflow-events.test.ts`, covering the kinds, the human map and the purity import scan (AC6, AC7). **Check:** `pnpm exec vitest run tests/unit/workflow-events.test.ts` passes.
- [x] **T5: Docs.**
  - D34 in `docs/decisions.md`;
  - the new `docs/workflow-engine.md`;
  - the `CHANGELOG.md` entry;
  - the stale-doc check of `CLAUDE.md`, `README.md`, `docs/PRD.md`, `docs/workflow.md`, the Phase 3 doc and the progress follow-ups, with fixes, recorded in `changes.md`;
  - the docs rule added to the subtask briefs in `docs/phases/README.md` and the Phase 3–9 docs.

  Run `pnpm exec prettier --write` on the edited docs (AC8). **Check:** `pnpm format:check` passes, and `grep -l "CHANGELOG" docs/phases/README.md docs/phases/phase-0[3-9]-*.md` lists all eight files.
- [x] **T6: Full checks.** Run `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` (AC9; CI is checked on the PR). **Check:** all pass.
