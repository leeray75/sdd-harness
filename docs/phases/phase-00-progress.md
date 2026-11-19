# Phase 0 progress: Project scaffold

Status: in progress · Started: 2026-11-17

Remote: `origin` = https://github.com/leeray75/sdd-harness.git. Feature branches come into `main` through pull requests; `gh` is available through WSL.

Toolchain (recorded as D14–D18 by `p0-toolchain-and-skeleton`): pnpm via Corepack; Node 24; electron-vite; electron-builder; React + TypeScript 6 (strict); Vitest; Playwright for Electron; ESLint and Prettier.

| #   | Feature                   | Goal                                                                                                                                                                                            | Status | Spec                                                     | Commit                                                   |
| --- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------- | -------------------------------------------------------- |
| 1   | p0-toolchain-and-skeleton | Toolchain decided and recorded; app boots with secure defaults and the typed preload bridge; one unit test and one e2e smoke test pass                                                          | done   | [SUMMARY](../specs/p0-toolchain-and-skeleton/SUMMARY.md) | `22d7a04` (PR #1; work in `091dd51`, close in `1258c25`) |
| 2   | p0-process-layout         | Agent process stub (utilityProcess) with a typed message channel; main-process policy gate stub that denies everything by default, with tests                                                   | done   | [SUMMARY](../specs/p0-process-layout/SUMMARY.md)         | `bb54237` (PR #2; work in `bace5d9`, close in `51d45c2`) |
| 3   | p0-window-chrome          | Frameless window, 40px custom title bar per OS, drag regions, window controls                                                                                                                   | done   | [SUMMARY](../specs/p0-window-chrome/SUMMARY.md)          | `96b4c5c` (PR #3; work in `e9c40de`, close in `8dd55c5`) |
| 4   | p0-design-tokens          | Tokens from design-notes sections 2–4 as CSS variables/TS constants; bundled Inter and JetBrains Mono; Button (primary, gate, secondary, ghost, danger) and Chip components with a gallery page | done   | [SUMMARY](../specs/p0-design-tokens/SUMMARY.md)          | `886334d` (PR #4; work in `0eafcee`, close in `7b2a486`) |
| 5   | p0-ci                     | Lint, format, unit and e2e jobs on a Windows/macOS/Linux matrix; CLAUDE.md Commands section; suggested SDD_TEST_CMD                                                                             | done   | [SUMMARY](../specs/p0-ci/SUMMARY.md)                     | `7cbfda3` (PR #5; work in `7037d71`, close in `818fb29`) |
| 6   | p0-ci-linux-wm            | Run a window manager (fluxbox) under xvfb in Linux CI so the Maximize e2e test passes                                                                                                           | done   | [SUMMARY](../specs/p0-ci-linux-wm/SUMMARY.md)            | `1cc5e08` (PR #6; work in `a7974fc`, close in `14e7eeb`) |

## Decisions added

- D14 Package manager and Corepack (pnpm pinned in `packageManager`)
- D15 Build tooling and packaging (electron-vite, electron-builder; TypeScript pinned to 6.x until typescript-eslint supports 7)
- D16 UI framework (React + strict TypeScript; ESLint flat config; Prettier)
- D17 Test runners (Vitest unit, Playwright for Electron e2e)
- D18 Node version (Node 24 LTS)
- D19 Agent process and channel (utilityProcess with parentPort; hand-written message guards; default-deny gate in main; log-only on unexpected exit)
- D20 Window controls bridge shape (`window.harness.platform` constant; nested `window.harness.window`; boolean-only maximized event; sender check on every call)
- D21 Design tokens and bundled fonts (`src/shared/tokens.ts` plus `tokens.css` kept equal by a test; @fontsource; gallery behind dev or `HARNESS_GALLERY=1`; `titlebar/close-hover` token)
- D22 Continuous integration (GitHub Actions; `check` on Linux, `e2e` and unsigned package on Windows/macOS/Linux; retries, traces and HTML report in CI only; AppArmor sysctl instead of `--no-sandbox`; `SDD_TEST_CMD="pnpm test"`); amended by `p0-ci-linux-wm` for fluxbox under `xvfb-run`

## Follow-ups

- Confirm or revisit the TypeScript 6.x pin (D15) when typescript-eslint supports TypeScript 7.
- `pnpm-workspace.yaml` has a pnpm-written `minimumReleaseAgeExclude: electron@45.3.4`; update it on each Electron bump.
- ~~`pnpm e2e` and `pnpm package` were only run on Windows~~: CI now runs both on Windows, macOS and Linux; the macOS title-bar test passed on the macOS runner.
- PR #5 was merged while its Ubuntu e2e job was red (no window manager); PR #6 (`p0-ci-linux-wm`) was merged before its e2e jobs finished. The fluxbox fix is confirmed only once a `main` CI run is green on Ubuntu.
- GitHub warns that `actions/checkout@v4` and `actions/setup-node@v4` target the deprecated Node 20 runtime; bump them to the next major when convenient.
- Title-bar drag regions (`-webkit-app-region`) have no automated check; confirm by hand in `pnpm dev`.
- ~~`p0-design-tokens` replaces the local CSS variables in `src/renderer/titlebar.css`~~: done; the title bar uses the tokens.
- One e2e run crashed at launch in the untouched smoke test (worker exit code 3221226505); the rerun passed. If it recurs, investigate it; CI now retries twice and keeps a trace, so a recurrence shows as a flaky test in the report.
- The component gallery opens under `pnpm dev`, or in a built app with `HARNESS_GALLERY=1`; check its look by hand (the tests check computed values, not appearance).
- Prettier formats all Markdown under `docs/` except `docs/specs/` and `docs/design/`; run `pnpm format` after editing docs.
- The agent process gets a full copy of the app's environment (`src/main/agent/host.ts` `agentEnv`); give it an allowlisted env before Phase 1 passes it anything real.
- Agent-supplied strings (e.g. the tool name) are logged without escaping newlines or control characters; escape them in Phase 2.
- The router refuses a gate `allow` ("tool execution is not available yet"); Phase 2 replaces that branch with real execution.

## Phase summary

(written when the phase is done)
