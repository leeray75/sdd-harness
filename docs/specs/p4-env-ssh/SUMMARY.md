# Summary Report: p4-env-ssh

Ticket: none   Date: 2026-11-26
Outcome: Clean
Review rounds: 2 of 3 in revision 1 (0 in revision 0); revisions: 1 of 2
Models: implementor haiku; reviewer sonnet; data agent not used (all chosen by the user); respawns: none

## What was built

An SSH backend now implements the whole `Environment` interface for one saved server and a remote POSIX root (G1, D43). It uses `ssh2` with:
- **files:** SFTP, with the contract's Node codes and a capped read;
- **programs and git:** exec channels that run the shared `setsid` launcher, with every word quoted by one quoter and a group kill on timeout or abort;
- **watching:** the shared polled watch.

Saved servers live in `ssh-servers.json`, which holds no secret. Passwords and passphrases live in the secret store and are read only at connect time. Host keys are pinned and confirmed, and a changed key always refuses (G2).

Every environment now has a `connection` part (G3):
- local is always connected;
- a stopped or missing WSL distribution is unreachable, and Reconnect starts it;
- SSH follows its transport.

The registry keeps an unreachable project listed, removable and read-only, and the refusal depends on the cause (revision 1). Reconnect restores the project.

SSH projects are stored with their root checked through the environment (G4). The headless walk passed live on an SSH project (G5), and the docs and D43 are updated (G6).

## Files changed

Product files (group 1):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| package.json | edited | `ssh2` runtime and `@types/ssh2` dev dependencies (D43) | T1 |
| pnpm-lock.yaml | edited | Lockfile for `ssh2` and its packages | T1 |
| pnpm-workspace.yaml | edited | `allowBuilds`: `cpu-features: false`, `ssh2: false` (pnpm 12 blocks build scripts by default) | T1 |
| electron-builder.yml | edited | `npmRebuild: false`, so packaging does not try to build the optional native `cpu-features` (`gyp` failed); `ssh2` is in `app.asar` | T16 |
| src/main/env/launcher.ts | created | The shared launcher and marker reader, moved unchanged from `wsl.ts` | T2 |
| src/main/env/poll-watch.ts | created | The polling watch, moved unchanged from `wsl.ts`, shared by WSL and SSH | T2 |
| src/main/env/wsl.ts | edited | Uses the shared modules (its exports unchanged); the connection part, `rediscover()`, and the share root read on each call | T2, T3 |
| src/main/env/types.ts | edited | `ConnectionState`, `ConnectionPart`, `Environment.connection` | T3 |
| src/main/env/local.ts | edited | Local connection part: always connected | T3 |
| src/main/projects/servers.ts | created | Saved SSH servers: validation, the file through the local files part, secrets in the secret store, pin rules, the corrupt-file set-aside | T4, T10 |
| src/main/env/ssh-command.ts | created | `shellQuote`, the exec-string builders, `crossingVariables`, `secretName` | T5, T10 |
| src/main/env/ssh-transport.ts | created | The `SshTransport` seam and the app transport over `ssh2` (the only importer of `ssh2`): shared client, pinned host key, credentials at connect, SFTP adapter, exec, `uname -s`, keepalive, no auto-reconnect; the stat bug found live is fixed | T6, T10, T14 |
| src/main/env/ssh.ts | created | The SSH backend: path, files, process, watch, git, connection, `createSshEnvironment` | T7–T9 |
| src/main/env/index.ts | edited | `environmentFor` builds SSH for a known server id; unknown or malformed ids are refused | T11 |
| src/main/projects/store.ts | edited | The SSH descriptor, the root checked through the environment, duplicates, load; the environment refusal text names SSH | T12 |
| src/main/projects/registry.ts | edited | Per-project state, cause-based refusals (revision 1), `stateOf`, `onStateChange`, `reconnect`, connect before an SSH add, the watcher closed on drop | T12 |
| src/main/index.ts | edited | The server store in app data, wired to `environmentFor` (no IPC) | T12 |
| tests/support/fake-wsl-transport.ts | edited | `rediscover()`, a settable share root, the reconnect command | T3 |
| tests/support/recording-env.ts | edited | Records the connection part | T3 |
| tests/support/posix-words.ts | created | Word splitter for the fake and the quoting tests | T5 |
| tests/support/fake-ssh-transport.ts | created | The fake SSH transport over a temp folder; exec parsed, never through a shell | T6–T9, T13 |
| tests/support/headless-walk.ts | edited | Optional `WalkFiles`, `files` and `environmentFor`; the unit walk's assertions are unchanged | T14 |
| tests/support/ssh-remote.ts | created | Test-only helpers for the live walk (system `ssh`, quoted words) | T14 |
| tests/unit/env-connection.test.ts | created | AC9 for local and WSL | T3 |
| tests/unit/ssh-servers.test.ts | created | AC1 | T4 |
| tests/unit/ssh-quote.test.ts | created | AC3, through the fake's parser and a real POSIX shell | T5 |
| tests/unit/env-ssh.test.ts | created | AC2, AC4–AC10, AC12 | T7–T11, T13 |
| tests/unit/project-store.test.ts | edited | AC11 store cases appended | T12 |
| tests/unit/project-registry.test.ts | edited | AC11 registry cases appended; lines 469-487 unchanged | T12 |
| tests/unit/env-recording.test.ts | edited | AC13 over the SSH backend | T13 |
| tests/unit/env-boundary.test.ts | edited | AC14 `ssh2` scan appended | T13 |
| tests/live/ssh-walk.live.test.ts | created | AC15, the live SSH walk | T14, T16 |
| CHANGELOG.md | edited | Unreleased Added: SSH projects (D43) | T15 |
| docs/decisions.md | edited | D43; notes under D41 and D42 | T15 |
| docs/environments.md | edited | The SSH section, the connection part, the unreachable states, the checklist status; round 1 added the note on the group kill before the marker | T15, R1-2 |
| docs/agent-commands.md | edited | The network limit over SSH | T15 |
| docs/workflow-engine.md | edited | Project states, the unreachable refusals, Reconnect | T15 |
| CLAUDE.md | edited | Read list D1–D43; `test:live` names the SSH walk and its variables | T15 |
| README.md | edited | Status, `test:live`, D1–D43 | T15 |
| docs/PRD.md | edited | F3 progress | T15 |
| docs/phases/phase-04-projects.md | edited | The SSH decision is marked D43 | T15 |
| docs/phases/phase-04-progress.md | edited | Row 4 (`in build`) and the follow-ups decided by D43 | T15 |

Workflow files (group 2):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| docs/specs/p4-env-ssh/PLAN.md | created | The approved plan | plan |
| docs/specs/p4-env-ssh/SPECS.md | created | The approved spec; revision 1 split the registry refusal by cause | plan, revision 1 |
| docs/specs/p4-env-ssh/SUBTASK.md | created | Child-ticket draft (no tracker) | plan |
| docs/specs/p4-env-ssh/tasks.md | created | T1–T16, all ticked; T12 carries the revision 1 note | plan, all |
| docs/specs/p4-env-ssh/build-ledger.md | created | The build ledger | build |
| docs/specs/p4-env-ssh/changes.md | created | The implementor's record of touched files | build |
| docs/specs/p4-env-ssh/SUMMARY.md | created | This report | build |

Git and `changes.md` agree. The one exception is `bash.exe.stackdump` in the repo root: an untracked crash dump that predates this feature, left out of the commit.

## Acceptance criteria

| AC | Status | Evidence |
| --- | --- | --- |
| AC1 saved servers | Met | `ssh-servers.test.ts` |
| AC2 host keys | Met | `env-ssh.test.ts` (`checkHostKey`); see the runtime check on ssh2 event order |
| AC3 quoter | Met | `ssh-quote.test.ts`, through the fake's parser and a real POSIX shell |
| AC4 path and files | Met | `env-ssh.test.ts`; the symlink case skips on Windows |
| AC5 process | Met | `env-ssh.test.ts`; the limit before the marker is documented (R1-2) |
| AC6 watch | Met | `env-ssh.test.ts`; the WSL tests pass unchanged |
| AC7 git | Met | `env-ssh.test.ts`; `git.test.ts` and `git-boundary.test.ts` unchanged |
| AC8 lost connection | Met | `env-ssh.test.ts` |
| AC9 connection part | Met | `env-connection.test.ts`, `env-ssh.test.ts` |
| AC10 environmentFor | Met | `env-ssh.test.ts` |
| AC11 store and registry | Met | `project-store.test.ts`, `project-registry.test.ts` (revision 1 split; lines 469-487 unchanged) |
| AC12 no credential leaks | Met | the credential scan in `env-ssh.test.ts`; the reviewer checked every exec string, log line, reason and payload |
| AC13 recording backend | Met | `env-recording.test.ts` over SSH |
| AC14 boundary | Met | `env-boundary.test.ts`: only `ssh-transport.ts` imports `ssh2`; no new `node:fs` importer |
| AC15 headless walk | Met | The live SSH walk passed (1 run, 144 s) against sshd in WSL Ubuntu on 127.0.0.1:2222, key auth; skipped without its variables |
| AC16 packaging | Met | `out/main` keeps `require("ssh2")`; `electron-builder --dir` passes with `ssh2` in `app.asar` (needed `npmRebuild: false`) |
| AC17 docs | Met | CHANGELOG, D43, environments, agent-commands, workflow-engine, CLAUDE.md, README, PRD, the phase doc, the progress file |
| AC18 checks | Met locally | typecheck, lint, format:check; `pnpm test` 1885 passed, 18 skipped; e2e 21 passed, 2 skipped; `git diff main -- tests/` changes no assertion. CI runs on the pull request |

## Needs a runtime check

- **Host key errors:** when the host verifier refuses a key, ssh2 must emit `error` before `close`. Otherwise an unpinned or changed key is reported as `unreachable` instead of `host-key-unknown` or `host-key-changed`. Only a live connect to an unpinned or changed host confirms this.
- **The group kill on other servers:** `kill -KILL -- -<pgid>` on macOS and on other Linux servers, beyond the one WSL Ubuntu sshd.
- **A stop before the marker arrives:** only the channel is closed, as the spec says, so a remote program can keep running. This limit is documented.
- **Password and agent auth:** the live walk used key auth only.

## Review ledger

### Revision 1, round 1 (ISSUES)

| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| R1-1 | minor | bash.exe.stackdump (repo root) | REJECT | The file predates the feature, and the implementor never touched it | None; kept out of the commit |
| R1-2 | minor (optional) | src/main/env/ssh.ts:598-608 | REJECT the code change; ACCEPT the limit as a doc note | The spec says "When the group id never arrived, only the channel is closed", and the code matches | A note on the limit in docs/environments.md |

The reviewer judged the listed deviations acceptable.

### Revision 1, round 2 (PASS)

No findings. Both decisions were accepted, and nothing else changed.

## Spec revisions

- **Revision 1** (paused at T12, before any review).
  - **Problem:** the spec gave `PROJECT_UNREACHABLE` to a project whose environment cannot be made. An existing registry test (`project-registry.test.ts:469-487`) asserts `no project with this id` for that case, and no assertion may change.
  - **Decision:** the user chose to split by cause. A made but unreachable project is refused with `PROJECT_UNREACHABLE`. A project whose environment cannot be made is listed and removable, but keeps `no project with this id`.
  - **Not taken:** changing the assertion; no entry at all.

## Rejected findings

- **R1-1:** the stray crash dump predates the work. You may delete `bash.exe.stackdump` yourself.
- **R1-2:** waiting for the marker before the kill would go beyond the spec. To change it, request changes, or plan it as a follow-up.

## Open issues

None. These deviations are for your review, and each is recorded in `changes.md`:
- **Packaging:** `electron-builder.yml` has `npmRebuild: false`, a file the spec did not list. It is needed because the optional native `cpu-features` does not build here.
- **pnpm:** `pnpm-workspace.yaml` has `allowBuilds` entries.
- **Interface additions:** `SshTransport.platform()`, `identity()` and `connectionId()`; `SshSftp.unlink`; `WslTransport.rediscover()`; `ServerStore.load()`; an optional `pollMs`. The WSL share root is now read on each call.
- **WSL detection:** a missing WSL distribution is recognised only in `reconnect()`.
- **Platform default:** `platform` is `linux` before the first connect.
- **Store reason:** the store's environment reason text names SSH.
- **Edits outside the rules:** one shell heredoc append to a test file, and one `rm` of the implementor's own debug file.

Leftovers from the live walk, on your machine:
- a throwaway `sshd` running without sudo in WSL Ubuntu on 127.0.0.1:2222;
- a test key line appended to `~/.ssh/authorized_keys` in WSL;
- the keys in `/tmp/sddssh/` in WSL;
- a key copy at `C:\Users\hoyen\AppData\Local\Temp\tmp.P5z4K0hBU7\walk-key`.

## Git state

feature/p4-env-ssh; approved; committed and pushed in the commit that adds this report.

## Next steps

Approve, commit and push; or request changes; or not yet.
