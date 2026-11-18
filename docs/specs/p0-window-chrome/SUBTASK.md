# Frameless window with the custom 40px title bar and window controls

**Parent:** none: no parent chosen
**Spec:** docs/specs/p0-window-chrome/SPECS.md
**Repo and base branch:** sdd-harness, main, feature branch feature/p0-window-chrome

## Context

The main window still uses the OS frame, but the designs call for a frameless window with a custom 40px title bar, OS-specific caption controls and a 1024×680 minimum size. This work makes the window frameless per OS (`frame: false` on Windows and Linux, `hiddenInset` on macOS) and adds a `TitleBar` component matching `Flow0Empty`. It adds typed bridge calls (`window.harness.platform` and `window.harness.window`) that main answers only from the app's own window, with the maximize state sent back as an event (D20). It also adds the missing automated test that `window.open` is denied and foreign navigation is blocked.

## Required work

- T1 Bridge contract
- T2 Preload
- T3 Navigation guards helper
- T4 Main window and handlers
- T5 TitleBar component
- T6 Unit tests
- T7 e2e tests
- T8 Decision and repo checks

## Acceptance criteria

- **AC1:** `src/shared/bridge.ts` declares the four window channels, the `harness:window-maximized-changed` event channel, `HarnessPlatform`, `HarnessWindowControls`, and `HarnessBridge` with exactly `getVersion`, `platform` and `window`.
- **AC2:** The preload exposes exactly those members. `platform` is normalized from `process.platform`. `onMaximizedChange` passes only a boolean and returns its own remover. `ipcRenderer` is not exposed.
- **AC3:** The window is 1280×800 by default with a 1024×680 minimum and a `#0B0D10` background. On macOS it uses `hiddenInset` with the traffic lights inside the 40px bar; on Windows and Linux it uses `frame: false`.
- **AC4:** The four window handlers run the `isTrustedSender` check, act only on the main window, and toggle maximize and restore. Main sends the maximized boolean on maximize, unmaximize and full-screen changes.
- **AC5:** A pure `applyNavigationGuards(contents, appUrl)` in `src/main/security.ts` denies `window.open` and prevents foreign `will-navigate` and `will-redirect`. The window uses it.
- **AC6:** `TitleBar` is a 40px `header` with `bg/titlebar`, a `border/subtle` bottom border, the app mark, an empty Location `nav`, a spacer and, on Windows and Linux, three 46×40 caption buttons. The header is a drag region and the buttons and slot are `no-drag`. On macOS it has 78px left padding and no caption buttons.
- **AC7:** The caption buttons are real buttons named Minimize, Maximize or Restore, and Close, with `aria-hidden` icons. The maximize button follows the window state and unsubscribes on unmount.
- **AC8:** Styles live in a stylesheet with local CSS variables, with no inline styles and no CSP change:
  - Minimize and Maximize gain `bg/chip` on hover;
  - Close turns `#C42B1C` with a white icon on hover;
  - caption buttons show a 2px `accent` focus ring with a −2px offset.
- **AC9:** Unit tests cover `applyNavigationGuards` and any other pure helper.
- **AC10:** `tests/e2e/window-chrome.spec.ts` covers:
  - the minimum size, the 40px title bar with its background and the app mark;
  - the accessible names and the focus outline;
  - minimize, maximize/restore and close on Windows and Linux;
  - no caption buttons on macOS;
  - a denied `window.open` and blocked foreign navigation.
- **AC11:** The smoke test checks that the harness keys are exactly `getVersion`, `platform` and `window`, and that the five `window` keys are exactly as declared.
- **AC12:** typecheck, lint, format:check, test and e2e pass (on Windows).
- **AC13:** D20 records the bridge shape and the alternatives not chosen.

## Out of scope

- The full design token set, bundled fonts, and the Button and Chip components (`p0-design-tokens`).
- Real repo, path or branch data in the title bar.
- Sidebar, icon rail or screen content.
- Remembering window size or position.
- CI and running e2e on macOS or Linux (`p0-ci`).

## Links

- Plan: docs/specs/p0-window-chrome/PLAN.md
- Spec and tasks: docs/specs/p0-window-chrome/SPECS.md, docs/specs/p0-window-chrome/tasks.md
