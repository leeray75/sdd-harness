# Tasks: p0-design-tokens

Work in order. After each task, run its check, then tick the box. Run `pnpm` only from Windows (Git Bash or PowerShell), never from WSL.

- [x] **T1 — Token module.** Add `src/shared/tokens.ts` with every AC1 value, no imports, typed `as const` (AC1). **Check:** `pnpm typecheck` passes.
- [x] **T2 — CSS tokens and design notes.** Add `src/renderer/styles/tokens.css` (AC2), and add the `titlebar/close-hover` row to design-notes §2 (AC3). **Check:** every AC1 token has a property; `pnpm format:check` passes.
- [x] **T3 — Fonts and base styles.**
  - Run `pnpm add -D @fontsource/inter @fontsource/jetbrains-mono` from Windows.
  - Add `src/renderer/styles/base.css` (AC5).
  - Import the font weights, `tokens.css` and `base.css` in `main.tsx` (AC4).

  **Check:** `pnpm build` passes and `out/renderer` contains woff2 files; `index.html` and the CSP strings are unchanged.
- [x] **T4 — Button and Chip.** Add `src/renderer/components/Button.tsx`, `Button.css`, `Chip.tsx` and `Chip.css` (AC6, AC7). **Check:** `pnpm typecheck` and `pnpm lint` pass.
- [x] **T5 — Gallery.** Add `src/renderer/Gallery.tsx`, render it from `App.tsx` on `#gallery`, and append `#gallery` in `src/main/index.ts` under dev or `HARNESS_GALLERY=1` (AC8). **Check:** `pnpm build` passes; the built app opened with `HARNESS_GALLERY=1` shows the gallery, and without it shows the shell.
- [x] **T6 — Title bar and main on tokens.** Rewrite `titlebar.css` on the tokens, and set main's `backgroundColor` from `tokens.ts` (AC9). **Check:** no hex colour remains in `src/renderer` (except `styles/tokens.css`) or `src/main`; `pnpm e2e` window-chrome tests pass.
- [x] **T7 — Unit tests.** Add `tests/unit/tokens.test.ts` with the values, CSS parity, hex scan and contrast tests (AC10). **Check:** `pnpm test` passes.
- [x] **T8 — e2e tests.** Add `tests/e2e/design-tokens.spec.ts` (AC11). **Check:** `pnpm e2e` passes. _Revised in revision 1: the font-origin check uses Playwright `requestfinished` events instead of resource timing._
- [x] **T9 — Decision and repo checks.** Add D21 to `docs/decisions.md` (AC13), then run `pnpm format`. **Check:** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm e2e` and `pnpm build` all pass (AC12).
