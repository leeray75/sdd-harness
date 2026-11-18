# Plan: p0-toolchain-and-skeleton

Ticket: (none: planned from the Phase 0 subtask brief)
Status: approved
Date: 2026-11-17

## Objective

Set up the project toolchain and an Electron + TypeScript skeleton that boots with secure defaults and a typed preload bridge. The repo has docs only today, and every later Phase 0 subtask and phase builds on this one. Done means one unit test and one e2e smoke test pass, the e2e test proves the renderer can't reach Node or the filesystem, the toolchain choices are recorded as decisions, and CLAUDE.md lists the commands.

## Scope

- **In:**
  - `package.json` (with a `packageManager` pin for pnpm via Corepack, and `engines` for Node 24), `pnpm-lock.yaml`, `.nvmrc`, `.npmrc` if needed, `.gitignore`
  - TypeScript (strict) configs for main/preload (Node) and renderer (web)
  - `electron.vite.config.ts`; `electron-builder` config plus an unsigned `package` script for the current OS
  - ESLint (flat config, TypeScript + React rules) and Prettier
  - Source layout: `src/main`, `src/preload`, `src/renderer` (React), `src/shared` (types shared across processes)
  - Secure `BrowserWindow`: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`; deny `window.open`/new windows; block navigation away from the app; a restrictive Content-Security-Policy on the renderer
  - Typed preload bridge: `contextBridge` exposes one object, `window.harness`, with a single typed call (`getVersion()` over `ipcRenderer.invoke`), typed in `src/shared` and declared for the renderer; the main handler checks the sender is the app's own window
  - Renderer: a minimal React empty shell (placeholder text, plus the app version read through the bridge)
  - One Vitest unit test; one Playwright-for-Electron e2e smoke test
  - Scripts: `dev`, `build`, `typecheck`, `lint`, `format`, `format:check`, `test`, `e2e`, `package`
  - New decisions D14 onward in `docs/decisions.md`; the Commands section of `CLAUDE.md`
- **Out:** agent process, agent channel and policy gate (`p0-process-layout`); frameless window and title bar (`p0-window-chrome`); tokens, fonts, Button/Chip (`p0-design-tokens`); CI workflows (`p0-ci`); signing and auto-update; any provider, agent or workflow logic; any real screen.

## Decisions

| Question | Decision | Alternatives considered |
| --- | --- | --- |
| Feature slug | `p0-toolchain-and-skeleton` | (fixed by the phase plan) |
| Repo and base branch | `sdd-harness`, base `main`, feature branch `feature/p0-toolchain-and-skeleton` | — |
| Package manager | pnpm | npm with Electron Forge; pnpm with Electron Forge (needs `node-linker=hoisted`) |
| How pnpm is installed | Corepack: exact version pinned in `packageManager`, enabled with `corepack enable` | Global `npm i -g pnpm` (versions can drift) |
| Build / dev tooling | electron-vite | Electron Forge with the Vite plugin |
| Packaging | electron-builder config plus an unsigned `package` script for the current OS (not part of test commands) | Config only, no script |
| UI framework | React + TypeScript (strict) | — |
| Unit test runner | Vitest | — |
| E2E runner | Playwright for Electron, run against the built app | — |
| Node version | Node 24 LTS (`engines`, `.nvmrc`) | Node 22 LTS |
| Bridge shape (default) | One object `window.harness` with `getVersion()`; later subtasks add calls | — |
| Lint/format (default) | ESLint flat config with typescript-eslint and React hooks rules; Prettier | — |

## Approach

1. Toolchain: `corepack enable`, `package.json` with the pnpm pin, Node engines, and dev dependencies on current stable releases (Electron 45.x, electron-vite 6.x, React, TypeScript, Vitest, Playwright, ESLint, Prettier, electron-builder).
2. Configs: `tsconfig.json` with `tsconfig.node.json` (main, preload, shared) and `tsconfig.web.json` (renderer, shared); `electron.vite.config.ts` for the three entries; ESLint and Prettier; `.gitignore` for `node_modules`, `out`, `dist`, `test-results`.
3. Main process (`src/main/index.ts`): create the window with the secure options, deny new windows (`setWindowOpenHandler` returns deny), block `will-navigate` to anything but the app's own URL, register `ipcMain.handle` for the version call with a sender check. Pure helpers (such as the allowed-navigation check) go in their own module so they can be unit tested.
4. Shared contract (`src/shared/bridge.ts`): the channel name and the `HarnessBridge` type; the renderer gets a global `window.harness` declaration.
5. Preload (`src/preload/index.ts`): `contextBridge.exposeInMainWorld('harness', …)` with only the typed calls; no raw `ipcRenderer` exposed.
6. Renderer (`src/renderer/index.html`, `main.tsx`, `App.tsx`): CSP meta tag (`default-src 'self'`, no remote scripts; dev allows only what Vite HMR needs); the shell shows placeholder text and the version.
7. Tests: Vitest unit test for the navigation-allow helper (and/or the bridge contract); Playwright e2e that builds, launches `out/main/index.js` with `_electron.launch`, checks the window title and the shell text, calls `window.harness.getVersion()`, and checks that `typeof require`, `typeof process` and `typeof module` are `undefined` in the renderer and that `window.harness` exposes nothing beyond the declared calls.
8. Docs: D14+ in `docs/decisions.md` (package manager and Corepack, build tooling and packaging, UI framework, test runners, Node version); fill the Commands section of `CLAUDE.md`.

## Verified assumptions

| Assumption | Evidence |
| --- | --- |
| The repo has no code or toolchain yet | `ls` of the repo root: docs only; CLAUDE.md "No toolchain yet" |
| Node 24 is installed locally | `node --version` → v24.15.0 |
| pnpm is not installed; Corepack is available | `pnpm` → command not found; `corepack --version` → 0.34.6 |
| Current stable versions | `npm view`: pnpm 12.21.0, electron 45.3.4, electron-vite 6.0.0 |
| No existing decision covers the toolchain | `docs/decisions.md` ends at D13 |

## Risks

- `corepack enable` may need admin rights on Windows to write shims into the Node install folder. Revealed in task 1; fallback is `corepack pnpm …` or enabling it in a user-writable folder (`corepack enable --install-directory`).
- Electron's binary download during install can be blocked by a proxy. Revealed at the first `pnpm install`.
- pnpm's strict `node_modules` layout can break electron-builder's dependency collection. Revealed by `pnpm package`; fallback is `node-linker=hoisted` in `.npmrc`.
- The dev CSP must allow Vite HMR without loosening the production CSP. Revealed by running `pnpm dev` and the e2e test against the built app.

## Open questions

(none)
