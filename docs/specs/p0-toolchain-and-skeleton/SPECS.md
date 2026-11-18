---
status: done
ticket:
---

# p0-toolchain-and-skeleton

## Problem

The SDD Harness repo has docs only: no package manager, build, UI framework or test runners, and no app to run. Every later phase needs a working Electron + TypeScript skeleton with secure defaults and a typed preload bridge, and the toolchain choices need to be recorded so later work doesn't reopen them.

## Goals

- **G1:** A pinned, reproducible toolchain: pnpm via Corepack, Node 24 LTS, electron-vite, electron-builder, React + TypeScript (strict), Vitest, Playwright for Electron, ESLint and Prettier.
- **G2:** An Electron app that boots to a minimal React empty shell with secure window defaults.
- **G3:** A typed preload bridge (`window.harness`) as the only way from the renderer to the main process.
- **G4:** Automated proof: one unit test and one e2e smoke test, including a check that the renderer can't reach Node or the filesystem.
- **G5:** The toolchain recorded as new decisions and the commands listed in `CLAUDE.md`.

## Non-goals

- Agent process, agent message channel and the main-process policy gate (`p0-process-layout`).
- Frameless window and custom title bar (`p0-window-chrome`).
- Design tokens, bundled fonts, Button and Chip components (`p0-design-tokens`).
- CI workflows (`p0-ci`).
- Code signing, auto-update and release builds.
- Any provider, agent or workflow logic, and any real screen.

## Acceptance criteria

- **AC1:** `package.json` pins pnpm in `packageManager` (used through Corepack), declares Node 24 in `engines`, and `.nvmrc` names Node 24. `pnpm install` from a clean checkout succeeds and produces `pnpm-lock.yaml`.
- **AC2:** Source is laid out as `src/main`, `src/preload`, `src/renderer` (React) and `src/shared`. TypeScript runs in strict mode, and `pnpm typecheck` passes for both the Node side (main, preload, shared) and the web side (renderer, shared).
- **AC3:** `pnpm build` (electron-vite) builds main, preload and renderer without errors, and `pnpm dev` starts the app with a window showing the empty shell.
- **AC4:** The main window is created with `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` and `webSecurity: true`. `window.open` and new windows are denied, and navigation to any URL other than the app's own page is blocked.
- **AC5:** The renderer page has a Content-Security-Policy that allows scripts only from the app itself (no remote or inline scripts in the production build). Any relaxation needed for Vite HMR applies only in dev.
- **AC6:** The preload exposes exactly one global, `window.harness`, through `contextBridge`. Its only call is `getVersion(): Promise<string>`, implemented with `ipcRenderer.invoke` on a channel named in `src/shared`. Raw `ipcRenderer` and other Node APIs are not exposed. The bridge type lives in `src/shared` and is declared for the renderer. The main-process handler answers only when the sender is the app's own window.
- **AC7:** The renderer shows placeholder shell text and the app version obtained through `window.harness.getVersion()`.
- **AC8:** `pnpm test` runs Vitest, and at least one unit test passes. It covers a main-process helper, such as the navigation-allow check.
- **AC9:** `pnpm e2e` runs a Playwright-for-Electron smoke test against the built app. The test passes when: the window opens and shows the shell text; `window.harness.getVersion()` returns the app version; in the renderer, `typeof require`, `typeof process` and `typeof module` are all `"undefined"`; and `window.harness` has no keys other than the declared calls.
- **AC10:** `pnpm lint` (ESLint flat config with TypeScript and React rules) and `pnpm format:check` (Prettier) pass on the repo. `pnpm format` rewrites files.
- **AC11:** `electron-builder` is configured, and `pnpm package` produces an unsigned build for the current OS. It is not part of the test commands.
- **AC12:** `docs/decisions.md` has new entries, starting at D14, for: package manager and Corepack; build tooling and packaging; UI framework; unit and e2e test runners; Node version. Each uses the file's format (Outcome, Why, Date).
- **AC13:** The Commands section of `CLAUDE.md` lists install (including `corepack enable`), dev, build, typecheck, lint, format, test, e2e and package.

## Open questions
