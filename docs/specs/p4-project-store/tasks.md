# Tasks: p4-project-store

Work in order. After each task, run its check, then tick the box.

- [x] **T1: Rules.** Create `src/shared/project-rules.ts` as the spec's Design says: the `ProjectRules` type, `DEFAULT_RULES`, `checkRoundLimit`, `parseRules` and `formatCommitMessage`, with fixed reasons. Make `roundLimit` in `src/main/workflow/build-loop.ts` call `checkRoundLimit` and return the same results. Add `tests/unit/project-rules.test.ts`, covering every AC3 case, the defaults, and `formatCommitMessage` with a ticket, with no ticket, and with a custom format. **Check:** `pnpm exec vitest run tests/unit/project-rules.test.ts tests/unit/build-loop.test.ts` passes.
- [x] **T2: Store.** Create `src/main/projects/store.ts` (`createProjectStore`, no Electron import) with `load`, `list`, `get`, `add`, `rename`, `setRules` and `remove`, the add checks, the atomic save, and the corrupt-file set-aside. Add `tests/unit/project-store.test.ts` on temp folders, covering:
  - AC1: every operation, persistence through a second store, and each refused add, including the duplicate case rules per platform, passed as `platform`;
  - AC2: the before-and-after hash of the folder around `remove`;
  - AC6: not JSON, another version, an invalid project, a missing file, and a failed rename;
  - a failed save leaving the list unchanged.

  **Check:** `pnpm exec vitest run tests/unit/project-store.test.ts` passes.

- [x] **T3: Request shape.** Add `project` to `HumanActionRequest` and `parseHumanActionRequest` in `src/shared/human-actions.ts` (exactly `action`, `project` and `feature`; `dev` or a lowercase UUID). Add `project=<id>` to the channel's decision line in `src/main/human/channel.ts`. Update the bridge type if it needs it, and update `tests/unit/human-*.test.ts`, `tests/unit/spec-handlers.test.ts`, `tests/unit/ship-handlers.test.ts`, `tests/unit/headless-e2e.test.ts` and `tests/e2e/human-action.spec.ts` to send `project`. Add guard cases for a missing project, an extra key and a bad id. **Check:** `pnpm exec vitest run tests/unit/human-actions.test.ts tests/unit/human-channel.test.ts` passes.
- [x] **T4: Commit format in ship.** Replace `commitMessage` in `src/main/workflow/ship.ts` with `formatCommitMessage`, and pass `commitFormat` (default `DEFAULT_RULES.commitFormat`) through `approveResult`'s options and `ShipHandlersDeps`. Extend `tests/unit/ship.test.ts` with a custom-format commit, a no-ticket commit under a custom format, and an unchanged default (AC4). **Check:** `pnpm exec vitest run tests/unit/ship.test.ts tests/unit/ship-handlers.test.ts` passes.
- [x] **T5: Registry.** Create `src/main/projects/registry.ts` (`createProjectRegistry`, no Electron import) as the spec's Design says, covering:
  - the store's projects plus the dev project;
  - one watcher per project;
  - per-project spec and ship handlers;
  - `handlerFor(action)`, with the unknown-project refusal;
  - `addProject`, `removeProject` and `close`;
  - `buildOptionsFor`.

  Add `tests/unit/project-registry.test.ts`, covering:
  - AC5: two projects in two temp folders, where `approve-spec` for one changes only that folder, and an unknown project is refused with nothing changed;
  - AC7: watchers closed on remove and on `close`, with a fake `startLock`;
  - AC4: `buildOptionsFor` giving round limit 1, and a build controller built with it stopping after one review round, with the scripted provider in `tests/support/scripted-provider.ts`.

  **Check:** `pnpm exec vitest run tests/unit/project-registry.test.ts` passes.

- [x] **T6: App wiring.** In `src/main/index.ts`:
  - create the store in `userData` and load it;
  - add the dev project from `HARNESS_SPIKE_ROOT` in unpackaged runs only;
  - create the registry and register the four handlers with `registry.handlerFor`;
  - point the spike agent's live context at the dev project's watcher;
  - close the registry at `before-quit`;
  - remove `startSpecLock`.

  `change-rules` stays unregistered. **Check:** `pnpm typecheck` passes, and `pnpm e2e` passes (it builds the app and runs the human-action test with `project`).

- [x] **T7: Docs.** Do every item in AC8:
  - the `CHANGELOG.md` entry under `## [Unreleased]`;
  - D40 in `docs/decisions.md`, plus a note under D33 that D40 amends its request shape;
  - `docs/workflow-engine.md` (projects, the registry, the request shape);
  - `docs/human-actions.md` (the request's three fields and the unknown-project refusal);
  - `CLAUDE.md` and `README.md` where they describe `HARNESS_SPIKE_ROOT` or the human-only request;
  - `docs/PRD.md` and `docs/workflow.md` if they are affected;
  - `docs/phases/phase-04-projects.md`, and the follow-ups in `docs/phases/phase-04-progress.md`.

  **Check:** `grep -n "D40" docs/decisions.md` finds it, and `pnpm format:check` passes.

- [x] **T8: Full checks.** Run `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test`. Give slow temp-folder tests an explicit timeout if they time out under full parallel load. **Check:** all four pass.
