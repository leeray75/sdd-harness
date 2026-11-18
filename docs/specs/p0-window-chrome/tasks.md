# Tasks: p0-window-chrome

Work in order. After each task, run its check, then tick the box.

- [x] **T1 — Bridge contract.** Extend `src/shared/bridge.ts` with the window channels, the event channel, `HarnessPlatform`, `HarnessWindowControls` and the new `HarnessBridge` members (AC1). **Check:** `pnpm typecheck` passes; the file still imports nothing from Node, Electron or the DOM.
- [x] **T2 — Preload.** Implement `platform` (with the normalizer) and `window` in `src/preload/index.ts`. `onMaximizedChange` passes a boolean only and returns its own remover (AC2). **Check:** `pnpm typecheck` passes; `ipcRenderer` is not part of the exposed object.
- [x] **T3 — Navigation guards helper.** Add `applyNavigationGuards(contents, appUrl)` to `src/main/security.ts` behind a minimal interface, with no Electron import (AC5). **Check:** `pnpm typecheck` passes.
- [x] **T4 — Main window and handlers.** In `src/main/index.ts`:
  - set the size, minimum size, background and per-OS frame options (AC3);
  - use `applyNavigationGuards`;
  - add the four sender-checked window handlers through one shared helper, plus the maximized-state event (AC4).

  **Check:** `pnpm build` passes; `pnpm dev` (or the built app) opens a frameless window.
- [x] **T5 — TitleBar component.** Add `src/renderer/TitleBar.tsx` and `src/renderer/titlebar.css` per AC6–AC8, and render it in `App.tsx` above the shell content. **Check:**
  - `pnpm typecheck` and `pnpm lint` pass;
  - in the running app, the bar is 40px and drags the window;
  - the buttons minimize, maximize/restore and close it.
- [x] **T6 — Unit tests.** Add `applyNavigationGuards` tests (and tests for any other pure helper) to `tests/unit/` (AC9). **Check:** `pnpm test` passes.
- [x] **T7 — e2e tests.** Add `tests/e2e/window-chrome.spec.ts` (AC10) and update the bridge-key checks in `tests/e2e/smoke.spec.ts` (AC11). **Check:** `pnpm e2e` passes.
- [x] **T8 — Decision and repo checks.** Add D20 to `docs/decisions.md` (AC13) and run `pnpm format`. **Check:** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` and `pnpm e2e` all pass (AC12).
