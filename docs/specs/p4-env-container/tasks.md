# Tasks: p4-env-container

Work in order. After each task, run its check, then tick the box. Keep the suite green after each task. An existing test may change only how it builds its dependencies, never what it asserts (AC15).

- [x] **T1: Transport interface and docker command.** In `src/main/env/container-transport.ts`, define `ContainerTransport`, `DockerHost`, the run options and result, and the argument prefix for each Docker host, including `WSLENV` for the WSL host. Implement `appContainerTransport(host)` over `node:child_process` with no shell. **Check:** `pnpm typecheck` passes.
- [x] **T2: Lookup, user and exec form.** Add `findContainer`, the metadata user rule and the exec argument builder to `container-transport.ts`. Add `tests/support/fake-container-transport.ts`, and start `tests/unit/env-container.test.ts` with the AC2 and AC3 cases. **Check:** `pnpm exec vitest run tests/unit/env-container.test.ts` passes.
- [x] **T3: Path and files.** In `src/main/env/container.ts`, add the path part and the files part with the fixed scripts and the code-word mapping. Add the AC4 cases, and `tests/unit/container-scripts.test.ts`, which runs the fixed scripts through a real POSIX `sh` where one exists. **Check:** `pnpm exec vitest run tests/unit/env-container.test.ts tests/unit/container-scripts.test.ts` passes.
- [x] **T4: Process part.** _Revised in revision 1: the kill exec runs `kill -s KILL -- -<pgid>`, and the AC5 case checks that form._ Add `spawn` (the exec form, the variables, the marker, the group kill, `{ started: false }`), the platform and the network probe with `networkLevel()`. Add the AC5 cases. **Check:** `pnpm exec vitest run tests/unit/env-container.test.ts` passes.
- [x] **T5: Watch, git and connection.** _Revised in revision 1: the gone-container check matches only docker's own message lines, and for a launched program only before the marker; add the AC7 revision 1 cases._ Add `watchDir` through the shared poller, the git part through `createGit` with the container launcher, the connection part with the connect checks and `CONTAINER_RECONNECT_REASONS`, and the gone-container handling. Add `createContainerEnvironment` and the AC6 and AC7 cases. **Check:** `pnpm exec vitest run tests/unit/env-container.test.ts tests/unit/git.test.ts tests/unit/git-boundary.test.ts` passes.
- [x] **T6: Detection.** Add `src/main/env/container-detect.ts` (`detectDocker`) and `tests/unit/container-detect.test.ts` (AC10). **Check:** `pnpm exec vitest run tests/unit/container-detect.test.ts` passes.
- [x] **T7: environmentFor, store and registry.**
  - Build the container backend in `src/main/env/index.ts` (AC8).
  - Add the descriptor, its validation, the root check and the duplicate rule to `src/main/projects/store.ts`.
  - Append the AC1 and AC9 cases to `tests/unit/project-store.test.ts` and `tests/unit/project-registry.test.ts`, and the AC8 cases to the environment tests.

  **Check:** `pnpm exec vitest run tests/unit/project-store.test.ts tests/unit/project-registry.test.ts tests/unit/env-container.test.ts` and `pnpm typecheck` pass.
- [x] **T8: Walk, recording backend and boundary.** Add the headless walk on a container project over the fake transport, the AC11 cases to `tests/unit/env-recording.test.ts`, and the `docker` check to `tests/unit/env-boundary.test.ts` (AC12). **Check:** `pnpm exec vitest run tests/unit/headless-e2e.test.ts tests/unit/env-recording.test.ts tests/unit/env-boundary.test.ts` passes.
- [x] **T9: Live container walk.**
  - Add `tests/live/container-walk.live.test.ts` (AC13) through `tests/support/headless-walk.ts`, with its skip conditions and cleanup.
  - Start a throwaway container in WSL Docker. It carries the `devcontainer.local_folder` and `devcontainer.metadata` labels, has git and `setsid`, and runs as a non-root `remoteUser`.
  - Run the walk, and record the result (or why it was not run) for the summary.

  **Check:** `pnpm test:live` runs the container walk with the variables set, and skips it without them.
- [x] **T10: Docs.** Do every item in AC14. **Check:** `grep -n "D44" docs/decisions.md` finds it, and `pnpm format:check` passes.
- [x] **T11: Full checks.** Run `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` and `pnpm e2e`. Check AC15 with `git diff main -- tests/`. **Check:** all commands pass, and the diff review finds no changed assertion.
