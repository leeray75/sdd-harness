# Tasks: p2-human-only-channel

Work in order. After each task, run its check, then tick the box.

- [x] **T1: Shared contract.** Create `src/shared/human-actions.ts` with `HUMAN_ACTION_IDS`, the request and result types and `parseHumanActionRequest`, and its unit tests (AC1). **Check:** `pnpm typecheck && pnpm exec vitest run tests/unit/human-actions.test.ts` passes.
- [x] **T2: Gesture tracker.** Create `src/main/human/gesture.ts` (pure, with the clock injected, `GESTURE_WINDOW_MS = 1000`) and its unit tests (AC2). **Check:** `pnpm exec vitest run tests/unit/human-gesture.test.ts` passes.
- [x] **T3: Channel.** Create `src/main/human/channel.ts` with the ordered checks, the registry, handler errors and the one log line per call, and its unit tests (AC3). **Check:** `pnpm exec vitest run tests/unit/human-channel.test.ts` passes.
- [x] **T4: Bridge and wiring.**
  - Add `IPC_CHANNELS.humanAction` and `HarnessBridge.humanAction`.
  - Implement the call in the preload.
  - In `src/main/index.ts`, create the tracker, attach it to the main window's `input-event`, create the channel with the existing sender check and `log`, and register the IPC handler, with no action handlers.
  - Update the bridge test (AC4).

  **Check:** `pnpm typecheck && pnpm exec vitest run tests/unit/bridge.test.ts` passes.
- [x] **T5: The agent can't reach it.** Add the AC5 tests (protocol guard, tool names, `src/agent/` source scan) and the AC6 router test (a file and a ticket saying "approve the spec" and "git push", then scripted calls for `approve_spec`, `git_push` and `run_command git push`, all refused with Rule events, and no spy handler called). Revised in revision 1: the Rule events name `run_command` and record `-` for `approve_spec` and `git_push` (D30); check that the test asserts exactly that. **Check:** the new tests pass.
- [x] **T6: e2e.** Create `tests/e2e/human-action.spec.ts` with cases (a) to (f) of AC7. **Check:** `pnpm e2e` passes locally on Windows (CI covers macOS and Linux).
- [x] **T7: Docs.**
  - D33 in `docs/decisions.md`;
  - the new `docs/human-actions.md`;
  - `CHANGELOG.md` entries;
  - in the phase-02 progress file, the open question struck and settled, and D33 listed;
  - the stale-doc check recorded in `changes.md`, with any stale mention fixed.

  Run `pnpm exec prettier --write` on the edited docs (AC8). **Check:** `pnpm format:check` passes.
- [x] **T8: Full checks.** Run `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` (AC9; CI is checked on the PR). **Check:** all pass.
