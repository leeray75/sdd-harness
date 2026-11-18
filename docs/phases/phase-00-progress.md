# Phase 0 progress: Project scaffold

Status: in progress · Started: 2026-11-17

Remote: `origin` = https://github.com/leeray75/sdd-harness.git. Feature branches come into `main` through pull requests; `gh` is available through WSL.

Toolchain (recorded as D14–D18 by `p0-toolchain-and-skeleton`): pnpm via Corepack; Node 24; electron-vite; electron-builder; React + TypeScript 6 (strict); Vitest; Playwright for Electron; ESLint and Prettier.

| #   | Feature                   | Goal                                                                                                                                                                                            | Status  | Spec                                                     | Commit                                                   |
| --- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------- | -------------------------------------------------------- |
| 1   | p0-toolchain-and-skeleton | Toolchain decided and recorded; app boots with secure defaults and the typed preload bridge; one unit test and one e2e smoke test pass                                                          | done    | [SUMMARY](../specs/p0-toolchain-and-skeleton/SUMMARY.md) | `22d7a04` (PR #1; work in `091dd51`, close in `1258c25`) |
| 2   | p0-process-layout         | Agent process stub (utilityProcess) with a typed message channel; main-process policy gate stub that denies everything by default, with tests                                                   | pending |                                                          |                                                          |
| 3   | p0-window-chrome          | Frameless window, 40px custom title bar per OS, drag regions, window controls                                                                                                                   | pending |                                                          |                                                          |
| 4   | p0-design-tokens          | Tokens from design-notes sections 2–4 as CSS variables/TS constants; bundled Inter and JetBrains Mono; Button (primary, gate, secondary, ghost, danger) and Chip components with a gallery page | pending |                                                          |                                                          |
| 5   | p0-ci                     | Lint, format, unit and e2e jobs on a Windows/macOS/Linux matrix; CLAUDE.md Commands section; suggested SDD_TEST_CMD                                                                             | pending |                                                          |                                                          |

## Decisions added

- D14 Package manager and Corepack (pnpm pinned in `packageManager`)
- D15 Build tooling and packaging (electron-vite, electron-builder; TypeScript pinned to 6.x until typescript-eslint supports 7)
- D16 UI framework (React + strict TypeScript; ESLint flat config; Prettier)
- D17 Test runners (Vitest unit, Playwright for Electron e2e)
- D18 Node version (Node 24 LTS)

## Follow-ups

- Confirm or revisit the TypeScript 6.x pin (D15) when typescript-eslint supports TypeScript 7.
- `pnpm-workspace.yaml` has a pnpm-written `minimumReleaseAgeExclude: electron@45.3.4`; update it on each Electron bump.
- AC4 window-open and navigation blocking has no automated test; add one in `p0-window-chrome` or `p0-ci`.
- `pnpm e2e` and `pnpm package` were only run on Windows; `p0-ci` covers macOS and Linux.
- The CLAUDE.md Commands section already exists; `p0-ci` only adds CI commands and the suggested `SDD_TEST_CMD`.
- Prettier formats all Markdown under `docs/` except `docs/specs/` and `docs/design/`; run `pnpm format` after editing docs.

## Phase summary

(written when the phase is done)
