# Phase 0 progress: Project scaffold

Status: in progress · Started: 2026-11-17

Remote: `origin` = https://github.com/leeray75/sdd-harness.git. Feature branches come into `main` through pull requests.

Toolchain chosen at phase start (to be recorded as D-numbers by `p0-toolchain-and-skeleton`): pnpm; electron-vite for dev/build; electron-builder for packaging; React + TypeScript; Vitest for unit tests; Playwright for Electron e2e.

| #   | Feature                   | Goal                                                                                                                                                                                            | Status  | Spec | Commit |
| --- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---- | ------ |
| 1   | p0-toolchain-and-skeleton | Toolchain decided and recorded; app boots with secure defaults and the typed preload bridge; one unit test and one e2e smoke test pass                                                          | pending |      |        |
| 2   | p0-process-layout         | Agent process stub (utilityProcess) with a typed message channel; main-process policy gate stub that denies everything by default, with tests                                                   | pending |      |        |
| 3   | p0-window-chrome          | Frameless window, 40px custom title bar per OS, drag regions, window controls                                                                                                                   | pending |      |        |
| 4   | p0-design-tokens          | Tokens from design-notes sections 2–4 as CSS variables/TS constants; bundled Inter and JetBrains Mono; Button (primary, gate, secondary, ghost, danger) and Chip components with a gallery page | pending |      |        |
| 5   | p0-ci                     | Lint, format, unit and e2e jobs on a Windows/macOS/Linux matrix; CLAUDE.md Commands section; suggested SDD_TEST_CMD                                                                             | pending |      |        |

## Decisions added

- (none yet)

## Follow-ups

- (none yet)

## Phase summary

(written when the phase is done)
