# Tasks: p4-ci-linux-fix

Work in order. After each task, run its check, then tick the box. An existing test may change only how it builds its dependencies, never what it asserts (AC4).

- [x] **T1: linuxResult.** Apply the four rules in `src/main/env/wsl.ts`, and add the AC1 cases to `tests/unit/env-wsl.test.ts` for a POSIX root and a UNC root. **Check:** `pnpm exec vitest run tests/unit/env-wsl.test.ts tests/unit/env-recording.test.ts` passes.
- [x] **T2: environmentFor order.** Check the WSL name before the platform in `src/main/env/index.ts`, and add the AC2 case (no name, with `platform: 'linux'` injected). **Check:** `pnpm exec vitest run tests/unit/env-local.test.ts tests/unit/env-wsl.test.ts` passes.
- [x] **T3: Other Linux failures.** Read the `check (Linux)` annotations of the newest run on `main` (`4965bb1` or `026c76c`) through the public GitHub API (`/repos/leeray75/sdd-harness/actions/runs?branch=main`, then `/check-runs/<job id>/annotations`). For each failure not covered by T1 or T2, find the cause and fix it in the product code or the test support. If the run has not finished, or reports nothing more, record that in `changes.md`. **Check:** each annotated failure has a fix or a stated reason, and `pnpm test` passes.
- [x] **T4: Docs.** Do AC5. **Check:** `pnpm format:check` passes.
- [x] **T5: Checks.** Run `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test`. Check AC4 with `git diff main -- tests/`. **Check:** all pass, and no assertion changed. The pull request's CI run is checked after the push (AC6).
