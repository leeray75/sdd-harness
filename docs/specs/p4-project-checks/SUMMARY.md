# Summary Report: p4-project-checks

Ticket: none   Date: 2026-11-27
Outcome: Clean
Review rounds: 1 of 3 per revision; revisions: 0 of 2
Models: implementor haiku; reviewer sonnet; data agent not used (all chosen by the user); respawns: none

## What was built

`runProjectChecks(env, root)` in `src/main/projects/checks.ts` returns the five checks that the add wizard and the projects screen show: Git repository, Code host, Tracker, Test command and Earlier specs. They run through the project's environment, so the same code serves this computer, WSL, SSH and a dev container. Each check runs in its own guard, so one that throws gives a fixed failure while the others still return; the runner never rejects (G1). The result type and the pure helpers (`parseOrigin`, `codeHostOf`, `inferTracker`) are in `src/shared/project-checks.ts`, with the five statuses `ok`, `warn`, `info`, `fail` and `not-checked` (G2). Every backend's git part gains `originUrl`, and a code host result keeps only the host's name, never the URL, a user or a token (G3). An unreachable environment runs nothing, and every check is `not-checked`; nothing reconnects (G4). The rules are recorded as D45 and in a "Project checks" section of `docs/environments.md` (G5).

## Files changed

Product files (group 1):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/main/git/git.ts | edited | `originUrl(root)` in the `Git` interface and `createGit`; an empty value is null. `NOT_A_REPO` is widened to git's `--local` message | T1 |
| src/main/env/types.ts | edited | `originUrl` on `GitPart` | T1 |
| src/main/env/local.ts | edited | The local git part maps `originUrl` | T1 |
| tests/unit/git.test.ts | edited | `originUrl` tests: origin set, origin unset (null), outside a repository (`not-a-repo`) | T1 |
| src/shared/project-checks.ts | created | The ids, statuses and result types; `parseOrigin`, `codeHostOf` and `inferTracker`; no Node import | T2 |
| src/main/projects/checks.ts | created | The runner: the unreachable shortcut, the per-check guards, a state read before each check, and the five checks with the spec's texts | T3 |
| tests/unit/project-checks.test.ts | created | 55 tests: the helpers, each check's statuses, credential absence for every URL with a user or token, the fixed failures, unreachable, a mid-run state change, and the call counts | T4 |
| docs/decisions.md | edited | D45 · Project checks | T5 |
| docs/environments.md | edited | `originUrl` in the git part's list of calls, and a "Project checks (D45)" section | T5 |
| CHANGELOG.md | edited | `[Unreleased]` Added entry | T5 |
| docs/PRD.md | edited | The F3 "Built so far" sentence | T5 |
| CLAUDE.md | edited | Reading list: D1–D45, and the checks in item 6 | T5 |
| README.md | edited | The status line names this subtask; the decisions row now reads D1–D45 (it read D1–D43, already stale) | T5 |
| docs/phases/phase-04-progress.md | edited | A D45 bullet in Decisions added, and follow-ups for rows 7 and 8 | T5 |

Workflow files (group 2):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| docs/specs/p4-project-checks/PLAN.md | created | The approved plan | plan |
| docs/specs/p4-project-checks/SPECS.md | created | The approved spec | plan |
| docs/specs/p4-project-checks/SUBTASK.md | created | Child-ticket draft (no tracker) | plan |
| docs/specs/p4-project-checks/tasks.md | created | T1–T6, all ticked | plan, all |
| docs/specs/p4-project-checks/build-ledger.md | created | The build ledger | build |
| docs/specs/p4-project-checks/changes.md | created | The implementor's record | build |
| docs/specs/p4-project-checks/SUMMARY.md | created | This report | build |

Git and `changes.md` agree. `bash.exe.stackdump` is untracked, predates the work, and is left out of the commit.

## Acceptance criteria

| AC | Status | Evidence |
| --- | --- | --- |
| AC1 result type | Met | `src/shared/project-checks.ts` exports the ids, statuses, types and helpers, with no Node import. The runner always returns five checks, in order (tests) |
| AC2 originUrl | Met | `Git`, `createGit`, `GitPart` and the local mapping; tests cover set, unset and outside a repository. Typecheck passes; no other fake implements `GitPart` (the reviewer's grep) |
| AC3 git check | Met | Tests: clean, n changed and one changed file, detached, not-a-repo, git-missing and timeout |
| AC4 code host and credentials | Met | Tests cover every URL form, the named hosts and Other, no origin, an unreadable origin, and not-checked after a git failure. The credential-absence assertions check every field for every URL with a user or token; the reviewer traced each result string back to a fixed text or the host name |
| AC5 tracker | Met | Tests: Jira from ticket ids, GitHub Issues and GitLab Issues, null; always `warn`, "Not connected" |
| AC6 test command and earlier specs | Met | Tests: found (with its form and the marker), none (`warn`), specs found (with the count, singular for one), none yet |
| AC7 robustness | Met | Tests: a throwing call gives a fixed `fail` while the others return; unreachable gives five `not-checked` with no call (recorded); a mid-run change turns the remaining checks `not-checked` |
| AC8 boundary | Met | `checks.ts` has no `node:*` import; `env-boundary.test.ts` passes; no reconnect, network or sign-in call |
| AC9 docs | Met | D45, the environments.md section, CHANGELOG, PRD F3, CLAUDE.md, README and the progress follow-ups. The phase doc and `workflow.md` were checked and needed no change |
| AC10 checks | Met locally; CI pending | Re-run by the orchestrator after the review: typecheck, lint and format:check pass; `pnpm test` 94 files, 2026 passed, 69 skipped. The pull request's CI is checked after the push |

## Needs a runtime check

- `git config --local --default '' --get` needs git 2.18 or later on each backend (the default distribution, the SSH server, the container image). An older git gives `failed`, which shows as the `warn` "The origin remote could not be read".
- `parseOrigin` reads the non-standard text `user:pass@host:path` (no scheme) as host `user`, as git does. This is not a real remote form, so it is not raised as a defect.
- The reviewer did not read the doc diffs. The orchestrator checked the CHANGELOG, D45, README, PRD, CLAUDE.md and progress changes against the spec.

## Review ledger

### Revision 0, round 1 (PASS)

No findings. The reviewer confirmed the implementor's interpretations:

- the detached head detail is `Detached HEAD · clean` (or `· N changed files`);
- a git timeout or failure has no fix text;
- a `state()` call that throws counts as unreachable;
- the outer catch gives five fixed failures;
- no `GitPart` fake needed an update.

## Spec revisions

None.

## Rejected findings

None.

## Open issues

None.

## Git state

feature/p4-project-checks; approved; committed and pushed in the commit that adds this report.

## Next steps

Approve, commit and push. Then open the pull request and merge it when every CI job is green.
