# Tasks: p3-ship

Work in order. After each task, run its check, then tick the box.

- [x] **T1: Git module.** _Revised in revision 1: also move the D31 `ls-files` query from `src/main/commands/protect.ts` into `git.ts` as `ignoredEntries(root, env?)`, with the same arguments, environment and results. `protect.ts` calls it and no longer imports `node:child_process`. Add a `git.test.ts` case for it. The existing protect and command tests must pass unchanged (`pnpm exec vitest run tests/unit/git.test.ts tests/unit/command-protect.test.ts tests/unit/command-acceptance.test.ts tests/unit/tool-command.test.ts`)._ Create `src/main/git/git.ts`: the private `runGit`, and `currentBranch`, `defaultBranch`, `changedPaths`, `stage`, `commit`, `push` and `aheadOfUpstream`, as the spec's Design says. Use no shell, `GIT_TERMINAL_PROMPT=0`, the timeouts and the fixed failure codes, and never return or log git's output. Add `tests/unit/git.test.ts` on temp repos, each with `user.name`, `user.email`, `init.defaultBranch=main` and `core.autocrlf=false` set, and a bare remote in a temp folder. Cover:
  - each function;
  - a rename and a deletion in `changedPaths`;
  - the bad-path refusals of `stage`;
  - a push to the bare remote and to a missing remote;
  - `aheadOfUpstream` with and without an upstream;
  - a folder that is not a repo.

  **Check:** `pnpm typecheck && pnpm exec vitest run tests/unit/git.test.ts` passes.
- [x] **T2: Ship module, approve.** _Revised in revision 1: make sure tests cover the two recorded behaviours (a missing SUMMARY, or one with no Git state line, refuses; a failed commit puts the Git state line back and stages it again, leaving the index clean). Add tests where they are missing._ Create `src/main/workflow/ship.ts` with the commit-message builder, the Git state line rewrite, the allowed set from `changes.md`, and `approveResult` in the spec's order. Add `tests/unit/ship.test.ts`, covering every AC1 refusal (nothing changed in each case), the AC2 commit with and without a ticket and with each summary fallback, and the committed SUMMARY line. Also cover the AC4 push failure, the kept commit, and the retry that pushes only, plus the "already committed and pushed" refusal and a failed commit that puts the Git state line back. **Check:** `pnpm exec vitest run tests/unit/ship.test.ts` passes.
- [x] **T3: Ship module, close.** _Revised in revision 1: the "another feature" test is the close-retry path of the reworded AC5 (a closed feature whose state file names another feature: untouched, no commit). The failed close commit puts both files back and stages them again. Confirm the tests match._ Add `markDone` to `src/main/workflow/ship.ts`, with CLOSE through `transition()`. Extend `tests/unit/ship.test.ts` with:
  - the refusals before approval and before the push;
  - the close commit, holding only SPECS.md and the state-file removal;
  - the push;
  - `closed` detection afterwards;
  - a state file naming another feature left alone;
  - a failed close commit putting both files back;
  - the close push retry (AC5, AC7).

  **Check:** `pnpm exec vitest run tests/unit/ship.test.ts` passes.
- [x] **T4: Handlers and wiring.** _Revised in revision 1: `onLockChanged` runs after every ship call, refused or not. The test shows both._ Create `src/main/human/ship-handlers.ts` (`createShipHandlers`). Register both handlers in `src/main/index.ts`'s `startSpecLock`, with `controllerNode` read from `buildControllers`. Add `tests/unit/ship-handlers.test.ts`, covering:
  - a refusal with `code: 'refused'` and a fixed reason;
  - a thrown error turned into a refusal;
  - `onLockChanged` called after a change;
  - the controller-mid-build refusal;
  - the registered handlers reached through the D33 channel with a gesture (AC1).

  **Check:** `pnpm typecheck && pnpm exec vitest run tests/unit/ship-handlers.test.ts tests/unit/human-channel.test.ts` passes.
- [x] **T5: Rule events.** Add `onRuleEvent` to `JobRunnerOptions` in `src/main/workflow/job-runner.ts`, called with every gate decision and passed to `makeToolRunner`. A throwing callback is caught. Extend `tests/unit/job-runner.test.ts` (AC6). **Check:** `pnpm exec vitest run tests/unit/job-runner.test.ts` passes.
- [x] **T6: No git before approval.** _Revised in revision 1: the scan holds as written once T1 moves the `protect.ts` query. No exemption is allowed._ Add a scan test (`tests/unit/git-boundary.test.ts`) for AC3:
  - only `src/main/git/` runs git through `node:child_process`;
  - no file under `src/agent/` or `src/shared/` names the git module;
  - no tool or job base tool is a git tool.

  Add a build-loop run on a temp git repo whose `git log` and `git status` of committed files are unchanged afterwards. **Check:** `pnpm exec vitest run tests/unit/git-boundary.test.ts tests/unit/build-loop.test.ts` passes.
- [x] **T7: Docs.** Do every item in AC8:
  - the CHANGELOG entry under [Unreleased];
  - D38 in `docs/decisions.md`;
  - a "Ship and close" section in `docs/workflow-engine.md`;
  - the two handlers in `docs/human-actions.md`;
  - `CLAUDE.md` (D1–D38);
  - `README.md`;
  - `docs/PRD.md` (the F2 item ticked);
  - `docs/workflow.md`;
  - the phase-03 doc;
  - the progress file's follow-ups.

  Record the stale-doc check in `changes.md`. **Check:** `pnpm format:check` passes, and each file named in AC8 shows in `git status`.
- [x] **T8: Full checks.** Run `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test`. Give slow temp-repo tests an explicit timeout if they time out under full parallel load. **Check:** all four pass.
