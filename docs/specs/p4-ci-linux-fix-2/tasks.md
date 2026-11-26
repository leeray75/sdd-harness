# Tasks: p4-ci-linux-fix-2

Work in order. After each task, run its check, then tick the box. An existing test may change only how it builds its dependencies, never what it asserts.

- [x] **T1: Executable fixture.** Add `{ mode: 0o755 }` to the `writeFileSync` of `share/usr/bin/tool` in the WSL `beforeAll` of `tests/unit/env-recording.test.ts`. **Check:** `pnpm exec vitest run tests/unit/env-recording.test.ts` passes, and `git diff main -- tests/` shows only that line.
- [x] **T2: Docs.** Do AC2. **Check:** `pnpm format:check` passes.
- [x] **T3: Checks.** Run `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test`. **Check:** all pass. The pull request's `check (Linux)` job is checked after the push (AC3).
