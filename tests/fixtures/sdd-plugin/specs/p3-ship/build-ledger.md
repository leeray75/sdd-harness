# Build ledger: p3-ship

state: done
revision: 1
resume on approve: no
current round: 1 of 3, in revision 1
phase: reviewing
Implementor: a1b4bea391130286b, haiku    Reviewer: a903a14bc3a6c4b22, sonnet
Data agent: none yet
Models: chosen by the user at the start of the build; reused on resume, not asked again.
Respawns: none

## Implementation, revision 0 (Mode 1)

- Done: T1–T5, each check passed and ticked. T6 is partial: the agent-side scans and the temp-repo build-loop test pass, and the `child_process` clause is the spec problem below. T7 and T8 have not started, because the build stops on a spec gap.
- Checks:
  - git 22, ship 33 (about 90 s), ship-handlers with human-channel 33, job-runner 14, and git-boundary with build-loop 36, all passing.
  - typecheck, lint and format:check pass.
  - One full `pnpm test`: 1555 passed, 15 skipped and 1 failed. The failure is `tool-files.test.ts`, "list_files caps at exactly 1,000 entries", a 5 s timeout under load. That test is unrelated to this work and passes alone in 3.8 s.
- Concerns reported:
  - A process slip: a Bash heredoc and a no-op `sed -i` on `job-runner.test.ts`.
  - Prettier rewrote six files.
  - The `git-missing` and `timeout` branches are untested.
- Decisions the implementor took, noted as not blocking:
  - **AC5 "a state file naming another feature":** at build-done the lock always names this feature, so the case is tested through the closed-retry path instead.
  - **A missing SUMMARY,** or one with no Git state line, refuses with a fixed reason.
  - **Nothing passes `onRuleEvent` yet,** because no runner is built in index.ts.
  - **After a failed commit,** the restored files are staged again.
  - **`onLockChanged`** is called after every ship call.

## Implementation, revision 1 (Mode 3)

- Done: T1–T8, all ticked.
  - `ignoredEntries` is moved into `git.ts`, and `protect.ts` delegates to it and no longer imports `child_process`.
  - The AC5 retry test is confirmed.
  - The recorded Design items are tested. `markDone` now refuses a missing SUMMARY with the summary reason; before this pass it gave the approve-first reason.
  - The docs (T7) are done, with D38.
- Checks: the revised T1 set gave 86 passed and 2 skipped. The T2–T6 set gave 130 passed. typecheck, lint and format:check pass. `pnpm test` gave 75 files, 1562 passed, 15 skipped and 0 failed.
- Concerns reported:
  - In this pass, file changes were made with Edit and Write only, plus Prettier.
  - No job runner is built in the app yet, so `logRuleEvent` is not passed anywhere.
  - A close-push retry does not check that the last commit is the close commit.
  - The handlers are registered only with `HARNESS_SPIKE_ROOT` set.

## Revision 1, round 1 (PASS)

| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| ------- | -------- | -------- | -------------------- | --------- | ------ |
| (none)  |          |          |                      |           |        |

The reviewer checked:

- injection in `git.ts`: no shell, paths after `--` with `GIT_LITERAL_PATHSPECS`, the message as one argument, and branch names validated;
- that no reason echoes a value (only the fixed `SHIP_REASONS`);
- the order of the checks against the Design;
- the allowed set, including the `-z` rename parsing;
- the rollbacks;
- that `protect.ts` behaviour is unchanged;
- the handlers and `index.ts`;
- the job runner's `emit`;
- the scope against `changes.md`;
- the docs (AC8).

Runtime-check notes, which are not defects:

- A close retry pushes any unpushed commit without checking that it is the close commit.
- In a repo that gitignores `docs/specs/.sdd-state.json`, staging the removed untracked path may fail, and the close would roll back.
- `logRuleEvent` is not wired in the app until a runner is built.

After the PASS, the orchestrator re-ran the checks. typecheck, lint and format:check pass, and `pnpm test` gave 75 files, 1562 passed and 15 skipped, in 88 s. Git and `changes.md` agree.

## Spec problems

- Revision 0 pause, from the implement step (T6). The spec says: AC3, "Only `src/main/git/` imports `node:child_process` to run git, shown by a scan"; and the Design, "No other module imports `node:child_process` to run git". But `src/main/commands/protect.ts` (lines 7 and 141–143, from D31) already runs a read-only `git ls-files` through `execFile`, so the scan fails as written. The candidates are:
  1. allow exactly that query in the spec and the scan;
  2. move the query into `src/main/git/git.ts`, with the same behaviour;
  3. leave the scan red.

  User chose: **Revise the spec**. Revision 1 decisions: move the query into `git.ts` as `ignoredEntries` (AC3 as written); reword AC5 to the close-retry path; record three implementor decisions in the Design (a missing SUMMARY or Git state line refuses; a failed commit puts files back and stages them again; `onLockChanged` after every ship call). `SPECS.md` and `tasks.md` revised; T1–T4 and T6 unticked.

## Carried findings

none (a Mode 1 pause carries none)
