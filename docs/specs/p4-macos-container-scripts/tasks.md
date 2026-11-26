# Tasks: p4-macos-container-scripts

Work in order. After each task, run its check, then tick the box. An existing test may change only how it builds its dependencies, never what it asserts.

- [x] **T1: Probe and skip.** In `tests/unit/container-scripts.test.ts`, add `STAT_C` (the one-time `stat -c %s` probe through `SH` on a temp file), and make the `it` of each scenario whose body is `FILES_SCRIPTS.stat` or `FILES_SCRIPTS.statFollow` `it.skipIf(!STAT_C)`. Update the header comment. **Check:** `pnpm exec vitest run tests/unit/container-scripts.test.ts` passes (skipped on Windows), and `git diff main -- tests/` shows only these changes (AC1).
- [x] **T2: Linux run.** If a Linux Node 24 run is available (for example a throwaway `node:24` container in WSL Docker, removed afterwards), run the file there and record that 51 run with 0 skipped. Otherwise record that it was not run, and why. **Check:** the result is in the implementation report.
- [x] **T3: Docs.** Do AC3. **Check:** `pnpm format:check` passes.
- [x] **T4: Checks.** Run `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test`. **Check:** all pass. This pull request's CI, and then PR #33's macOS job, are checked after the push.
