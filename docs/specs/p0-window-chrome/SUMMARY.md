# Summary Report: p0-window-chrome
Ticket: none   Date: 2026-11-17
Outcome: Clean
Review rounds: 1 of 3 per revision; revisions: 0 of 2
Models: implementor haiku; reviewer sonnet; data agent not used (all chosen by the user); respawns: none

## What was built
The main window is now frameless per OS: `frame: false` on Windows and Linux, and `hiddenInset` with the traffic lights at `{ x: 14, y: 13 }` on macOS. It opens at 1280×800, with a 1024×680 minimum and a `#0B0D10` background (G1). A new 40px `TitleBar` component shows the app mark, an empty Location slot and a drag region. On Windows and Linux it has three 46×40 caption buttons with accessible names, hover styles (a red hover on Close) and an inset focus ring. On macOS it leaves 78px of padding (G2, G4). The buttons use the new bridge members `window.harness.platform` and `window.harness.window` (minimize, toggleMaximize, close, isMaximized, onMaximizedChange). Main answers each call only from the app's own window and pushes the maximized state back as a boolean-only event (G3, D20). The window-open and navigation guards moved into the pure `applyNavigationGuards`, which now has unit and e2e tests, closing the follow-up from `p0-toolchain-and-skeleton`. A new e2e test covers the title bar and the window controls, and the smoke test checks the new bridge keys (G5).

## Files changed
Product files (group 1):
| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/shared/bridge.ts | edited | Window and maximized-event channels (`EVENT_CHANNELS`), `HarnessPlatform`, `HarnessWindowControls`, new `HarnessBridge` members, pure `toHarnessPlatform`; no Node/Electron/DOM imports | T1, T2 |
| src/preload/index.ts | edited | Exposes `platform` and `window`; `onMaximizedChange` passes a boolean only and returns its own remover; `ipcRenderer` not exposed | T2 |
| src/main/security.ts | edited | `applyNavigationGuards(contents, appUrl)` behind a minimal interface, no Electron import | T3 |
| src/main/index.ts | edited | Size, minimum, background, per-OS frame options; guards helper; one sender check for all handlers; window calls act only on `mainWindow`; maximized event on maximize/unmaximize/full-screen changes | T4 |
| src/renderer/TitleBar.tsx | created | 40px header: app mark, Location slot, spacer, caption buttons (Windows/Linux), macOS padding; maximize state from `isMaximized` and `onMaximizedChange`, unsubscribed on unmount | T5 |
| src/renderer/titlebar.css | created | Local CSS variables, drag/no-drag, hover and focus styles; no inline styles, CSP unchanged | T5 |
| src/renderer/css.d.ts | created | `declare module '*.css'` for the stylesheet import under TS 6; no runtime effect | T5 |
| src/renderer/App.tsx | edited | Renders `TitleBar` above the shell content | T5 |
| tests/unit/security.test.ts | edited | `applyNavigationGuards` tests with a fake contents object | T6 |
| tests/unit/bridge.test.ts | created | `toHarnessPlatform` tests | T6 |
| tests/e2e/window-chrome.spec.ts | created | Frameless and minimum size, title bar, accessible names and focus outline, minimize/maximize/restore/close, macOS branch, denied `window.open`, blocked foreign navigation | T7 |
| tests/e2e/smoke.spec.ts | edited | Bridge keys `['getVersion', 'platform', 'window']` and the five `window` keys | T7 |
| docs/decisions.md | edited | D20 bridge shape, with alternatives | T8 |

Workflow files (group 2):
| File | Action | What and why | Task |
| --- | --- | --- | --- |
| docs/specs/p0-window-chrome/PLAN.md | created | Approved plan | plan |
| docs/specs/p0-window-chrome/SPECS.md | created | Approved spec (sha256 bd7d392c…) | plan |
| docs/specs/p0-window-chrome/SUBTASK.md | created | Child-ticket draft (tracker: none) | plan |
| docs/specs/p0-window-chrome/tasks.md | created | T1–T8, all ticked | T1–T8 |
| docs/specs/p0-window-chrome/build-ledger.md | created | Build ledger | build |
| docs/specs/p0-window-chrome/changes.md | created | Implementor's change notes | build |
| docs/specs/p0-window-chrome/SUMMARY.md | created | This report | build |

Git and `changes.md` agree: every file git shows is listed, and every listed file appears in git.

## Acceptance criteria
| AC | Status | Evidence |
| --- | --- | --- |
| AC1 | Met | bridge.ts channels, event channel, types and `HarnessBridge` members; no imports |
| AC2 | Met | preload exposes exactly `getVersion`, `platform`, `window`; boolean-only callback with its own remover; smoke test asserts the keys |
| AC3 | Met | index.ts window options per OS; e2e checks the minimum size and frameless (Windows) |
| AC4 | Met | `trustedMainWindow` → `assertTrustedSender` on all four handlers; acts on `mainWindow` only; event on four window events |
| AC5 | Met | `applyNavigationGuards` in security.ts, no Electron import, used by `createMainWindow` |
| AC6 | Met | TitleBar.tsx structure, drag/no-drag in titlebar.css, macOS branch; e2e checks 40px, background and name |
| AC7 | Met | Real buttons with names, `aria-hidden` glyphs matching `Flow0Empty` plus a restore glyph; e2e checks Maximize → Restore |
| AC8 | Met | titlebar.css variables, hover and focus values; no inline styles; index.html CSP unchanged |
| AC9 | Met | security.test.ts and bridge.test.ts; `pnpm test` 41 tests passed |
| AC10 | Met | window-chrome.spec.ts; `pnpm e2e` 9 passed, 1 skipped (the macOS-only test, on Windows) |
| AC11 | Met | smoke.spec.ts key checks |
| AC12 | Met | typecheck, lint, format:check, test, e2e and build passed (implementor's run, Windows) |
| AC13 | Met | D20 in docs/decisions.md with alternatives |

## Needs a runtime check
- Dragging the window by the title bar, and that the buttons and Location slot don't drag: only a manual check in `pnpm dev` can confirm `-webkit-app-region`.
- macOS: the traffic-light position `{ x: 14, y: 13 }` and the 78px padding are not run on Windows; check on a Mac or in `p0-ci`.
- The unit and e2e results are the implementor's run; the reviewer did not re-run them.
- The frameless e2e check is a proxy (content bounds equal window bounds), because Electron has no frame getter.

## Review ledger
### Revision 0, round 1  (PASS)
| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| (none) | | | | | |

## Spec revisions
none

## Rejected findings
none

## Open issues
- Implementor choices where the spec is silent:
  - entering and leaving full screen sends `win.isMaximized()`, so the event always carries the maximized state;
  - `css.d.ts`, `toHarnessPlatform` and `EVENT_CHANNELS` were added;
  - the foreign-navigation e2e check reads the DOM with `page.evaluate`, because Playwright locators stall on the cancelled navigation.
- CHANGELOG.md is updated after the merge, not in this commit.

## Git state
Branch `feature/p0-window-chrome`; approved; committed and pushed in the commit that adds this report.

## Next steps
Approve, commit and push; or request changes; or not yet.
