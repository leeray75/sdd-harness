# Tasks: p2-fix-e2e-selfcheck

Work in order. After each task, run its check, then tick the box.

- [x] **T1: Update the self-check e2e test.** In `tests/e2e/agent-process.spec.ts`:
  - replace the two `toMatch` patterns with the D30 Rule line and the agent's denied result (AC1, AC2);
  - replace the `selfcheck.txt` leak check with the `probe-body` check plus a check that no `rule` line contains the absolute `root` (AC3);
  - update the title and comments (AC4).

  Keep the pid and clean-exit checks. **Check:** `pnpm e2e` shows `agent-process.spec.ts` passing.
- [x] **T2: Check the other e2e specs.** Read `smoke`, `design-tokens`, `spike-agent` and `window-chrome` for expectations that are stale after D29–D31, and record the result in `changes.md`. **Check:** `pnpm e2e` gives 15 passed, 2 skipped, 0 failed (AC5).
- [x] **T3: Changelog and docs.**
  - a Fixed entry in `CHANGELOG.md`;
  - the CI-green rule in `CLAUDE.md` Conventions and in step 6 of `docs/phases/phase-02-tool-policy.md`;
  - in `docs/phases/phase-02-progress.md`, a row for `p2-fix-e2e-selfcheck` (status pending) and the CI follow-up;
  - a stale-doc check table in `changes.md`.

  **Check:** `git diff --stat` lists the four docs (AC6).
- [x] **T4: Full checks.** Run `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test`. **Check:** all pass (AC7; the CI part is checked on the PR).
