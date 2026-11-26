# Tasks: p4-env-wsl

Work in order. After each task, run its check, then tick the box. Keep the suite green after each task. An existing test may change only how it builds its dependencies, never what it asserts (AC13).

- [x] **T1: git launcher.** In `src/main/git/git.ts`, add `GitLauncher` and `createGit(launcher)`. Route `runGit` and `ignoredEntries` through the launcher, and keep the exported functions as the local instance over `execFile('git', …)`. The argument lists, env, timeouts, parsing and codes are unchanged. **Check:** `pnpm exec vitest run tests/unit/git.test.ts tests/unit/git-boundary.test.ts tests/unit/ship.test.ts tests/unit/env-local.test.ts` passes, with no assertion changed.
- [x] **T2: Detection.** Add `src/main/env/wsl-detect.ts` with `detectWsl` and `isDistributionName`, with the program run injected for tests. Add `tests/unit/wsl-detect.test.ts` (AC1). **Check:** `pnpm exec vitest run tests/unit/wsl-detect.test.ts` passes.
- [x] **T3: Fake transport, path and files.** Add `tests/support/fake-wsl-transport.ts`. In `src/main/env/wsl.ts`, add `WslTransport`, the path mapping, the path part and the files part, including `symlink` and `chmod` through the transport. Start `tests/unit/env-wsl.test.ts` with the AC2 cases. **Check:** `pnpm exec vitest run tests/unit/env-wsl.test.ts` passes.
- [x] **T4: Process part.** Add the launcher constant, the spawn argv, the `WSLENV` environment, the marker handling, the group kill on timeout and abort, and the once-per-backend network probe, with `networkLevel()`. Add the AC3 cases. **Check:** `pnpm exec vitest run tests/unit/env-wsl.test.ts` passes.
- [x] **T5: Watch part.** Add the polling `watchDir` and the AC4 cases. **Check:** `pnpm exec vitest run tests/unit/env-wsl.test.ts` passes.
- [x] **T6: Git part, failures and the app transport.**
  - Add `wslLauncher` and the git part through `createGit`, with the AC5 cases.
  - Add the AC6 no-throw cases.
  - Add `appWslTransport(distribution)`: it finds the share root, `\\wsl.localhost` then `\\wsl$`, and spawns `wsl.exe` with no shell.
  - Add `createWslEnvironment`.

  **Check:** `pnpm exec vitest run tests/unit/env-wsl.test.ts` passes.
- [x] **T7: environmentFor.** Build the WSL backend for `{ kind: 'wsl', distribution }` on `win32`, and add the `WSL_UNAVAILABLE` refusal. Inject the platform and transport factory for the tests. Add the AC7 cases. **Check:** `pnpm exec vitest run tests/unit/env-wsl.test.ts tests/unit/env-local.test.ts` passes.
- [x] **T8: Store and registry.**
  - Add the descriptor union, its validation, and the WSL root check through the environment passed to `store.add`.
  - Change the duplicate rule, load, `copyOf` and the environment reason.
  - The registry passes its environment to `store.add`.
  - Add the AC8 cases.

  **Check:** `pnpm exec vitest run tests/unit/project-store.test.ts tests/unit/project-registry.test.ts` passes and `pnpm typecheck` passes.
- [x] **T9: Recording backend and boundary.**
  - Generalize `tests/support/recording-env.ts` so it can wrap any backend, keeping its current default.
  - Add the AC9 cases over the WSL backend with the fake transport.
  - Add the AC10 `wsl.exe` scan to `tests/unit/env-boundary.test.ts`.

  **Check:** `pnpm exec vitest run tests/unit/env-recording.test.ts tests/unit/env-boundary.test.ts` passes.
- [x] **T9b: Spec lock rename retry.** _Added in revision 1._ Make `writeAtomic` in `src/main/workflow/spec-lock.ts` use the shared `writeFileAtomic(env.files, …)` and its rename retry, with its result and reasons unchanged (the spec's "Spec lock atomic write" section). If the shared writer must report the last error code, add that as an option, with its default result unchanged. Add the AC14 cases to `tests/unit/spec-lock.test.ts`. **Check:** `pnpm exec vitest run tests/unit/spec-lock.test.ts tests/unit/spec-watch.test.ts tests/unit/spec-handlers.test.ts tests/unit/tool-write.test.ts tests/unit/env-local.test.ts` passes, with no existing assertion changed.
- [x] **T10: Headless walk helper and the live WSL walk.** _Revised in revision 1: the live walk must pass on at least 3 runs in a row after T9b, reported for the summary._
  - Move the walk body of `tests/unit/headless-e2e.test.ts` into `tests/support/headless-walk.ts`, taking the setup. The unit test calls it with the local setup, with no assertion changed.
  - Add `tests/live/wsl-walk.live.test.ts` (AC11), with its skip conditions.

  **Check:** `pnpm exec vitest run tests/unit/headless-e2e.test.ts` passes, and `pnpm test:live` runs the WSL walk on this machine (record the result for the summary).
- [x] **T11: Docs.** _Revised in revision 1: the docs also say that the spec lock's atomic write uses the shared writer's rename retry, and why (`docs/workflow-engine.md` "Spec lock", `docs/environments.md`, the CHANGELOG)._ Do every item in AC12:
  - the CHANGELOG entry;
  - D42 and the note under D41;
  - `docs/environments.md` and `docs/agent-commands.md`;
  - `CLAUDE.md`, `README.md` and `docs/PRD.md`;
  - the phase doc;
  - row 3 and the follow-ups of the progress file.

  **Check:** `grep -n "D42" docs/decisions.md` finds it, and `pnpm format:check` passes.
- [x] **T12: Full checks.** _Revised in revision 1: `pnpm test` must pass in its default parallel mode (AC14)._ Run `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` and `pnpm e2e`. Check AC13 with `git diff main -- tests/`. **Check:** all five commands pass, and the diff review finds no changed assertion.
