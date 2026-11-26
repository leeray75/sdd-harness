# Phase 4 progress: Projects and environments (F3)

Status: in progress · Started: 2026-11-25

Remote: `origin` = https://github.com/leeray75/sdd-harness.git. Feature branches come into `main` through pull requests, and a pull request is merged only when CI is green on every job. The user merges each pull request on GitHub and says when it is done; Claude then fills in this file. No tracker is configured, so child tickets stay as `SUBTASK.md` drafts in `docs/specs/`.

The phase doc suggested five subtasks; the user chose a split into eight. Today every file tool, the command runner (lock and revert), the git module and the spec watcher call Node `fs` and `child_process` directly on one local root (`HARNESS_SPIKE_ROOT`). So `p4-env-local` first moves that code behind one environment interface with a local backend and no behaviour change. Then each remote backend is its own subtask, and each one runs the phase 3 headless walk on its backend. Every subtask's spec has a docs task and acceptance criterion (CHANGELOG, stale docs including `CLAUDE.md` and `README.md`, useful new docs), done in the build.

| #   | Feature               | Goal                                                                                                                                                                                                                                 | Status  | Spec                                            | Commit                                              |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | ----------------------------------------------- | --------------------------------------------------- |
| 1   | p4-project-store      | Persisted projects in app data (add, remove without deleting files) and per-project rules (round limit, model policy, commit format) feeding the engine; the spec and ship handlers work per project instead of `HARNESS_SPIKE_ROOT` | done    | [SUMMARY](../specs/p4-project-store/SUMMARY.md) | `080d4d2` (PR #27; work `905ba03`, close `811c206`) |
| 2   | p4-env-local          | One environment interface for files, commands, git and watching; the tools, the command runner, the git module and the spec lock moved onto it with a local backend, with no behaviour change                                        | done    | [SUMMARY](../specs/p4-env-local/SUMMARY.md)     | `90fc219` (PR #28; work `7cf4efd`, close `ca82cb1`) |
| 3   | p4-env-wsl            | WSL backend (distribution detection, files, commands, git, watching) and WSL projects in the store and registry, with the headless walk on a WSL project                                                                             | done    | [SUMMARY](../specs/p4-env-wsl/SUMMARY.md)       | `3951c5a` (PR #29; work `c43f9b1`, close `0a14b3a`) |
| 4   | p4-env-ssh            | SSH backend (D43) with saved servers, credentials, host key pins and reconnect; the unreachable, read-only project state for SSH and WSL; runs the headless walk on an SSH server                                                    | done    | [SUMMARY](../specs/p4-env-ssh/SUMMARY.md)       | `4965bb1` (PR #30; work `cb9f765`, close `742f58f`) |
| 5   | p4-env-container      | Dev container backend (Docker detection, attach, files and commands) that runs the headless walk                                                                                                                                     | pending |                                                 |                                                     |
| 6   | p4-project-checks     | Automatic checks and their results: git repository, code host from origin, tracker, test command, earlier specs                                                                                                                      | pending |                                                 |                                                     |
| 7   | p4-projects-screen    | Projects screen: cards with environment, path, six-segment stage bar, state and one action; Needs you, Running and Shipped panel; no-projects and unreachable (Reconnect) states                                                     | pending |                                                 |                                                     |
| 8   | p4-add-project-wizard | Add project wizard: where (four environments with detected details and disabled options with their fix), folder and checks, rules and models                                                                                         | pending |                                                 |                                                     |

## Decisions added

- D40: projects. The store in `projects.json` in app data, the rules model (round limit, model policy, commit format; spec approval and review are not rules), the per-project registry with the dev project from `HARNESS_SPIKE_ROOT`, and the amendment of D33's request to `{ action, project, feature }` (`p4-project-store`).
- D41: environments. The one interface every project-bound call goes through (`Environment`, with `ToolEnvironment` for the tools), the local backend, git per backend inside `src/main/git/`, async only, the path flavour per environment, the environment as a required parameter, and the one atomic writer (`p4-env-local`). The contract and the checklist for the later backends are in [`docs/environments.md`](../environments.md).
- D42: WSL. The WSL backend reaches a distribution's files on its share (`\\wsl.localhost\<distro>`, with `\\wsl$` as the fallback), runs programs and git through `wsl.exe` with a fixed launcher that gives each program its own process group, polls one folder for watching, detects distributions only when called, and accepts `{ kind: 'wsl', distribution }` in the store and registry (`p4-env-wsl`). Revision 1 of that spec makes the spec lock's atomic write use the shared writer and its rename retry (D41).
- D43: SSH.
  - **Library and transport:** the SSH backend uses `ssh2`, with SFTP for files and exec channels running the shared `setsid` launcher, every word quoted by one quoter, and a group kill. One connection per server is shared by its projects, and it never reconnects by itself.
  - **Saved servers:** kept in `ssh-servers.json`, with no secret in it. Passwords and passphrases are in `safeStorage`, read only at connect. Host keys are pinned per server and confirmed, and a changed key always refuses.
  - **Connection part:** a `connection` part on every environment. The registry keeps an unreachable project listed, removable and read-only, and Reconnect restores it. A stopped WSL distribution is unreachable, and Reconnect starts it (`p4-env-ssh`).

## Decide during planning

- SSH library and how credentials are handled: decided in `p4-env-ssh`, recorded as D43.
- How dev containers are attached (docker exec or the devcontainer CLI): in the `p4-env-container` plan, recorded as a new D-number.

## Follow-ups

- From `p4-project-store`:
  - Nothing calls `buildOptionsFor` yet. The build start (D39, with its UI or IPC, in `p4-projects-screen` or the phase 7 build view) must pass the project's round limit and commit format, and must not build a runner without the project.
  - No UI or IPC reaches the store: `change-rules` keeps no handler and answers `not-available`. `p4-projects-screen` and `p4-add-project-wizard` add the list, add, rename, rules and remove calls, each with the user gesture check.
  - The model policy is stored and validated, and nothing routes on it yet (phase 8).
  - A stored project whose folder has moved or been removed stays listed until a request for it is refused by its handlers. `p4-project-checks` reports it.
  - The e2e launch has no projects, so the e2e suite covers only the refusal of an unknown project. A test that adds a project through the store belongs with `p4-projects-screen`.
  - The `dev` project exists only in an unpackaged run with `HARNESS_SPIKE_ROOT` set. A packaged app has no dev project and no project until the add wizard exists.
  - The build was clean: review round 1 passed with no findings, with no spec revisions. The reviewer listed two runtime checks:
    - a saved project and the `dev` project that share a root get two watchers;
    - the filesystem-dependent store tests, which run with 15 s and 20 s timeouts, plus a case-only duplicate test that runs on Windows and macOS only.
- From `p4-env-local`:
  - **Decided in revision 1 of `p4-env-local`: the secret store's save.** The secret store keeps its own synchronous save, with mode `0o600`, unchanged. Only the project store's atomic save uses the shared helper (`localEnvironment().files`). The helper is asynchronous and has no mode option, so moving the secret store would have made it async and dropped its file mode. Not taken: a `mode` option on the async helper with an async secret store, or a synchronous form of the helper in the local backend. `src/main/secrets/store.ts` is not changed by this subtask.
  - **Interface members beyond the Design's list.** `files.readlink`, `files.symlink` and `files.rmdir` (the protected-set restore needs them), and `process.networkLevel()`, which the command runner calls before it locks the spec folder, so the network rule event keeps its place. `readFile` with a byte cap refuses a larger file with `EFBIG`.
  - **Probes moved.** The `unshare` and `sandbox-exec` probes are in `src/main/env/probes.ts`, so `src/main/commands/network.ts` is pure (AC2). Two test files import `probeNetwork` from the new path; their assertions are unchanged.
  - **`node:path` left in moved modules.** `src/main/commands/lookup.ts` (`posix` and `win32`, to pick the PATH separator and file names by platform) and `src/main/agent/host.ts` (`join`, for the path of the agent script, not a project path). The local backend is the path flavour itself.
  - **Modules that took the environment beyond the Design's list.** `build-loop.ts` calls the lock helpers, so it takes the environment in its controller options. `spec-folders.ts`, `spec-lock.ts`, `spec-watch.ts`, `spec-handlers.ts`, `ship.ts` and `ship-handlers.ts` take the full `Environment` (they need `watch` or `git`), and the tools, the commands and the agent host take `ToolEnvironment`.
  - **Registry.** A project whose environment cannot be made is refused by `handlerFor` and by `removeProject` as an unknown project, so it cannot be removed from the list until the environment exists. Decided by `p4-env-ssh` (D43, revision 1): a project whose environment cannot be made stays listed and removable, its requests are refused as an unknown project, and `reconnect(id)` tries to make it again; a project that was made but cannot be reached is refused with `PROJECT_UNREACHABLE`.
  - **Headless walk under load.** The walk (`tests/unit/headless-e2e.test.ts`) failed once in several full runs with `the build step could not finish`, which the controller reports for any exception in a step. It did not reproduce in the later full runs or in a heavy-file run. The controller hides the cause, so `p4-projects-screen` or the phase 7 build view should log the error text there.
  - **The build.** One spec revision, on the secret store's save, before any review. Review round 1 found two minor gaps in the AC2 boundary scan (import forms without `node:`, and `./network` inside `commands`), both fixed. Round 2 passed. The reviewer listed two runtime checks:
    - on Windows, a timed-out tree is dead before the result returns (the async `taskkill` path);
    - the headless walk under parallel load.
  - **Agent host environment.** `src/main/index.ts` starts the agent host with `environmentFor({ kind: 'local' })`, not the dev project's environment, because the host starts even without a dev project. Once jobs are started per project (D39, the build start), the host should take that project's environment.
- From `p4-env-wsl`:
  - **Rename retry (revision 1).** The spec lock's `writeAtomic` uses the shared atomic writer and its rename retry, because a rename over an existing file fails with `EPERM` now and then on the share and under parallel load. The WSL files part's own `rename` still makes one attempt and passes the code through. Not taken: a retry only in the WSL files part, or `mv -f` through `wsl.exe` for every WSL rename.
  - **Git timeout.** A timed-out git call stops `wsl.exe`, but the Linux git process may keep running, because git is not started through the group launcher. Fixing it needs git through the launcher, which the spec's argument form does not allow.
  - **Symlink tests.** The symlink cases in `tests/unit/env-wsl.test.ts` skip where Windows does not let the process create symbolic links, so they were not run on this machine. They need a runtime check on a machine that can make links.
  - **Real wsl.exe quoting.** The fake transport checks the argument arrays, but not how Windows quotes an argument with quotes when it reaches the distribution. Checked live only with bash-quoted arguments.
  - **Watching cost.** Each WSL project lists its spec folder about once a second. The plan's risk: recorded here, to measure if it matters.
  - **Share names.** A Linux name with a backslash or a colon cannot be reached through the share (`ENOENT`).
  - **Detection is not wired.** `detectWsl` is for the add wizard (`p4-add-project-wizard`).
  - **Stopped distributions.** A stopped distribution gives a code for each call, not an unreachable state. Decided by `p4-env-ssh` (D43): the unreachable and read-only states cover WSL too (a missing share root or a run that cannot start), and `reconnect()` starts a stopped distribution. The Reconnect button and the read-only look are `p4-projects-screen`.
  - **WSLENV.** The wsl.exe process gets `WSLENV` set to the crossing names, which replaces the app's own `WSLENV` for that process.
  - **Live walk on this machine.** `pnpm test:live` runs the WSL walk, and it needs Windows with WSL and git in the default distribution (or `HARNESS_WSL_DISTRO`). It is skipped elsewhere.
  - **The build.** One spec revision (the rename retry), paused before any review. Review round 1 found one stale comment in `spec-lock.ts`, which was fixed, and round 2 passed. The live WSL walk passed three runs in a row (about 16 s each). The reviewer listed two runtime checks: the group kill of a hung command on real WSL, and a Linux git process outliving a killed `wsl.exe`.
  - **Linux CI failures.** The `check (Linux)` Unit tests failed on `main` from this subtask's merge (runs `45759188885` and `45759278127`, and again on `4965bb1`). They are fixed by `p4-ci-linux-fix`: the share-result mapping in `linuxResult` and the WSL name check in `environmentFor`. The last case, the env-recording WSL `run_command` test (run `45862070215`, a non-executable fixture on Linux), is fixed by `p4-ci-linux-fix-2`: the fixture is written with mode `0o755`.
- From `p4-env-ssh`:
  - **Not wired to a UI.** No IPC reaches the server store, `trustHostKey`, `stateOf` or `reconnect`. The add wizard (`p4-add-project-wizard`) adds servers and shows the fingerprint to confirm. The projects screen (`p4-projects-screen`) shows the unreachable state, the Reconnect button and the read-only look.
  - **Stop before the marker.** A timeout or an abort that comes before the launcher's group marker closes only the channel, as the spec says, so a remote program can keep running (review R1-2; documented in `docs/environments.md`).
  - **Packaging.** `electron-builder.yml` has `npmRebuild: false`, and `pnpm-workspace.yaml` has `allowBuilds` entries, so the optional native `cpu-features` of `ssh2` is never built. A native module added later would need the rebuild back.
  - **Runtime checks.**
    - The ssh2 event order when a host key is refused (`error` before `close`). Otherwise an unpinned or changed key shows as unreachable.
    - The group kill on macOS and on Linux servers other than WSL Ubuntu.
    - Password and agent sign-in, since the live walk used a key.
  - **Live walk.** `tests/live/ssh-walk.live.test.ts` needs `HARNESS_SSH_HOST`, `HARNESS_SSH_USER`, `HARNESS_SSH_KEY` and `HARNESS_SSH_ROOT` (optional `HARNESS_SSH_PORT`, `HARNESS_SSH_FINGERPRINT`). It passed once, taking 144 s, against a throwaway sshd in WSL Ubuntu on 127.0.0.1:2222. That sshd, a test key in WSL `~/.ssh/authorized_keys`, `/tmp/sddssh/` and a key copy in Windows temp were left on the build machine.
  - **Interface additions.** These are beyond the spec's list:
    - `SshTransport.platform()`, `identity()` and `connectionId()`;
    - `SshSftp.unlink`;
    - `WslTransport.rediscover()`;
    - `ServerStore.load()`.

    The WSL share root is read on each call. A missing WSL distribution is recognised only in `reconnect()`.

  - **The build.**
    - One spec revision, at T12 before any review: the registry refuses by cause, so the existing registry test held.
    - Review round 1 had two minor findings, both rejected. The stray crash dump predates the feature. The stop before the marker matches the spec and is now documented.
    - Round 2 passed.
    - The live walk caught and fixed a transport bug: `stat` never settled for a missing path.
