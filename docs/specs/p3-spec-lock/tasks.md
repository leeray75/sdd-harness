# Tasks: p3-spec-lock

Work in order. After each task, run its check, then tick the box.

- [x] **T1: State file module.** Create `src/shared/spec-state.ts`, pure, with:
  - `SPEC_STATE_FILE`, `SPEC_STATE_VERSION` and `MAX_SPEC_STATE_BYTES`;
  - `parseSpecState`, `serializeSpecState`, `normalizeSpecText`, `approvalFor`, `setFrontmatterStatus` and `hasRequiredHeadings`, as in the spec's Design.

  Add `tests/unit/spec-state.test.ts`, covering the parse problems, the approval table, normalization, the frontmatter cases (CRLF kept, no frontmatter, existing status) and the import scan (AC2 parse, AC8 purity). **Check:** `pnpm typecheck && pnpm exec vitest run tests/unit/spec-state.test.ts` passes.
- [x] **T2: Lock on disk and scan.** Create `src/main/workflow/spec-lock.ts` with `readSpecState`, `writeSpecState` (temp file and rename), `hashSpec`, `approvalOf`, `currentFeature` and `scanSpecFoldersWithLock`. Guard `approvalOf` in `scanSpecFolders` (a throw gives `unchecked`). Add `tests/unit/spec-lock.test.ts`, covering the AC1 round trip in temp dirs, the AC2 read and write cases, and AC5. **Check:** `pnpm exec vitest run tests/unit/spec-lock.test.ts tests/unit/spec-folders.test.ts` passes.
- [x] **T3: Watcher.** Create `src/main/workflow/spec-watch.ts` with `createSpecLockWatcher`. Add `tests/unit/spec-watch.test.ts` (AC3), with real `fs.watch` on temp dirs, a 2 s bound, and the missed-event refresh case. **Check:** `pnpm exec vitest run tests/unit/spec-watch.test.ts` passes, twice in a row.
- [x] **T4: Handlers.**
  - Add `refused` to `HumanActionRefusal`.
  - Create `src/main/human/spec-handlers.ts` with `createSpecHandlers`.
  - Register the handlers and start the watcher in `src/main/index.ts` when a project root exists.

  Add `tests/unit/spec-handlers.test.ts`, driving them through `createHumanActionChannel(...).handle` with fakes. It covers the refusals, the success writes, the restore on a failed state write, and that blocked calls never reach a handler (AC4). Update the human-action tests that list refusal codes, if any. **Check:** `pnpm typecheck && pnpm exec vitest run tests/unit/spec-handlers.test.ts tests/unit/human-channel.test.ts tests/unit/human-actions.test.ts tests/unit/human-agent-boundary.test.ts` passes.
- [x] **T5: Policy.**
  - In `src/main/policy/context.ts`: the `locked` state, `specStateOf`, and the shared slug pattern and length.
  - In `gate.ts`: the `locked` rule.
  - In `src/main/agent/host.ts`: an optional live supplier merged into each call's context, wired to the watcher in `src/main/index.ts`.

  Extend `tests/unit/policy-gate.test.ts`, and add or extend a host test (AC6). **Check:** `pnpm typecheck && pnpm exec vitest run tests/unit/policy-gate.test.ts` and the host test pass.
- [x] **T6: Docs.**
  - D36 in `docs/decisions.md`;
  - a "Spec lock" section in `docs/workflow-engine.md`;
  - the handlers, `refused` and the status line in `docs/human-actions.md`;
  - the `CHANGELOG.md` entry;
  - stale docs checked and fixed: `CLAUDE.md`, `README.md`, `docs/PRD.md` (F2: tick the item), `docs/workflow.md`, `docs/agent-jobs.md`, the phase-03 doc and the progress follow-ups. Record the check in `changes.md`.

  Run `pnpm exec prettier --write` on the edited docs (AC7). **Check:** `pnpm format:check` passes, and `grep -n "D36" docs/decisions.md CLAUDE.md` finds both.
- [x] **T7: Full checks.** Run `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` (AC8; CI is checked on the PR). **Check:** all pass.
