# Changes: p0-toolchain-and-skeleton

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| package.json | created | Package manifest: `packageManager` pnpm pin, Node 24 `engines`, the required scripts, and pinned dev dependencies (Electron, electron-vite, electron-builder, React, TypeScript 6, Vitest, Playwright, ESLint, Prettier, types). `e2e` builds before Playwright runs. | T1 |
| pnpm-lock.yaml | created | Lockfile from `pnpm install`, so installs are reproducible. | T1 |
| pnpm-workspace.yaml | created | pnpm wrote `minimumReleaseAgeExclude` for `electron@45.3.4` on install. Added `allowBuilds` so Electron's binary download and esbuild's build script run, and electron-winstaller's script is off (Squirrel, not used). | T1 |
| .nvmrc | created | Names Node 24 for version managers. | T1 |
| .gitignore | edited | Added `test-results/`, `playwright-report/` and `coverage/` (outputs of the test and coverage runs). | T1 |
| tsconfig.json | created | Solution file that references the Node and web TypeScript projects. | T2 |
| tsconfig.node.json | created | Strict TypeScript project for main, preload, shared, tests and Node-side config files. | T2 |
| tsconfig.web.json | created | Strict TypeScript project for the renderer (DOM, React JSX) and shared. | T2 |
| electron.vite.config.ts | created | electron-vite config for the main, preload and renderer entries. The renderer plugin swaps in the dev-only CSP (`unsafe-inline` for HMR and Fast Refresh, ws to localhost) only when served by the dev server. Round 1: the plugin now throws in dev if the page CSP no longer matches `PROD_CSP`, so the dev relaxation cannot fail silently. | T2, T5, R1-2 round 1 |
| src/shared/bridge.ts | created | Shared contract: the global name `harness`, the IPC channel map, and the `HarnessBridge` type. No Node or DOM imports. | T3 |
| src/main/security.ts | created | Pure helpers: `isAllowedAppUrl` (navigation check) and `isTrustedSender` (IPC sender check). No Electron imports, so they can be unit tested. | T3 |
| src/main/index.ts | created | Main process: secure BrowserWindow options (contextIsolation, sandbox, nodeIntegration off, webSecurity), window-open denied, foreign will-navigate and will-redirect blocked, `getVersion` IPC handler that rejects untrusted senders. | T3 |
| src/preload/index.ts | created | Preload: exposes only `window.harness.getVersion` through `contextBridge`; `ipcRenderer.invoke` is used inside the module and not exposed. | T4 |
| src/renderer/global.d.ts | created | Declares `window.harness: HarnessBridge` for the renderer. | T4 |
| src/renderer/index.html | created | Renderer page with the production CSP meta tag (`'self'` only, no inline or remote script). | T5 |
| src/renderer/main.tsx | created | React entry: mounts `App` into `#root`. | T5 |
| src/renderer/App.tsx | created | Empty shell: placeholder text and the app version read through `window.harness.getVersion()`. | T5 |
| vitest.config.mts | created | Vitest config (node environment, `tests/unit`). `.mts` keeps ESM config syntax valid without `"type": "module"`, which would change the Electron output format. | T6 |
| playwright.config.ts | created | Playwright config for the Electron e2e (`tests/e2e`, one worker). | T6 |
| tests/unit/security.test.ts | created | Unit tests for `isAllowedAppUrl` and `isTrustedSender`. | T6 |
| tests/e2e/smoke.spec.ts | created | e2e smoke test on the built app: shell text, version via bridge equal to package.json, `require`/`process`/`module` undefined in the renderer, `window.harness` keys exactly `['getVersion']`. | T6 |
| eslint.config.mjs | created | ESLint flat config: TypeScript recommended, React and React Hooks rules for the renderer, Prettier overrides. | T7 |
| .prettierrc.json | created | Prettier options (single quotes, trailing commas, print width 100). | T7 |
| .prettierignore | created | Excludes build output, the lockfile, the design export folder, `docs/specs/` and `.claude/`. | T7 |
| electron-builder.yml | created | electron-builder config (asar, `out/**`, per-OS targets). No certificate is set, so builds are unsigned. | T7 |
| docs/specs/p0-toolchain-and-skeleton/tasks.md | edited | Ticked T1 to T8 after each check passed. | T1-T8 |
| docs/decisions.md | edited | Added D14 (package manager and Corepack), D15 (build tooling and packaging, TypeScript 6 pin), D16 (UI framework), D17 (test runners), D18 (Node version). Round 1: D15 now names Electron Forge as the rejected alternative, matching D14. | T8, R1-3 round 1 |
| CLAUDE.md | edited | Commands section now lists install (`corepack enable`, `pnpm install`), dev, build, typecheck, lint, format, format:check, test, e2e and package. | T8 |
| README.md | edited | Whitespace only: `prettier --write` re-aligned Markdown tables so `pnpm format:check` passes on the repo (AC10). No text changed. Round 1 (R1-1): reverting was considered and rejected, so the reformat stays. | T7, R1-1 round 1 |
| docs/PRD.md | edited | Whitespace only: Markdown table alignment from `prettier --write` (AC10). No text changed. Round 1 (R1-1): reverting was considered and rejected, so the reformat stays. | T7, R1-1 round 1 |
| docs/design-notes.md | edited | Whitespace only: Markdown table alignment from `prettier --write` (AC10). No text changed. Round 1 (R1-1): reverting was considered and rejected, so the reformat stays. | T7, R1-1 round 1 |
| docs/roadmap.md | edited | Whitespace only: Markdown table alignment from `prettier --write` (AC10). No text changed. Round 1 (R1-1): reverting was considered and rejected, so the reformat stays. | T7, R1-1 round 1 |
| docs/workflow.md | edited | Whitespace only: Markdown table alignment from `prettier --write` (AC10). No text changed. Round 1 (R1-1): reverting was considered and rejected, so the reformat stays. | T7, R1-1 round 1 |
| docs/phases/phase-00-progress.md | edited | Whitespace only: Markdown table alignment from `prettier --write` (AC10). No text changed. Round 1 (R1-1): reverting was considered and rejected, so the reformat stays. | T7, R1-1 round 1 |
| docs/phases/phase-00-scaffold.md | edited | Whitespace only: Markdown table alignment from `prettier --write` (AC10). No text changed. Round 1 (R1-1): reverting was considered and rejected, so the reformat stays. | T7, R1-1 round 1 |
| docs/phases/phase-01-providers.md | edited | Whitespace only: Markdown table alignment from `prettier --write` (AC10). No text changed. Round 1 (R1-1): reverting was considered and rejected, so the reformat stays. | T7, R1-1 round 1 |
| docs/phases/phase-02-tool-policy.md | edited | Whitespace only: Markdown table alignment from `prettier --write` (AC10). No text changed. Round 1 (R1-1): reverting was considered and rejected, so the reformat stays. | T7, R1-1 round 1 |
| docs/phases/phase-03-workflow-engine.md | edited | Whitespace only: Markdown table alignment from `prettier --write` (AC10). No text changed. Round 1 (R1-1): reverting was considered and rejected, so the reformat stays. | T7, R1-1 round 1 |
| docs/phases/phase-04-projects.md | edited | Whitespace only: Markdown table alignment from `prettier --write` (AC10). No text changed. Round 1 (R1-1): reverting was considered and rejected, so the reformat stays. | T7, R1-1 round 1 |
| docs/phases/phase-05-workspace-shell-chat.md | edited | Whitespace only: Markdown table alignment from `prettier --write` (AC10). No text changed. Round 1 (R1-1): reverting was considered and rejected, so the reformat stays. | T7, R1-1 round 1 |
| docs/phases/phase-06-workspace-docs-next.md | edited | Whitespace only: Markdown table alignment from `prettier --write` (AC10). No text changed. Round 1 (R1-1): reverting was considered and rejected, so the reformat stays. | T7, R1-1 round 1 |
| docs/phases/phase-07-build-view.md | edited | Whitespace only: Markdown table alignment from `prettier --write` (AC10). No text changed. Round 1 (R1-1): reverting was considered and rejected, so the reformat stays. | T7, R1-1 round 1 |
| docs/phases/phase-08-models-agents-ui.md | edited | Whitespace only: Markdown table alignment from `prettier --write` (AC10). No text changed. Round 1 (R1-1): reverting was considered and rejected, so the reformat stays. | T7, R1-1 round 1 |
| docs/phases/phase-09-usage-and-pilot.md | edited | Whitespace only: Markdown table alignment from `prettier --write` (AC10). No text changed. Round 1 (R1-1): reverting was considered and rejected, so the reformat stays. | T7, R1-1 round 1 |
