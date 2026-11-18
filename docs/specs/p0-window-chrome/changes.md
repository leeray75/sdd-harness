# Changes: p0-window-chrome

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/shared/bridge.ts | edited | Added the window and maximized-event channels (`EVENT_CHANNELS`), `HarnessPlatform`, `HarnessWindowControls`, the new `HarnessBridge` members, and the pure `toHarnessPlatform` normalizer used by the preload. No Node, Electron or DOM imports. | T1, T2 |
| src/preload/index.ts | edited | Exposes `platform` (from `process.platform` via the normalizer) and `window` with the four invoke calls and `onMaximizedChange`, which passes only a boolean and returns its own remover. `ipcRenderer` is still not exposed. | T2 |
| src/main/security.ts | edited | Added `applyNavigationGuards(contents, appUrl)` behind a minimal `GuardableContents` interface (no Electron import): window-open denied, foreign `will-navigate` and `will-redirect` prevented. | T3 |
| src/main/index.ts | edited | Window size 1280×800, minimum 1024×680, background `#0B0D10`; macOS `hiddenInset` with traffic lights at `{ x: 14, y: 13 }`, other platforms `frame: false`; `applyNavigationGuards` used; one `assertTrustedSender` check for all five handlers; window calls act only on `mainWindow`; maximized-state event on maximize, unmaximize, enter and leave full screen. | T4 |
| src/renderer/TitleBar.tsx | created | The 40px `header` title bar: app mark, empty `nav` "Location" slot, spacer, and on Windows and Linux three `button` caption controls (Minimize, Maximize/Restore, Close) with `aria-hidden` glyphs. Maximize state comes from `isMaximized()` and `onMaximizedChange`, unsubscribed on unmount. macOS gets the 78px left padding and no buttons. | T5 |
| src/renderer/titlebar.css | created | Title bar styles with local CSS variables (`bg/titlebar`, `border/subtle`, `text/muted`, `text/primary`, `bg/chip`, `accent`, close red), drag and no-drag regions, caption hover styles and focus rings (2px, −2px offset for caption buttons, 2px offset elsewhere). No inline styles, so the CSP is unchanged. | T5 |
| src/renderer/css.d.ts | created | Ambient `declare module '*.css'` so TypeScript accepts the stylesheet side-effect import in `TitleBar.tsx`. Needed by the strict typecheck; no runtime effect. | T5 |
| src/renderer/App.tsx | edited | Renders `TitleBar` above the existing empty-shell content. | T5 |
| tests/unit/security.test.ts | edited | Added `applyNavigationGuards` tests with a fake contents object: window-open denied, foreign `will-navigate` and `will-redirect` prevented, app URL allowed. | T6 |
| tests/unit/bridge.test.ts | created | Unit tests for `toHarnessPlatform` (darwin and linux kept, everything else reported as win32). | T6 |
| tests/e2e/window-chrome.spec.ts | created | e2e against the built app: frameless window and minimum size (Windows and Linux), 40px title bar with background and name, caption accessible names and Tab outline, macOS has no caption buttons, Minimize/Maximize/Restore via `BrowserWindow` state (polled), Close closes the app, `window.open` returns null with one window, foreign `location.href` leaves the app URL. macOS branches skip per `process.platform`. | T7 |
| tests/e2e/smoke.spec.ts | edited | Bridge key check now expects `['getVersion', 'platform', 'window']`, and `window.harness.window` keys are checked. No other check changed. | T7 |
| docs/decisions.md | edited | Added D20 (bridge shape: platform constant, nested `window` namespace, first main-to-renderer event with a boolean payload, sender check on every call), with alternatives. `pnpm format` run afterwards. | T8 |
| docs/specs/p0-window-chrome/tasks.md | edited | Ticked T1 to T8 after each check passed. | T1, T2, T3, T4, T5, T6, T7, T8 |
| docs/specs/p0-window-chrome/changes.md | created | This file. | T8 |
