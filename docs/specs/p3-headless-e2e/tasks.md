# Tasks: p3-headless-e2e

Work in order. After each task, run its check, then tick the box.

- [x] **T1: App runner factory.** Create `src/main/workflow/app-runner.ts` with `createAppJobRunner`, as the spec's Design says: the root's command context with the live supplier through `contextFor`, and `onRuleEvent: logRuleEvent(log)`. Add `tests/unit/app-runner.test.ts`: every decision reaches a recording logger as its `formatRuleEvent` line, and a change in the live supplier is seen by the next call (AC5). **Check:** `pnpm typecheck && pnpm exec vitest run tests/unit/app-runner.test.ts` passes.
- [x] **T2: Plugin fixtures.** _Revised in revision 1: the orchestrator writes `SUMMARY.md`, which the subagent's Write tool refused; verify it with the same check, then update the README._ Copy the seven files of `docs/specs/p3-ship/` at `c580d56` byte for byte into `tests/fixtures/sdd-plugin/specs/p3-ship/` (with `git show`, no reformatting). Update `tests/fixtures/sdd-plugin/README.md` with the source and the commit. **Check:** `git diff --no-index` of each file against `git show c580d56:docs/specs/p3-ship/<file>` output is empty.
- [x] **T3: Plugin folder states.** _Revised in revision 1: the fixture check uses SHA-256 values recorded in the test, taken from `git show c580d56` output, and runs no git._ Add `tests/unit/plugin-folder-states.test.ts`: a test that the fixtures match the recorded SHA-256 values, and one case per state in the spec's table, built in a temp root, checked with `scanSpecFolders`'s node and stage (AC6). **Check:** `pnpm exec vitest run tests/unit/plugin-folder-states.test.ts` passes.
- [x] **T4: Headless walk, setup.** Add `tests/unit/headless-e2e.test.ts` with:
  - the temp-repo helper (the git config, a bare `origin`, the initial commit pushed, `origin/HEAD`, the feature branch);
  - the channel with the spec and ship handlers and a test gesture tracker;
  - the controller with the factory's runner and the scripted provider;
  - a git snapshot helper (HEAD, commit count, remote ref).

  Cover steps 1 and 2 of the Design (revised in revision 1: step 2 includes the successful `edit-approved-spec` and re-approval before the controller is created), and the refused call without a gesture (AC2). **Check:** `pnpm exec vitest run tests/unit/headless-e2e.test.ts` passes.
- [x] **T5: Headless walk, build.** Extend the walk through steps 3 to 5:
  - the denied SPECS.md write;
  - the ISSUES round and its fix;
  - the spec-change pause, the revise, the refused `edit-approved-spec`, the direct edit of SPECS.md, the re-approval and the resumed Mode 3 (revised in revision 1);
  - the passing review;
  - the change round.

  After each step, check the node and the unchanged git snapshot (AC1, AC3, AC4). **Check:** `pnpm exec vitest run tests/unit/headless-e2e.test.ts` passes.
- [x] **T6: Headless walk, ship and close.** Extend the walk through steps 6 and 7: the one commit and its push, the message, the committed paths, then the close commit, its push, and the `closed` detection (AC1, AC3). Give the test an explicit timeout. Confirm that no product file other than `app-runner.ts` changed (AC7). **Check:** `pnpm exec vitest run tests/unit/headless-e2e.test.ts` passes, and `git diff --stat main -- src` lists only `src/main/workflow/app-runner.ts`.
- [x] **T7: Docs.** Do AC8:
  - the CHANGELOG entry;
  - D39;
  - the "Headless run" section in `docs/workflow-engine.md`, and the job placement there and in `docs/agent-jobs.md`;
  - CLAUDE.md (D1–D39) and README.md;
  - the PRD F2 items checked against the tests;
  - `docs/workflow.md`;
  - the phase-03 doc: the subtask note, and the Definition of done ticked with its evidence;
  - the progress follow-ups resolved.

  Record every file and the stale-doc check in `changes.md`. **Check:** `pnpm format:check` passes, and every doc in AC8 is listed in `changes.md`.
- [x] **T8: Full checks.** _Ticked by the orchestrator after the PASS: typecheck, lint and format:check pass, and `pnpm test` gave 78 files, 1576 passed and 15 skipped. The implementor's three earlier full runs each had 1–3 timeouts in the out-of-scope `tool-files.test.ts` (a known flake under load)._ Run typecheck, lint, format:check and the full test suite (AC9). **Check:** `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` passes.
