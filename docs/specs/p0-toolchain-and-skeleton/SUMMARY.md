# Summary Report: p0-toolchain-and-skeleton
Ticket: none   Date: 2026-11-17
Outcome: Clean
Review rounds: 2 of 3 per revision; revisions: 0 of 2
Models: implementor haiku; reviewer sonnet; data agent not used (all chosen by the user); respawns: none

## What was built
A pinned toolchain (G1): pnpm 12.21.0 via Corepack, Node 24, electron-vite, electron-builder, React 19 + TypeScript 6 (strict), Vitest, Playwright for Electron, ESLint flat config and Prettier. The Electron app boots to a minimal React shell (G2). The window has contextIsolation, sandbox, no nodeIntegration and webSecurity on. `window.open` is denied, foreign navigation and redirects are blocked, and there is a strict production CSP (the dev-only relaxation applies under the Vite dev server). The preload exposes only `window.harness.getVersion()` (G3), and the main-process handler checks the sender frame. One Vitest file (6 tests) covers the navigation and sender helpers, and one Playwright e2e test proves the renderer has no `require`, `process` or `module` and that `window.harness` has exactly one key (G4). Decisions D14–D18 and the CLAUDE.md Commands section are written (G5).

## Files changed
Product files (group 1):
| File | Action | What and why | Task |
| --- | --- | --- | --- |
| package.json | created | Manifest: `packageManager` pnpm pin, Node 24 `engines`, scripts, pinned dev dependencies; `e2e` builds first | T1 |
| pnpm-lock.yaml | created | Lockfile for reproducible installs | T1 |
| pnpm-workspace.yaml | created | `allowBuilds` (electron, esbuild on; electron-winstaller off); pnpm-written `minimumReleaseAgeExclude: electron@45.3.4` | T1 |
| .nvmrc | created | Node 24 | T1 |
| .gitignore | edited | Adds test-results/, playwright-report/, coverage/ | T1 |
| tsconfig.json | created | Solution file referencing the Node and web projects | T2 |
| tsconfig.node.json | created | Strict project for main, preload, shared, tests, Node-side configs | T2 |
| tsconfig.web.json | created | Strict project for the renderer and shared | T2 |
| electron.vite.config.ts | created | Three-entry config; dev-only CSP swap that throws if the page CSP drifts from `PROD_CSP` | T2, T5, R1-2 |
| src/shared/bridge.ts | created | Global name, IPC channel map, `HarnessBridge` type | T3 |
| src/main/security.ts | created | Pure `isAllowedAppUrl` and `isTrustedSender` helpers | T3 |
| src/main/index.ts | created | Secure BrowserWindow, window-open denied, will-navigate/will-redirect blocked, sender-checked `getVersion` handler | T3 |
| src/preload/index.ts | created | Exposes only `window.harness.getVersion` via `contextBridge` | T4 |
| src/renderer/global.d.ts | created | `window.harness: HarnessBridge` declaration | T4 |
| src/renderer/index.html | created | Page with the production CSP (`'self'` only) | T5 |
| src/renderer/main.tsx | created | React entry | T5 |
| src/renderer/App.tsx | created | Empty shell with the version from the bridge | T5 |
| vitest.config.mts | created | Vitest config (`.mts` avoids switching the package to ESM) | T6 |
| playwright.config.ts | created | Playwright config for Electron e2e | T6 |
| tests/unit/security.test.ts | created | Unit tests for the two helpers | T6 |
| tests/e2e/smoke.spec.ts | created | e2e smoke test on the built app | T6 |
| eslint.config.mjs | created | ESLint flat config (React version pinned to 19.3; `detect` crashes under ESLint 10) | T7 |
| .prettierrc.json | created | Prettier options | T7 |
| .prettierignore | created | Ignores build output, lockfile, docs/design/, docs/specs/, .claude/ | T7 |
| electron-builder.yml | created | Unsigned per-OS packaging config | T7 |
| docs/decisions.md | edited | D14–D18 added; D15 names Electron Forge as the alternative | T8, R1-3 |
| CLAUDE.md | edited | Commands section filled in | T8 |
| README.md | edited | Prettier table alignment only, no text change | T7, R1-1 |
| docs/PRD.md | edited | Prettier table alignment only, no text change | T7, R1-1 |
| docs/design-notes.md | edited | Prettier table alignment only, no text change | T7, R1-1 |
| docs/roadmap.md | edited | Prettier table alignment only, no text change | T7, R1-1 |
| docs/workflow.md | edited | Prettier table alignment only, no text change | T7, R1-1 |
| docs/phases/phase-00-progress.md | edited | Prettier table alignment and blank lines only, no text change | T7, R1-1 |
| docs/phases/phase-00-scaffold.md … phase-09-usage-and-pilot.md (10 files) | edited | Prettier table alignment and blank lines only, no text change | T7, R1-1 |

Workflow files (group 2):
| File | Action | What and why | Task |
| --- | --- | --- | --- |
| docs/specs/p0-toolchain-and-skeleton/PLAN.md | created | Approved plan | plan |
| docs/specs/p0-toolchain-and-skeleton/SPECS.md | created | Approved spec (sha256 4ac4ef72…, unchanged) | plan |
| docs/specs/p0-toolchain-and-skeleton/SUBTASK.md | created | Child-ticket draft (tracker: none) | plan |
| docs/specs/p0-toolchain-and-skeleton/tasks.md | created | T1–T8, all ticked | T1–T8 |
| docs/specs/p0-toolchain-and-skeleton/build-ledger.md | created | Build ledger | build |
| docs/specs/p0-toolchain-and-skeleton/changes.md | created | Implementor's change notes | build |
| docs/specs/p0-toolchain-and-skeleton/SUMMARY.md | created | This report | build |

Git and `changes.md` agree: every file git shows is listed, and every listed file appears in git.

## Acceptance criteria
| AC | Status | Evidence |
| --- | --- | --- |
| AC1 | Met | `packageManager` pnpm pin, `engines` `>=24 <25`, `.nvmrc` 24; `pnpm install --frozen-lockfile` passed |
| AC2 | Met | src/main, src/preload, src/renderer, src/shared; `pnpm typecheck` passed both projects |
| AC3 | Met | `pnpm build` passed; `pnpm dev` served the page and Electron started; dev load path probed (heading, version, dev CSP, no console errors) |
| AC4 | Met (no automated test) | src/main/index.ts: secure options, `setWindowOpenHandler` deny, will-navigate/will-redirect blocked; reviewer confirmed by reading |
| AC5 | Met | Production CSP `'self'` only in index.html; dev relaxation only under the Vite server, guarded against drift |
| AC6 | Met | Preload exposes only `getVersion` via `ipcRenderer.invoke`; channel in src/shared; sender check in main |
| AC7 | Met | App.tsx shows placeholder text and version; e2e checks both |
| AC8 | Met | `pnpm test`: 1 file, 6 tests passed |
| AC9 | Met | `pnpm e2e`: 1 test passed (shell text, version, `require`/`process`/`module` undefined, harness keys exactly `['getVersion']`) |
| AC10 | Met | `pnpm lint` and `pnpm format:check` passed (after reformatting 16 docs, see R1-1) |
| AC11 | Met | `pnpm package` produced an unsigned unpacked build (release/win-unpacked) |
| AC12 | Met | D14–D18 in docs/decisions.md |
| AC13 | Met | CLAUDE.md Commands lists install (incl. `corepack enable`), dev, build, typecheck, lint, format, format:check, test, e2e, package |

## Needs a runtime check
- Look at the window once with `pnpm dev`: the implementor confirmed the dev page loads through a probe, but nobody has viewed the window.
- `pnpm package` and `pnpm e2e` were only run on Windows; macOS and Linux are covered by `p0-ci`.

## Review ledger
### Revision 0, round 1  (ISSUES)
| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| R1-1: 16 pre-existing docs reformatted by `prettier --write` (table alignment only) | minor (optional) | README.md, docs/*.md, docs/phases/*.md | REJECT (flagged for the user) | AC10 needs format:check to pass on the repo; whitespace only; a hand revert risks corrupting the docs | None |
| R1-2: dev CSP silent string replace | note | electron.vite.config.ts | ACCEPT | Replace could silently stop applying | Throws in dev on drift; dev load path probed |
| R1-3: D14 points to D15 for Forge; D15 silent | nit | docs/decisions.md | ACCEPT | Confirmed | D15 names Electron Forge |
| R1-4: `isTrustedSender` frame URL vs `appUrl` | note | src/main | ACCEPT as verified | e2e `getVersion` succeeds only if the check passes | None |

### Revision 0, round 2  (PASS)
| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| (none) | | | | | |

## Spec revisions
none

## Rejected findings
- **R1-1 (docs reformatted by Prettier).** The implementor kept the reformat: AC10 requires `format:check` to pass on the repo, and the change is whitespace only (`git diff -w` shows only table separator rows and blank lines). The alternative is to add `docs/` and `README.md` to `.prettierignore` and restore those 16 files from `main`. That keeps the docs diff out of this change, but leaves Markdown unformatted going forward.

## Open issues
- TypeScript is pinned to 6.x (D15), not the latest 7.0, because typescript-eslint doesn't support 7 yet. Please confirm.
- `pnpm-workspace.yaml` has a pnpm-written `minimumReleaseAgeExclude: electron@45.3.4`. It will need updating on each Electron bump.
- AC4's window-open and navigation blocking has no automated test (the spec doesn't require one). Could be added in `p0-window-chrome` or `p0-ci`.

## Git state
Branch `feature/p0-toolchain-and-skeleton`; approved; committed and pushed in the commit that adds this report.

## Next steps
Approve, commit and push; or request changes (for example, revert the docs reformat); or not yet.
