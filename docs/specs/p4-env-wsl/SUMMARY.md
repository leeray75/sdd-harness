# Summary Report: p4-env-wsl

Ticket: none   Date: 2026-11-25
Outcome: Clean
Review rounds: 2 of 3 in revision 1 (0 in revision 0); revisions: 1 of 2
Models: implementor haiku; reviewer sonnet; data agent not used (all chosen by the user); respawns: none

## What was built

A WSL backend now implements the whole `Environment` interface for one distribution and a Linux root (G1, D42):
- **files:** `node:fs` on the `\\wsl.localhost` share, with the Linux-to-share mapping inside `src/main/env/wsl.ts`;
- **programs:** run through `wsl.exe` with a fixed launcher and a group kill, with variables crossing through `WSLENV`;
- **network:** a one-time `unshare` probe decides the level;
- **watching:** a polled watch;
- **git:** through `createGit` with a WSL launcher, so the argument lists and codes stay in `src/main/git/` (G4).

The rest:
- **Detection:** `detectWsl` is ready for the add wizard and runs only when called (G2).
- **Projects:** the store and registry accept `{ kind: 'wsl', distribution }`, and a Linux root is checked through its environment (G3).
- **Headless walk:** the walk moved to a shared helper. It passed 3 runs in a row on a project inside Ubuntu (G5).
- **Spec lock (revision 1):** its atomic write now uses the shared writer's rename retry, which fixed EPERM failures on the share and in the local parallel suite.
- **Docs:** updated, with D42 (G6).

## Files changed

Product files (group 1):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/main/git/git.ts | edited | `GitLauncher` and `createGit(launcher)`; the exported functions are the local instance over `execFile('git', …)`; argument lists, env, timeouts, parsing and codes unchanged | T1 |
| src/main/env/wsl-detect.ts | created | `detectWsl` and `isDistributionName`; UTF-16LE parsing; never throws; nothing at import | T2 |
| src/main/env/wsl.ts | created | The WSL backend: transport, share mapping, path, files (symlink and chmod as fixed commands), process (launcher, WSLENV, group kill, network probe), polled watch, git launcher, app transport, `createWslEnvironment` | T3–T6 |
| src/main/env/index.ts | edited | `environmentFor` builds WSL on win32; `WSL_UNAVAILABLE` elsewhere, `UNSUPPORTED_ENVIRONMENT` for a bad name; the local kind is unchanged | T7 |
| src/main/projects/store.ts | edited | The descriptor union, the WSL root check through the environment, duplicates by kind, distribution and root, load, the environment reason | T8 |
| src/main/projects/registry.ts | edited | Passes its environment to `store.add` and reuses it for the entry; the dev project stays local | T8 |
| src/main/tools/atomic-write.ts | edited | The opt-in `codeReason` option (the last Node code); the default result is unchanged | T9b |
| src/main/workflow/spec-lock.ts | edited | `writeAtomic` uses the shared writer with `codeReason`, with the same signature and reasons; comment fixed in round 1 | T9b, R1-1 |
| tests/support/fake-wsl-transport.ts | created | The fake transport over a temp share root; holds the real git-missing stderr text | T3–T6 |
| tests/unit/env-wsl.test.ts | created | AC2–AC7 cases (the symlink cases skip where symlinks are not allowed) | T3–T7 |
| tests/unit/wsl-detect.test.ts | created | AC1 cases | T2 |
| tests/unit/project-store.test.ts | edited | AC8 cases appended; existing cases unchanged | T8 |
| tests/unit/project-registry.test.ts | edited | AC8 cases appended; existing cases unchanged | T8 |
| tests/support/recording-env.ts | edited | `recordingEnvironment(base?)` wraps any backend; the default is still local | T9 |
| tests/unit/env-recording.test.ts | edited | AC9 cases over the WSL backend | T9 |
| tests/unit/env-boundary.test.ts | edited | AC10 `wsl.exe` scan appended | T9 |
| tests/unit/spec-lock.test.ts | edited | AC14 cases appended; only the node:fs import line changed | T9b |
| tests/support/headless-walk.ts | created | The walk body, moved with its assertions unchanged | T10 |
| tests/unit/headless-e2e.test.ts | edited | Calls the helper with the local setup | T10 |
| tests/live/wsl-walk.live.test.ts | created | The opt-in live WSL walk (AC11) | T10 |
| CHANGELOG.md | edited | Unreleased Added (the WSL backend, WSL projects, the live walk) and Fixed (the spec lock retry) | T11 |
| docs/decisions.md | edited | D42; notes under D41 | T11 |
| docs/environments.md | edited | The WSL section, the atomic write and its retry, the checklist met for WSL | T11 |
| docs/agent-commands.md | edited | The network limit on WSL | T11 |
| docs/workflow-engine.md | edited | Spec lock writes and retry; the WSL files; the live WSL walk | T11 |
| CLAUDE.md | edited | The read list names D42; `test:live` mentions the WSL walk | T11 |
| README.md | edited | The Phase 4 status | T11 |
| docs/PRD.md | edited | F3 progress | T11 |
| docs/phases/phase-04-projects.md | edited | Row 3 and what it delivers | T11 |
| docs/phases/phase-04-progress.md | edited | Row 3, D42, the follow-ups | T11 |

Workflow files (group 2):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| docs/specs/p4-env-wsl/PLAN.md | created | The approved plan | plan |
| docs/specs/p4-env-wsl/SPECS.md | created | The approved spec; revision 1 added the spec lock retry and AC14 | plan, revision 1 |
| docs/specs/p4-env-wsl/SUBTASK.md | created | Child-ticket draft (no tracker) | plan |
| docs/specs/p4-env-wsl/tasks.md | created | T1–T12 and T9b, all ticked | plan, all |
| docs/specs/p4-env-wsl/build-ledger.md | created | The build ledger | build |
| docs/specs/p4-env-wsl/changes.md | created | The implementor's record of touched files | build |
| docs/specs/p4-env-wsl/SUMMARY.md | created | This report | build |

Git and `changes.md` agree. The one exception is `bash.exe.stackdump` in the repo root: a Git Bash crash dump from this session, not part of the work, left out of the commit. You may delete it.

## Acceptance criteria

| AC | Status | Evidence |
| --- | --- | --- |
| AC1 detection | Met | `tests/unit/wsl-detect.test.ts` (15 tests) |
| AC2 path and files | Met | `tests/unit/env-wsl.test.ts`; the symlink cases skip on this machine (runtime check) |
| AC3 process | Met | `env-wsl.test.ts`: launcher argv, WSLENV, marker, group kill, network probe |
| AC4 watch | Met | `env-wsl.test.ts` |
| AC5 git | Met | `env-wsl.test.ts`; `git.test.ts` and `git-boundary.test.ts` unchanged and passing |
| AC6 no throw, no fallback | Met | `env-wsl.test.ts` with a dead transport |
| AC7 environmentFor | Met | `env-wsl.test.ts` with the platform and transport injected |
| AC8 store and registry | Met | `project-store.test.ts` and `project-registry.test.ts` (48 passed) |
| AC9 recording backend | Met | `env-recording.test.ts` over the WSL backend |
| AC10 boundary | Met | `env-boundary.test.ts`, with the `wsl.exe` scan |
| AC11 headless walk | Met | The unit walk passes through the helper; the live WSL walk passed 3 runs in a row (15.3 s, 16.1 s, 16.0 s) on Ubuntu, WSL 2, git 2.34.1 |
| AC12 docs | Met | CHANGELOG, D42, environments.md, agent-commands.md, workflow-engine.md, CLAUDE.md, README, PRD, the phase doc, the progress file |
| AC13 checks | Met locally | typecheck, lint, format:check; `pnpm test` in parallel 1774 passed, 17 skipped; e2e 21 passed, 2 skipped (macOS only). The only removed `expect` lines are the 63 walk lines, moved unchanged. CI runs on the pull request |
| AC14 spec lock retry | Met | `spec-lock.test.ts` AC14 cases; the parallel suite and the live walk pass |

## Needs a runtime check

- On a real WSL timeout, whether `kill -KILL -- -<pgid>` reaches the whole `setsid` group. The live walk did not hit a timeout.
- After a git stall in WSL, whether the Linux git process outlives the killed `wsl.exe`. This is a known limit: the spec's git argv does not go through the group launcher.
- The symlink cases of `env-wsl` and `spec-lock`, on a machine that allows symlinks.
- Real `wsl.exe` quoting of arguments that contain quotes, which the fake transport cannot show.

## Review ledger

### Revision 1, round 1 (ISSUES)

| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| R1-1 | minor (optional) | src/main/workflow/spec-lock.ts:130 | ACCEPT | The comment named `<file>.<random>.tmp`; the shared writer names it `.<file>.<random>.tmp` | Comment corrected |

The reviewer judged every deviation the implementor listed acceptable.

### Revision 1, round 2 (PASS)

No findings. R1-1 is verified as fixed.

## Spec revisions

- **Revision 1** (paused before any review).
  - **Problem:** a rename over an existing file on `\\wsl.localhost\Ubuntu` failed with EPERM about 7% of the time, and the spec lock's `writeAtomic` renamed only once. Because of that, the live WSL walk failed 4 of 6 runs, and the local parallel `pnpm test` failed 4 of 4.
  - **Decision:** the user chose to revise the spec, so that `writeAtomic` uses the shared `writeFileAtomic` and its rename retry, with its result and reasons unchanged (AC14).
  - **Not taken:** a retry in the WSL files part only; `mv -f` through `wsl.exe`; accepting a flaky walk.

## Rejected findings

None.

## Open issues

None. These deviations are for your review, and each is recorded in the progress file's follow-ups:
- **Watch:** subfolders are compared by name only.
- **Share paths:** a Linux path segment that contains `\` or `:` is refused with ENOENT.
- **chmod:** a failure gives ENOENT for a missing path, otherwise EIO.
- **Environment variables:** names that are not safe for WSLENV are dropped, and the WSLENV on `wsl.exe` holds only the crossing names.
- **Detection:** an empty list gives installed with no distributions.
- **Git timeout:** a timeout kills `wsl.exe` only.
- **Spec-lock temp files:** they now use the shared writer's names.
- **Edits outside the rules:** one `sed -i` edit on the fake transport, during the build.

## Git state

feature/p4-env-wsl; approved; committed and pushed in the commit that adds this report.

## Next steps

Approve, commit and push; or request changes; or not yet.
