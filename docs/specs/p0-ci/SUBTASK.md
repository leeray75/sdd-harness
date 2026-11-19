# p0-ci: CI for Windows, macOS and Linux, plus the suggested SDD_TEST_CMD

**Parent:** none: no parent chosen (tracker not set)
**Spec:** docs/specs/p0-ci/SPECS.md
**Repo and base branch:** leeray75/sdd-harness, main; feature branch feature/p0-ci

## Context

The Phase 0 scaffold has only been installed, tested, run end to end and packaged on one Windows machine. The macOS title bar has no test, and nothing checks pull requests automatically. This work adds a GitHub Actions workflow with two jobs: a quick check job, and e2e plus packaging on all three OSes. It also adds a macOS title-bar test, CI-only Playwright retries with failure artifacts, and docs for CI and the suggested `SDD_TEST_CMD` (D22).

## Required work

- T1 Playwright CI settings.
- T2 macOS title-bar test.
- T3 Workflow.
- T4 Docs.
- T5 Repo checks.

## Acceptance criteria

- **AC1 — Workflow triggers and safety.** `.github/workflows/ci.yml` exists and has:
  - triggers: `push` to `main`, `pull_request` to `main`, and `workflow_dispatch`;
  - top-level `permissions: contents: read`;
  - `concurrency: group: ci-${{ github.ref }}`, with `cancel-in-progress` true only for `pull_request` events, so pushes to `main` always finish;
  - every `uses:` pinned to a major version tag (for example `actions/checkout@v4`).
- **AC2 — Toolchain setup.** Every job sets up the toolchain in this order, with no other Node or pnpm version source:
  1. `actions/checkout`;
  2. `corepack enable`;
  3. `actions/setup-node` with `node-version-file: .nvmrc` and `cache: pnpm`, which caches the store keyed on `pnpm-lock.yaml`;
  4. `pnpm install --frozen-lockfile`.

  If setup-node needs pnpm before Corepack can provide it, the fix keeps Corepack and the `packageManager` pin as the only pnpm source.
- **AC3 — Check job.** A `check` job runs on `ubuntu-latest`: `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test`, each as its own named step.
- **AC4 — E2E and package job.** An `e2e` job uses `strategy.fail-fast: false` and a matrix `os: [windows-latest, macos-latest, ubuntu-latest]`.
  - On Linux only, a step runs `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0` before the tests. The app's own sandbox settings are unchanged, and nothing passes `--no-sandbox`.
  - The tests run as `xvfb-run -a pnpm e2e` on Linux, and as `pnpm e2e` on Windows and macOS.
  - A step after the tests runs `pnpm exec electron-builder --dir` on all three OSes, with `CSC_IDENTITY_AUTO_DISCOVERY: 'false'` set, so the build stays unsigned. The step reuses the `out/` build from `pnpm e2e`.
  - No build artifact is uploaded.
- **AC5 — Failure artifacts.** On failure of an e2e job (`if: failure()`), `actions/upload-artifact` uploads `playwright-report/` and `test-results/` under a per-OS name (for example `playwright-${{ matrix.os }}`). A missing path does not raise an error.
- **AC6 — Playwright CI settings.** In `playwright.config.ts`, when `process.env.CI` is set:
  - `retries: 2`;
  - `use.trace: 'on-first-retry'`;
  - `reporter: [['list'], ['html', { open: 'never' }]]`.

  Without `CI`, the config behaves as today: no retries, the `list` reporter only, no trace. `workers: 1` and `timeout: 60_000` stay as they are.
- **AC7 — macOS title-bar test.** `tests/e2e/window-chrome.spec.ts` gains a test that is skipped unless `process.platform === 'darwin'`. It asserts that:
  - the main window's `getWindowButtonPosition()` equals `{ x: 14, y: 13 }`;
  - the computed `padding-left` of `header.titlebar` is `78px`.

  The frameless test's skip reason no longer says the macOS chrome is "checked by code review and p0-ci"; it points to the new test. The test keeps the file's `launchApp()` helper. On Windows it shows as skipped.
- **AC8 — CLAUDE.md.** The Commands section gains a "CI" subsection that:
  - names the two jobs, what each runs and on which OS, including the package step;
  - explains how to reproduce each job locally: the check commands; `pnpm e2e`; `xvfb-run -a pnpm e2e` on Linux; `CI=1 pnpm e2e` for the CI retry and report behaviour;
  - notes that pnpm runs from Windows (PowerShell or Git Bash) on this machine, not from WSL;
  - gives the suggested `SDD_TEST_CMD="pnpm test"`, with `pnpm e2e` left to CI.
- **AC9 — README.** The `SDD_TEST_CMD` text at README.md:84 suggests `SDD_TEST_CMD="pnpm test"`, matching CLAUDE.md.
- **AC10 — D22.** `docs/decisions.md` gains "D22 · Continuous integration", in the same format as D14–D21. For each choice it gives the alternatives not taken. The choices are:
  - GitHub Actions on the GitHub-hosted runners;
  - the check job on Linux and the e2e job on a three-OS matrix;
  - packaging on all three OSes;
  - retries in CI only, with traces and the HTML report;
  - the concurrency rule;
  - the AppArmor sysctl on Linux instead of `--no-sandbox`;
  - `SDD_TEST_CMD=pnpm test`.
- **AC11 — Local checks.** On Windows, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` and `pnpm e2e` pass, and the new macOS test is skipped. `ci.yml` parses as YAML. If `actionlint` is available it reports no errors; if not, the build notes that it was skipped.
- **AC12 — Green on the pull request (checked after result approval).** After the approved work is pushed and the PR is open, every job is green: `check` and `e2e` on all three OSes, including the macOS title-bar test (passed, not skipped) and the package step. Any red job gets a change round before merge.

## Out of scope

- Code signing, notarization, releases, and publishing build artifacts. Failure reports are the only uploads.
- Any product feature or UI change.
- Changes to the toolchain decisions D14–D18, or to `pnpm-workspace.yaml`.
- GitHub branch protection settings; the user sets them in the GitHub UI.
- Pushing a branch during the build. The workflow's first real run happens after result approval (AC12).

## Links

- Plan: docs/specs/p0-ci/PLAN.md
- Spec and tasks: docs/specs/p0-ci/SPECS.md, docs/specs/p0-ci/tasks.md
