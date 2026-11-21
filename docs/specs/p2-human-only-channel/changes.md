# Changes: p2-human-only-channel

Mode 1 implementation (tasks T1 to T8). All work is uncommitted on `feature/p2-human-only-channel`.

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/shared/human-actions.ts | created | The five action ids, the `{ action, feature }` request, the result with its four refusal codes, and `parseHumanActionRequest` (exact keys, known id, slug of at most 64 characters, reasons never echo a value). Imports nothing outside src/shared. | T1 |
| tests/unit/human-actions.test.ts | created | Unit tests for AC1: each id, missing and extra keys, wrong types, arrays, null, bad slugs, and reasons that do not echo a value. | T1 |
| src/main/human/gesture.ts | created | Pure gesture tracker with the injected clock: left mouseDown and non-repeat Enter or Space count; `GESTURE_WINDOW_MS = 1000`; consume-once. | T2 |
| tests/unit/human-gesture.test.ts | created | Unit tests for AC2: each accepted and ignored input, the window edge, consume-once, a later gesture, a custom window. | T2 |
| src/main/human/channel.ts | created | Pure channel: sender, then guard, then gesture, then the registry; handler errors become `not-available` with `the action failed`; one decision line per call. | T3 |
| tests/unit/human-channel.test.ts | created | Unit tests for AC3: each refusal code, the order of checks, untrusted and invalid calls not consuming a gesture, handler results and throws, double registration, exact log lines, no raw value logged. | T3 |
| src/shared/bridge.ts | edited | Added `IPC_CHANNELS.humanAction = 'harness:human-action'` and `HarnessBridge.humanAction(request)`. | T4 |
| src/preload/index.ts | edited | Implements `humanAction` with `ipcRenderer.invoke`; no other member added. | T4 |
| src/main/index.ts | edited | Module-level gesture tracker and channel (existing `isTrustedSender` and `log`, no action handlers); `input-event` attached in `createMainWindow`; `ipcMain.handle` for the channel in `registerIpcHandlers`. | T4 |
| tests/unit/bridge.test.ts | edited | Kept the existing `toHarnessPlatform` tests; added the channel name, the member's type, and a preload test that mocks `electron` and checks the exposed keys and the invoke call. | T4 |
| tests/e2e/smoke.spec.ts | edited | The exact `window.harness` key list now includes `humanAction`. Without this the existing smoke test fails on the new member; it is the direct effect of AC4. | T4 |
| tests/unit/human-agent-boundary.test.ts | created | AC5: the protocol guard refuses `human-action` and every id (also at the router); no registry tool or job base tool matches a human-action id or a human step name; no file under src/agent names the channel or imports the bridge, the contract or electron (source scan). | T5 |
| tests/unit/human-text-acceptance.test.ts | created | AC6: real gate, real command policy (`commandPolicyFor`) and runner on a temporary root with a test script; a file and a ticket say "approve the spec" and "git push"; scripted `approve_spec`, `git_push` and `run_command git push` are denied with deny Rule events; spy handlers for all five ids are never called, with a fresh gesture pending. Revision 1: asserts the Rule events exactly (tool `run_command` for the command, `-` for `approve_spec` and `git_push`), and that the three denials add no log line and the requested names never reach the log. | T5, revision 1 |
| tests/e2e/human-action.spec.ts | created | AC7 cases (a) to (f) against the built app: no gesture, invalid, a real click, a second call, a real Enter, and a click older than the window. | T6 |
| docs/decisions.md | edited | D33 added after D32: the gesture rule, the order of checks, the registry, the agent boundary, the limit, and the alternatives not taken. D3 is not rewritten. | T7 |
| docs/human-actions.md | created | The new reference: five actions, request and result, the checks in order, gestures, refusal codes, logging, how Phase 3 registers a handler, and the limits. | T7 |
| CHANGELOG.md | edited | Entries under `[Unreleased]` / Added for the channel, the gesture check, the registry, the boundary tests, the e2e, and `docs/human-actions.md`. | T7 |
| docs/phases/phase-02-progress.md | edited | Open question "how a user gesture is verified" struck through and marked settled by D33; D33 added under Decisions added. Row 5 stays pending. | T7 |
| docs/phases/phase-02-tool-policy.md | edited | The same open question struck through and marked settled by D33 (stale: it still listed the question as open). | T7 |
| docs/PRD.md | edited | The D3 summary row and the Human-only actions NFR row said "a user click"; now "a user gesture (a click, or an Enter or Space press)", citing D33. | T7 |
| README.md | edited | The decisions row said "Settled decisions D1–D20" (already stale before this work); now "D1–D33". | T7 |
| docs/specs/p2-human-only-channel/tasks.md | edited | Ticked T1 to T8 after each check passed. T5 was unticked by revision 1 and is ticked again after its check passed. | T1, T2, T3, T4, T5, T6, T7, T8; T5, revision 1 |
| docs/specs/p2-human-only-channel/changes.md | created | This record. | T7 |

## Stale-doc check (T7)

| Doc | Result | Why |
| --- | --- | --- |
| CLAUDE.md | checked, not changed | Line 25 ("accepts these only from a user gesture in the app's own window (D3)") is still true; it says "gesture", not "click". No other mention is affected. |
| README.md | changed | The decisions row's count (D1–D20) was already stale; now D1–D33. No other mention. |
| docs/PRD.md | changed | Two rows said "user click" (the D3 summary and the Human-only actions NFR). With D33 an Enter or Space press also counts, so both now say gesture and cite D33. |
| docs/workflow.md | checked, not changed | It describes who decides and what each job may do; it names no mechanism and no click. Still true. |
| docs/phases/phase-02-tool-policy.md | changed | The open question "How a user gesture is verified" is struck through and marked settled by D33. Its "accepted only from a user gesture" line is still true. |

## Checks run

- `pnpm exec vitest run tests/unit/human-actions.test.ts` -> 27 passed
- `pnpm exec vitest run tests/unit/human-gesture.test.ts` -> 29 passed
- `pnpm exec vitest run tests/unit/human-channel.test.ts` -> 24 passed
- `pnpm exec vitest run tests/unit/bridge.test.ts` -> 6 passed
- `pnpm exec vitest run tests/unit/human-agent-boundary.test.ts tests/unit/human-text-acceptance.test.ts` -> 17 passed (revision 1 rerun, after the Rule event and log assertions were added)
- `pnpm build && pnpm exec playwright test tests/e2e/human-action.spec.ts` -> 6 passed (Windows)
- `pnpm typecheck` -> exit 0
- `pnpm lint` -> no output (clean)
- `pnpm format:check` -> All matched files use Prettier code style
- `pnpm test` -> 54 files passed; 1173 tests passed, 12 skipped
- `pnpm e2e` (after the smoke key-list fix) -> 21 passed, 2 skipped (the macOS-only cases); the first run had 1 failure (smoke key list), fixed as above

CI (`check`, and `e2e` on macOS and Linux) has not run; it runs on the PR.
