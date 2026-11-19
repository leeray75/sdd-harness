# Plan: p0-ci

Ticket: (none; vibe planning from the Phase 0 brief)
Status: approved
Date: 2026-11-18

## Objective

Add continuous integration that proves the Phase 0 scaffold installs, checks, tests, runs end to end and packages on Windows, macOS and Linux. It also documents the CI jobs and the suggested `SDD_TEST_CMD` for the sdd plugin. This is the last Phase 0 subtask, and it closes the "only run on Windows" follow-ups.

## Scope

- **In:**
  - `.github/workflows/ci.yml`, with a `check` job (Linux) and an `e2e` job on a Windows, macOS and Linux matrix;
  - toolchain setup from the repo itself, with a frozen install and a cached pnpm store;
  - Playwright settings used only in CI: retries, traces and an HTML report;
  - a new macOS-only e2e test for the traffic lights and the title-bar padding;
  - `pnpm package` on all three OSes;
  - the CLAUDE.md Commands section, the README `SDD_TEST_CMD` line, and D22.
- **Out:**
  - code signing, notarization, releases, and publishing artifacts other than failure reports;
  - product features and UI changes;
  - changes to D14–D18;
  - GitHub branch protection, which the user sets in the GitHub UI.

## Decisions

| Question                          | Decision                                                                                                                           | Alternatives considered                                                      |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Feature slug and branch           | `p0-ci` on `feature/p0-ci` from `main`                                                                                             | none (convention)                                                            |
| `pnpm package` in CI              | Runs on all three OSes, as a step after the e2e tests in each matrix job; no artifact is uploaded                                  | Linux only; not in CI                                                        |
| Handling the one-off launch crash | Playwright `retries: 2` only when `CI` is set; trace `on-first-retry`; HTML report in CI, `list` stays the local reporter          | No retries                                                                   |
| macOS title-bar coverage          | New mac-only e2e test: `getWindowButtonPosition()` equals `{ x: 14, y: 13 }`, and the title bar's computed `padding-left` is `78px` | Run the existing tests only                                                  |
| How AC8 is verified               | After result approval: the push opens the PR, and its checks are read; a red check gets a fix round before merge                   | Push a test branch during the build (breaks the sdd no-git-writes rule)      |
| New decision                      | D22 "Continuous integration" in `docs/decisions.md`                                                                                | No new decision; facts kept only in CLAUDE.md and the workflow file          |
| Linux sandbox on Ubuntu 24.04     | A CI step runs `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`; the app keeps its sandbox as shipped               | Launch with `--no-sandbox` on Linux CI                                       |
| Concurrency                       | Default: `group: ci-${{ github.ref }}` with `cancel-in-progress` for pull requests only, so every push to `main` finishes          | (default; not asked)                                                         |
| `SDD_TEST_CMD`                    | Default from the brief: `pnpm test`, with `pnpm e2e` left to CI and the build                                                      | typecheck + lint + test (slower on every sdd check)                          |

## Approach

1. **Workflow, `.github/workflows/ci.yml`:**
   - Triggers:
     - `push` to `main`;
     - `pull_request` to `main`;
     - `workflow_dispatch`.
   - `permissions: contents: read`.
   - Concurrency: as in Decisions.
   - Setup in each job, in this order:
     1. `actions/checkout`;
     2. `corepack enable`;
     3. `actions/setup-node` with `node-version-file: .nvmrc` and `cache: pnpm`, which caches the store keyed on `pnpm-lock.yaml`; Corepack goes first so setup-node can find pnpm;
     4. `pnpm install --frozen-lockfile`.
   - **`check`** (ubuntu-latest): `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`.
   - **`e2e`**:
     - matrix `windows-latest`, `macos-latest`, `ubuntu-latest`, with `fail-fast: false`.
     - On Linux, first a step that relaxes the AppArmor setting, then `xvfb-run -a pnpm e2e`. Other OSes run `pnpm e2e`.
     - Then `pnpm exec electron-builder --dir`, which reuses the build from `pnpm e2e`. It runs on all three OSes.
     - On failure, `actions/upload-artifact` uploads `playwright-report/` and `test-results/`, named per OS.
   - Every action is pinned to a major version tag.
   - Prettier must accept the YAML; `format:check` covers it.
2. **`playwright.config.ts`:**
   - in CI: `retries: 2`, `use.trace: 'on-first-retry'`, and the reporter `[['list'], ['html', { open: 'never' }]]`;
   - locally: unchanged.
3. **`tests/e2e/window-chrome.spec.ts`:** a new test, skipped when not on macOS:
   - the main process reports `win.getWindowButtonPosition()` as `{ x: 14, y: 13 }`;
   - the renderer reports `getComputedStyle(header.titlebar).paddingLeft` as `78px`.

   The existing skips stay as they are. The skip reason "checked by code review and p0-ci" on the frameless test is reworded, because the macOS chrome now has a real test.
4. **Electron binary:**
   - CI relies on the existing `allowBuilds` and `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`, with no change;
   - the e2e step proves the binary is there.
5. **Docs:**
   - **CLAUDE.md:** a "CI" subsection under Commands that says:
     - which jobs run, and on which OS;
     - how to reproduce each job locally, including `xvfb-run -a pnpm e2e` on Linux and `CI=1` for the retry behaviour;
     - the suggested `SDD_TEST_CMD=pnpm test`.
   - **README.md:84:** suggests `SDD_TEST_CMD="pnpm test"`.
   - **`docs/decisions.md`:** D22, with the alternatives from the Decisions table.
6. **Checks during the build:**
   - typecheck, lint, format:check, test and e2e on Windows, where the new macOS test is skipped;
   - a YAML parse of the workflow;
   - `actionlint` if it is available.

   AC8 is checked after approval, from the PR.

## Verified assumptions

| Assumption                                                       | Evidence                                                                                              |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| No CI exists yet                                                 | No `.github/` directory in the repo root listing                                                      |
| Node version source is `.nvmrc` = 24                             | `.nvmrc` contains `24`                                                                                |
| pnpm is pinned for Corepack                                      | `package.json` `"packageManager": "pnpm@12.21.0"`                                                     |
| Electron's install script is allowed                             | `pnpm-workspace.yaml` `allowBuilds: electron: true`, `minimumReleaseAgeExclude: electron@45.3.4`      |
| `pnpm e2e` builds first                                          | `package.json` `"e2e": "pnpm build && playwright test"`                                               |
| Playwright has no retries or HTML reporter today                 | `playwright.config.ts`: `workers: 1`, `reporter: 'list'`, no `retries`                                |
| macOS traffic lights are set to `{ x: 14, y: 13 }`               | `src/main/index.ts:36`                                                                                |
| macOS title bar padding is 78px                                  | `src/renderer/titlebar.css:21`                                                                        |
| The only macOS-run e2e test today checks "no caption buttons"    | `tests/e2e/window-chrome.spec.ts:132-143`; other window-chrome tests `test.skip(isMac, …)`            |
| `playwright-report/` and `test-results/` are ignored by git      | `.gitignore` and `.prettierignore` both list them                                                     |
| README's SDD_TEST_CMD line                                       | `README.md:84`                                                                                        |
| Next decision number is D22                                      | `docs/decisions.md` last heading `## D21 · Design tokens and bundled fonts`                          |

## Risks

- **The macOS runner may report a different traffic-light position** on its OS version: `getWindowButtonPosition` may return the configured value or the drawn one. The first PR run reveals this; a mismatch gets a fix round.
- **The Linux app may still fail to launch under xvfb** because of a missing shared library or GPU errors. The Linux e2e job shows it on the first PR run.
- **pnpm 12 with Corepack on the hosted runners:**
  - Corepack has to fetch pnpm 12.21.0, and setup-node's pnpm cache needs `pnpm store path`.
  - A failure here shows in the first step of the first run.
- **`electron-builder --dir` on macOS without a certificate:**
  - it should skip signing, but it may try to find an identity;
  - `CSC_IDENTITY_AUTO_DISCOVERY=false` is set in CI to keep it unsigned.
- **The launch crash is hidden by retries:** a retried test shows as "flaky" in the report, so it stays visible.

## Open questions

none
