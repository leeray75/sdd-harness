# Plan: Frameless window with the custom 40px title bar and window controls

Ticket: none (vibe planning; subtask 3 of Phase 0, docs/phases/phase-00-scaffold.md)
Status: approved
Date: 2026-11-17

## Objective

Make the main window frameless and give it the designed 40px title bar (design-notes §5, `Flow0Empty`): app mark, an empty slot for repo and path, a drag region, and on Windows and Linux three custom caption buttons (Minimize, Maximize/Restore, Close) at 46×40. macOS keeps its native traffic lights with `titleBarStyle: 'hiddenInset'` and about 78px of left padding. The buttons drive the window through new typed bridge calls that main answers only from the app's own window. The window gets its 1024×680 minimum size. This subtask also closes the open follow-up from `p0-toolchain-and-skeleton`: an automated test that `window.open` is denied and foreign navigation is blocked.

## Scope

- **In:**
  - frameless `BrowserWindow` per OS, minimum size 1024×680, default 1280×800;
  - window-control IPC handlers in main with the existing sender check, and a maximized-state event to the renderer;
  - bridge additions in `src/shared/bridge.ts` and `src/preload/index.ts`;
  - a `TitleBar` React component and its stylesheet, with only the colors and sizes it needs as local CSS variables;
  - extraction of the window-open and navigation guards into a pure, unit-tested helper;
  - unit tests, e2e tests, the updated smoke test;
  - decision D20 for the bridge shape.
- **Out:**
  - the full token set, bundled fonts, Button and Chip components (`p0-design-tokens`);
  - real repo, path or branch data in the title bar (later phases);
  - sidebar, icon rail and screen content (the empty shell content stays, below the title bar);
  - remembering window size and position;
  - CI (`p0-ci`).

## Decisions

| Question                         | Decision                                                                                                                                                                                                                                                                                       | Alternatives considered                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Feature slug, repo, base branch  | `p0-window-chrome`, sdd-harness, base `main`, branch `feature/p0-window-chrome`                                                                                                                                                                                                                | (fixed by the phase doc)                                                                                  |
| Tracker                          | None; the spec stays in `docs/specs/`                                                                                                                                                                                                                                                          | Ticket story                                                                                              |
| Bridge shape                     | `window.harness.platform` (`'win32' \| 'darwin' \| 'linux'`, a constant set by preload) and a nested `window.harness.window` with `minimize()`, `toggleMaximize()`, `close()`, `isMaximized()` and `onMaximizedChange(cb)` returning an unsubscribe function. Recorded as D20 (first nested namespace and first main → renderer event) | Flat keys (`minimizeWindow`, …, `getPlatform()`); platform as a CSS class set by main via `executeJavaScript` |
| Close button hover               | Minimize and Maximize gain `bg/chip` (`#1A1E24`) on hover (design-notes §9); Close gets a red fill `#C42B1C` with a white icon, like native caption buttons. Both kept as local CSS variables until `p0-design-tokens`                                                                           | `bg/chip` for all three                                                                                   |
| Focus ring                       | 2px `accent` (`#6EA8FE`) outline; caption buttons use a −2px (inset) offset so the ring is not clipped at the window edge; other focusable elements use the standard 2px offset                                                                                                                 | Standard 2px outside offset everywhere                                                                    |
| Window-open and navigation test  | Extract the guards into a pure helper with a unit test using a fake web contents, plus an e2e test against the real app                                                                                                                                                                        | e2e only; unit only                                                                                       |
| Platform detection in preload    | `process.platform`, which a sandboxed preload can read; any value other than `darwin` or `linux` is reported as `win32`                                                                                                                                                                       | An IPC call at startup                                                                                    |

## Approach

1. **Bridge contract** (`src/shared/bridge.ts`):
   - new channels `harness:window-minimize`, `harness:window-toggle-maximize`, `harness:window-close`, `harness:window-is-maximized`, and the event channel `harness:window-maximized-changed`;
   - types `HarnessPlatform` and `HarnessWindowControls`, and `HarnessBridge` gains `platform` and `window`.
2. **Preload** (`src/preload/index.ts`): implements the calls with `ipcRenderer.invoke`. `onMaximizedChange(cb)` registers an `ipcRenderer.on` listener that passes only the boolean to `cb` (never the IPC event), and returns a function that removes that listener. `ipcRenderer` itself is still never exposed.
3. **Main**:
   - `createMainWindow()`: `width: 1280, height: 800, minWidth: 1024, minHeight: 680, backgroundColor: '#0B0D10'`. On macOS: `titleBarStyle: 'hiddenInset'` and `trafficLightPosition` that centers the lights in the 40px bar (about `{ x: 14, y: 13 }`). On Windows and Linux: `frame: false`.
   - The window sends `harness:window-maximized-changed` with `true` or `false` on `maximize` and `unmaximize` (and on `enter-full-screen` / `leave-full-screen`).
   - The IPC handlers share one helper that runs `isTrustedSender` and throws on an untrusted sender, as `getVersion` does now. They act only on `mainWindow`, never on a window found from the event.
   - The window-open and navigation guards move into a pure helper, `applyNavigationGuards(contents, appUrl)` in `src/main/security.ts`. It takes a minimal interface (`setWindowOpenHandler`, `on`) so it has no Electron import, and `createMainWindow()` calls it.
4. **Renderer**:
   - `src/renderer/TitleBar.tsx`: a `header` 40px tall with `bg/titlebar` and a 1px `border/subtle` bottom border. It holds the app mark (the SVG and "SDD Harness" from `Flow0Empty`), an empty `nav aria-label="Location"` slot, a flexible spacer, and on Windows and Linux the three caption buttons.
   - The header is a drag region; the buttons and the location slot are `no-drag`. On macOS the header gets 78px left padding and no caption buttons.
   - Each caption button is a real `button` with `aria-label` Minimize, Maximize or Restore, and Close; its icon is `aria-hidden`. Maximize swaps to Restore (and its icon) from `isMaximized()` at mount and `onMaximizedChange` after that.
   - `src/renderer/titlebar.css` imported by the component: local CSS variables for `bg/titlebar`, `border/subtle`, `text/muted`, `text/primary`, `bg/chip`, `accent` and the close-hover red; hover and focus styles as decided. No inline `style` attributes, so the strict CSP is unchanged.
   - `App.tsx` renders `TitleBar` above the existing shell content; `global.d.ts` keeps typing `window.harness` from `HarnessBridge`.
5. **Tests**:
   - `tests/unit/security.test.ts` gains tests for `applyNavigationGuards`: the window-open handler returns `deny`; a foreign `will-navigate` or `will-redirect` URL is prevented; the app URL is not.
   - `tests/unit/` also covers anything else that is pure, for example the platform normalizer.
   - New `tests/e2e/window-chrome.spec.ts`:
     - the window is frameless, or hiddenInset on macOS;
     - its minimum size is 1024×680;
     - the title bar is 40px with the `bg/titlebar` color and shows the app mark;
     - the buttons have the accessible names, and Tab reaches them with a visible outline;
     - on Windows and Linux: Minimize minimizes, Maximize maximizes and the button becomes Restore, Restore restores, and Close closes the app;
     - `window.open` returns no window and no second window appears;
     - setting `location.href` to `https://example.com` leaves the page on the app URL.
   - `tests/e2e/smoke.spec.ts`: the harness keys become `['getVersion', 'platform', 'window']`, and `window.harness.window` has exactly its five keys.
6. **Docs**: D20 in `docs/decisions.md`, then `pnpm format`.

## Acceptance criteria (draft, for the spec)

- On Windows and Linux the window is frameless with custom 46×40 caption buttons; on macOS it uses hiddenInset with the traffic lights and the title bar leaves about 78px for them.
- The title bar is 40px, uses `bg/titlebar`, shows the app mark, and is a drag region; its buttons are not.
- Minimize, Maximize/Restore and Close work through typed bridge calls. Main handles each only from the app's own window. The maximize button shows the current state.
- The window's minimum size is 1024×680.
- The caption buttons are real buttons with accessible names and a visible focus style.
- A unit test and an e2e test prove `window.open` is denied and foreign navigation is blocked.
- e2e covers the title bar and the window controls. The smoke test asserts the new bridge keys. typecheck, lint, format:check, test and e2e pass.
- D20 records the bridge shape.

## Risks

- e2e for minimize and maximize can be timing-sensitive; the tests wait for the window state through `app.evaluate` instead of sleeping.
- Only Windows can be run locally. The macOS branch is checked by code review and by `p0-ci` later.
- `#C42B1C` and the other local CSS variables are temporary until `p0-design-tokens` replaces them with the token set.
