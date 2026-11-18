# Tasks: p0-ci

Work in order. After each task, run its check, then tick the box. Run `pnpm` only from Windows (Git Bash or PowerShell), never from WSL. Make no git commits or pushes.

- [x] **T1 — Playwright CI settings.** Make `playwright.config.ts` read `process.env.CI` for `retries`, `use.trace` and `reporter` (AC6). **Check:** `pnpm typecheck` and `pnpm lint` pass; without `CI`, `pnpm e2e` still uses the `list` reporter with no retries.
- [x] **T2 — macOS title-bar test.** Add the mac-only test to `tests/e2e/window-chrome.spec.ts`, and reword the frameless test's skip reason (AC7). **Check:** `pnpm e2e` passes on Windows, with the new test skipped.
- [x] **T3 — Workflow.** Add `.github/workflows/ci.yml` with the `check` and `e2e` jobs (AC1–AC5). **Check:** `pnpm exec prettier --check .github/workflows/ci.yml` passes (Prettier parses the YAML); run `actionlint` if available, else note it was skipped.
- [x] **T4 — Docs.** Add the CI subsection to the CLAUDE.md Commands section (AC8), update README.md:84 (AC9), and add D22 to `docs/decisions.md` (AC10). Then run `pnpm format`. **Check:** `pnpm format:check` passes.
- [x] **T5 — Repo checks.** Run every local check (AC11). **Check:** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` and `pnpm e2e` pass on Windows.

AC12 is checked after result approval, from the pull request's checks; it is not a build task.
