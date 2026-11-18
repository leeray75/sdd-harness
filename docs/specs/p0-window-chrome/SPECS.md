---
status: done
ticket:
---

# p0-window-chrome

## Problem

The main window still uses the OS frame and a default size, while the designs (design-notes §5, `Flow0Empty`) call for a frameless window with a custom 40px title bar, OS-specific caption controls and a 1024×680 minimum size. The renderer has no way to minimize, maximize or close a frameless window, so it needs new bridge calls. Main must accept those calls only from the app's own window. The window-open and foreign-navigation guards from `p0-toolchain-and-skeleton` (its AC4) still have no automated test.

## Goals

- **G1:** A frameless main window per OS: `frame: false` on Windows and Linux, `titleBarStyle: 'hiddenInset'` with native traffic lights on macOS. Minimum size 1024×680, default 1280×800.
- **G2:** A 40px `TitleBar` React component that matches the `Flow0Empty` title bar. It has the app mark, an empty location slot and a drag region, plus 46×40 caption buttons on Windows and Linux; on macOS it leaves room for the traffic lights.
- **G3:** Window controls exposed through typed bridge calls: `window.harness.platform` and a nested `window.harness.window`. Main handles them only from the app's own window, and the maximize state flows back to the renderer as an event. The shape is recorded as D20.
- **G4:** Accessible caption buttons: real buttons with names, keyboard reachable, a visible focus ring, and the hover styles decided in the plan.
- **G5:** Automated proof: unit and e2e tests for the window-open and navigation guards, e2e tests for the title bar and the controls, and the smoke test updated for the new bridge keys.

## Non-goals

- The full design token set, bundled Inter and JetBrains Mono, and the Button and Chip components (`p0-design-tokens`).
- Real repo, path or branch data in the title bar (later phases).
- Sidebar, icon rail or any screen content; the existing empty-shell content stays below the title bar.
- Remembering window size or position between runs.
- CI and running e2e on macOS or Linux (`p0-ci`).

## Acceptance criteria

- **AC1:** `src/shared/bridge.ts` (no Node, Electron or DOM imports) declares:
  - the IPC channels `harness:window-minimize`, `harness:window-toggle-maximize`, `harness:window-close`, `harness:window-is-maximized` and the event channel `harness:window-maximized-changed`;
  - `HarnessPlatform = 'win32' | 'darwin' | 'linux'`;
  - `HarnessWindowControls` with `minimize(): Promise<void>`, `toggleMaximize(): Promise<void>`, `close(): Promise<void>`, `isMaximized(): Promise<boolean>` and `onMaximizedChange(cb: (maximized: boolean) => void): () => void`;
  - `HarnessBridge` with exactly `getVersion`, `platform` and `window`.
- **AC2:** The preload exposes exactly those members:
  - `platform` comes from `process.platform`, with any value other than `darwin` or `linux` reported as `win32`;
  - `onMaximizedChange` passes only a boolean to the callback, never the IPC event, and returns a function that removes exactly that listener;
  - `ipcRenderer` is not exposed.
- **AC3:** Main creates the window with `width: 1280, height: 800, minWidth: 1024, minHeight: 680` and a `#0B0D10` background:
  - on macOS, `titleBarStyle: 'hiddenInset'` with a `trafficLightPosition` that places the lights inside the 40px bar;
  - on Windows and Linux, `frame: false`.
- **AC4:** Main registers handlers for the four window channels:
  - each one first runs the same sender check as `getVersion` (`isTrustedSender`) and throws on an untrusted sender;
  - each acts only on the app's main window;
  - `toggleMaximize` maximizes when not maximized and restores (unmaximizes) when maximized;
  - main sends `harness:window-maximized-changed` with the new boolean on `maximize`, `unmaximize`, `enter-full-screen` and `leave-full-screen`.
- **AC5:** The window-open and navigation guards live in a pure helper, `applyNavigationGuards(contents, appUrl)` in `src/main/security.ts`:
  - it takes a minimal interface rather than an Electron type, and has no Electron import;
  - the window-open handler returns `{ action: 'deny' }`;
  - `will-navigate` and `will-redirect` to a URL that is not the app's own page are prevented, and the app's own URL is not.

  `createMainWindow()` uses this helper.
- **AC6:** `src/renderer/TitleBar.tsx` renders a `header` that is 40px tall, with background `#0B0D10` (`bg/titlebar`) and a 1px `#23272E` (`border/subtle`) bottom border. It contains:
  - the app mark: the `Flow0Empty` SVG, `aria-hidden`, plus the text "SDD Harness";
  - an empty `nav` with `aria-label="Location"`;
  - a spacer;
  - on Windows and Linux, three caption buttons of 46×40.

  The header is `-webkit-app-region: drag`; the buttons and the location slot are `no-drag`. On macOS the header has 78px left padding and renders no caption buttons. `App.tsx` renders the title bar above the existing shell content.
- **AC7:** The caption buttons are `button` elements:
  - their accessible names are Minimize, Maximize (or Restore while the window is maximized) and Close;
  - their icons are `aria-hidden` and use the `Flow0Empty` glyphs, with a restore glyph for Restore;
  - the maximize button reads `isMaximized()` on mount and follows `onMaximizedChange`, unsubscribing on unmount;
  - clicking a button calls the matching bridge call.
- **AC8:** Styling is in a stylesheet imported by the component, with no inline `style` attributes and no change to the CSP. Local CSS variables cover `bg/titlebar` `#0B0D10`, `border/subtle` `#23272E`, `text/muted` `#A0A8B3`, `text/primary` `#E8EAED`, `bg/chip` `#1A1E24`, `accent` `#6EA8FE`, and the close-hover red `#C42B1C`. Hover and focus styles:
  - Minimize and Maximize gain `bg/chip` on hover;
  - Close turns `#C42B1C` with a white icon on hover;
  - caption buttons show a 2px `accent` outline at a −2px offset on `:focus-visible`;
  - other focusable elements in the title bar show a 2px offset.
- **AC9:** Unit tests (Vitest) cover `applyNavigationGuards` with a fake contents object: the window-open handler denies; foreign `will-navigate` and `will-redirect` URLs are prevented; the app URL is allowed. Any other pure helper added (for example, the platform normalizer) is unit tested too.
- **AC10:** A new e2e test, `tests/e2e/window-chrome.spec.ts`, against the built app checks:
  - the minimum size reads 1024×680;
  - the title bar is 40px tall, has background `rgb(11, 13, 16)` and shows "SDD Harness";
  - the buttons have the accessible names, and keyboard Tab focus on a caption button shows a non-`none` outline;
  - on Windows and Linux, Minimize minimizes the window and Maximize maximizes it, after which the button is named Restore, and Restore restores it. Each is checked through `app.evaluate` on the `BrowserWindow` state, waited for rather than slept;
  - on Windows and Linux, Close closes the app;
  - on macOS, no caption buttons are rendered;
  - `window.open('https://example.com')` returns `null` and no second window appears;
  - setting `location.href` to `https://example.com` leaves the page on the app URL.
- **AC11:** `tests/e2e/smoke.spec.ts` checks that the `window.harness` keys are exactly `['getVersion', 'platform', 'window']` and the `window.harness.window` keys are exactly `['close', 'isMaximized', 'minimize', 'onMaximizedChange', 'toggleMaximize']`. Its existing checks still pass, updated only as the title bar requires.
- **AC12:** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` and `pnpm e2e` pass (on Windows).
- **AC13:** D20 in `docs/decisions.md` records the bridge shape: the `platform` constant, the nested `window` namespace, the first main → renderer event and its boolean-only payload, and the sender check on every call. It also lists the alternatives not chosen: flat keys, and platform as a CSS class set by main.

## Open questions

- none
