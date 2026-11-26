# Tasks: p4-env-local

Work in order. After each task, run its check, then tick the box. Keep the suite green after each task: a test may change only how it builds its dependencies (AC3), never what it asserts.

- [x] **T1: Interface and local backend.** Create `src/main/env/types.ts` (`Environment`, `ToolEnvironment`), `src/main/env/local.ts` and `src/main/env/index.ts` (`environmentFor`, `localEnvironment`, `toolEnvironment`), following the spec's Design:
  - move the spawn, timeout and tree-kill code out of `run-command.ts` into the local `process.spawn`, with the Windows `taskkill` no longer run through `execFileSync`;
  - apply `network: 'none'` through `src/main/commands/network.ts`;
  - bind the `git` part to the existing functions in `src/main/git/git.ts`, leaving `git.ts`'s `execFile('git'` where it is.

  Add `tests/unit/env-local.test.ts` (AC5). **Check:** `pnpm exec vitest run tests/unit/env-local.test.ts` passes.
- [x] **T2: Atomic write, paths and walk.** _Revised in revision 1: only the project store moves to the shared helper; the secret store keeps its own synchronous `0o600` save, unchanged. Also replace the "Spec conflict, not resolved" follow-up in `docs/phases/phase-04-progress.md` with this decision, and check that D41 and the note under D29 say the same._ Make `writeFileAtomic` take `files` first, and point the project store at `localEnvironment().files`. Make `paths.ts` and `walk.ts` work over `env.path` and `env.files`, with the same rules and reasons. Update the callers and the tests' wiring. **Check:** `pnpm exec vitest run tests/unit/tool-paths.test.ts tests/unit/policy-paths.test.ts tests/unit/project-store.test.ts tests/unit/secret-store.test.ts tests/unit/secret-plain-text.test.ts` passes.
- [x] **T3: File tools.** Move `read-file`, `write-file`, `edit-file`, `list-files` and `search-text` onto `ToolEnvironment`, as a required first parameter. **Check:** `pnpm exec vitest run tests/unit/tool-files.test.ts tests/unit/tool-write.test.ts tests/unit/tool-reachability.test.ts` passes.
- [x] **T4: Commands and run-command.** Make `detect.rootMarkerFiles` and `lookup.resolveProgram` async over `files`. Move `protect` onto `files` and `env.ignoredEntries`, so it no longer imports `../git/git`. Make `run-command` spawn through `env.process.spawn` with the `network` option, keeping its rule events and refusal reasons. **Check:** `pnpm exec vitest run tests/unit/command-detect.test.ts tests/unit/command-lookup.test.ts tests/unit/command-protect.test.ts tests/unit/command-network.test.ts tests/unit/command-allowlist.test.ts tests/unit/command-acceptance.test.ts tests/unit/tool-command.test.ts` passes.
- [x] **T5: Agent host and runners.** Make `commandPolicyFor(env, root, live?)` async in `src/main/agent/host.ts`, with the tool dispatch passing the environment. `job-runner.ts` and `app-runner.ts` take the environment and pass it on. **Check:** `pnpm exec vitest run tests/unit/policy-acceptance.test.ts tests/unit/policy-gate.test.ts tests/unit/jobs-tools.test.ts tests/unit/tool-registry.test.ts` passes.
- [x] **T6: Spec folders, lock and watcher.** Move `spec-folders.ts`, `spec-lock.ts` and `spec-watch.ts` onto `files`, `path` and `watch`, and update `spec-handlers.ts` (deps gain `env`). **Check:** `pnpm exec vitest run tests/unit/spec-folders.test.ts tests/unit/spec-lock.test.ts tests/unit/spec-watch.test.ts tests/unit/spec-handlers.test.ts` passes.
- [x] **T7: Ship.** Move `ship.ts` onto `files`, `path` and `git`, and update `ship-handlers.ts` (deps gain `env`). **Check:** `pnpm exec vitest run tests/unit/ship.test.ts tests/unit/ship-handlers.test.ts tests/unit/git.test.ts tests/unit/git-boundary.test.ts` passes, with `git-boundary.test.ts` unchanged (AC4).
- [x] **T8: Registry and app.** The registry takes `environmentFor`, holds one environment per project, refuses a project whose environment cannot be made, and adds `environmentOf`. `src/main/index.ts` passes `environmentFor`. Add the AC8 cases to `tests/unit/project-registry.test.ts`. **Check:** `pnpm exec vitest run tests/unit/project-registry.test.ts` passes and `pnpm typecheck` passes.
- [x] **T9: Boundary scan, recording backend and the headless walk.**
  - Add `tests/unit/env-boundary.test.ts` (AC2).
  - Add `tests/support/recording-env.ts`, and tests that use it for the tools, `run_command`, the spec lock and watcher, and `approveResult` (AC6).
  - Change `tests/unit/headless-e2e.test.ts` to build a registry with one local project in its temp repo and to run the walk through `environmentOf` and `handlerFor` (AC7), with no assertion changed.

  **Check:** `pnpm exec vitest run tests/unit/env-boundary.test.ts tests/unit/headless-e2e.test.ts` and the recording-backend tests pass.
- [x] **T10: Docs.** Do every item in AC9:
  - the `CHANGELOG.md` entry;
  - D41, with the notes under D29, D31 and D38;
  - the new `docs/environments.md`;
  - `docs/workflow-engine.md` and `docs/agent-commands.md`;
  - `CLAUDE.md`;
  - `README.md`, `docs/PRD.md` and `docs/workflow.md` where they are affected;
  - `docs/phases/phase-04-projects.md`;
  - row 2 and the follow-ups in `docs/phases/phase-04-progress.md`. In the follow-ups, list any `node:path` import left in a moved module.

  **Check:** `grep -n "D41" docs/decisions.md` finds it, `docs/environments.md` exists, and `pnpm format:check` passes.
- [x] **T11: Full checks.** Run `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` and `pnpm e2e`. Check AC3 with `git diff main -- tests/`: no `expect` line changes except an added environment argument or `await`. **Check:** all five commands pass, and the diff review finds no changed assertion.
