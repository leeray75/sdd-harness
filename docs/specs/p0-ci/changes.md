# Changes: p0-ci

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| `playwright.config.ts` | edited | Reads `process.env.CI`: `retries: 2`, `use.trace: 'on-first-retry'` and the list plus HTML reporter in CI only; local behaviour unchanged (AC6). | T1 |
| `tests/e2e/window-chrome.spec.ts` | edited | Adds a macOS-only test for `getWindowButtonPosition()` = `{ x: 14, y: 13 }` and `header.titlebar` `padding-left` = `78px` (AC7). Adds `paddingLeft` to the `DomLike` type. Rewords the frameless test's skip reason to point at the new test. | T2 |
| `.github/workflows/ci.yml` | created | CI workflow: `check` job (Linux) and `e2e` job (Windows, macOS, Linux matrix) with setup, e2e, unsigned `electron-builder --dir`, and failure-only report upload (AC1-AC5). | T3 |
| `CLAUDE.md` | edited | Adds a "CI" subsection under Commands: jobs, local reproduction, the Windows-not-WSL note and `SDD_TEST_CMD="pnpm test"` (AC8). | T4 |
| `README.md` | edited | Line 84 now suggests `SDD_TEST_CMD="pnpm test"` to match CLAUDE.md (AC9). | T4 |
| `docs/decisions.md` | edited | Adds D22 "Continuous integration" in the D14-D21 format, with the alternatives not taken for each choice (AC10). | T4 |
| `docs/specs/p0-ci/tasks.md` | edited | Ticked T1 to T5 after their checks passed. | T1, T2, T3, T4, T5 |
| `docs/specs/p0-ci/changes.md` | created | This record of the changes. | T5 |
