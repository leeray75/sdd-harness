---
status: approved
ticket:
---

# p3-ship

## Problem

The app can lock a spec (D36) and run a build to `build-done` (D37), but it cannot finish a feature. There is no handler for `approve-result` or `mark-done` (D33), so a request for either is answered `not-available`. Nothing commits the approved work, pushes the feature branch, or closes the feature.

D4 says commit and push are done by the app, only after the result is approved. PRD F2's "Nothing is committed before the user approves the result" is still unticked.

The job runner also checks every tool call but never logs the gate's Rule events (D30). The p3-build-loop follow-ups say this must be fixed before a build runs in the app.

## Goals

- **G1:** A typed git module in main runs the user's git CLI through `execFile`, with no shell, from the project root. It has a fixed set of commands and a fixed set of failure codes, and never logs or returns git's output.
- **G2:** `approve-result`, on the D33 channel, commits the feature's work with the commit-format message and pushes the feature branch. It does this only at `build-done` with the lock approved, never on the default branch or a detached HEAD, and never with unrelated changes in the tree. SUMMARY's Git state line is rewritten before the commit.
- **G3:** A push failure keeps the commit and gives a fixed reason. A second `approve-result` on committed work only pushes.
- **G4:** `mark-done`, on the D33 channel, moves `build-done` to `closed` through `transition()` (CLOSE). It works only once the work is committed and pushed. It sets SPECS.md's status to `done`, removes the state file when it names this feature, and commits and pushes the close.
- **G5:** Nothing is committed before `approve-result`. Agents have no git tool, and only `src/main/git/` runs git.
- **G6:** The job runner forwards every gate decision, and the tool runner's revert and network events, to an `onRuleEvent` callback, so build jobs' Rule events reach the log.
- **G7:** The docs are updated in the same change: D38, `docs/workflow-engine.md`, `docs/human-actions.md`, the CHANGELOG and the stale docs.

## Non-goals

- The headless end-to-end test on a fixture repo, and running jobs in the agent process (`p3-headless-e2e`).
- Opening a pull request, or any git-host API.
- Any UI, and a build start in the app. No build controller is created at startup.
- A commit format from project settings. The format is fixed.
- Tracker writes, including a comment on the child ticket (D8).
- Changing the sdd plugin's files.
- `change-rules`.
- A change to the workflow table. D34 is not amended.

## Design

### Git module (`src/main/git/git.ts`)

- **One private runner,** `runGit(root, args)`. It calls `execFile('git', args, { cwd: root, shell: false, windowsHide: true, timeout, maxBuffer, env })`.
  - `env` is the process environment with `GIT_TERMINAL_PROMPT=0` (and `GCM_INTERACTIVE=never`), so a missing credential fails rather than waits.
  - The timeout is 30 s for local commands and 120 s for a push.
  - It returns `{ ok: true, stdout } | { ok: false, code }`, where `code` is one of `git-missing` (ENOENT), `timeout`, `not-a-repo` or `failed`. stdout is parsed only by the module's own functions. stderr is dropped.
- **Exported functions,** each with its own fixed argument list:
  - `currentBranch(root)`: `{ branch } | { detached: true }`;
  - `defaultBranch(root)`: from `refs/remotes/origin/HEAD`, or `null` when it is unset;
  - `changedPaths(root)`: from `status --porcelain=v1 -z --untracked-files=all`. It gives repo-relative paths with forward slashes, both sides of a rename, and deletions;
  - `stage(root, paths)`: `add --all -- <paths>`, which also stages deletions;
  - `commit(root, message)`: `commit -m <message>`, with `--no-verify` never passed;
  - `push(root, branch)`: `push --set-upstream origin <branch>`. The branch must be a valid ref name: no `-` at the start and no space;
  - `aheadOfUpstream(root)`: `{ upstream: false } | { upstream: true, ahead: number }`, from local refs only (`rev-list --count @{u}..HEAD`);
  - `ignoredEntries(root, env?)` (revision 1): the read-only `ls-files -z --others --ignored --exclude-standard --directory` query that `src/main/commands/protect.ts` used to run itself (D31). It is moved here with the same arguments, the caller's environment and the same results, and `protect.ts` calls it, so its behaviour is unchanged.
- **Paths** passed to `stage` must be repo-relative, inside the root, with no `..` segment and not starting with `-`. They always follow `--`. A bad path makes `stage` refuse before git runs.
- **No other module imports `node:child_process` to run git,** `protect.ts` included (revision 1). No agent tool, job base tool or agent-process message reaches this module.

### Ship module (`src/main/workflow/ship.ts`)

- `approveResult(root, feature, options)` and `markDone(root, feature, options)`. Each returns `{ ok: true } | { ok: false, reason }`, with a reason from a fixed set that never echoes a path, a branch, a message or git's output. `options` has `controllerNode?: () => NodeId | null`, the node of the feature's build controller when one exists.
- **The node:** read the folder with `readSpecFolder`, and the approval from the lock (`readSpecState`, `hashSpec`, `approvalFor`). Then call `detectFolder`.
- **Commit message:**
  - the summary is SUBTASK.md's first `# ` heading, else SPECS.md's first `# ` heading, else the slug. It is flattened to one line, trimmed and capped at 72 characters;
  - the ticket is SPECS.md's `ticket:` value (`parseSpecs`);
  - the message is `<ticket>: <summary>` when the ticket is not empty, else `<summary>`;
  - the close message is `Close <feature> spec`.
- **The Git state line:** the line after `## Git state` in SUMMARY.md. approve-result replaces it with `Branch <branch>; approved; committed and pushed in the commit that adds this report.`. The work counts as "approved" when that line contains `approved; committed and pushed`. A missing SUMMARY.md, or one with no `## Git state` line, refuses both actions with a fixed reason (revision 1).
- **approveResult, in order,** stopping at the first refusal:
  1. A controller node that is not `build-done` refuses ("a build is still running").
  2. The node must be `build-done`, with the approval `approved`, or it refuses.
  3. The branch check: a detached HEAD, the default branch, or `main` or `master` when `origin/HEAD` is unset, refuses.
  4. **Already approved** (the Git state line says approved): this is the push retry, and it never commits.
     - with no upstream, or ahead > 0, it pushes;
     - with ahead 0, it refuses ("the work is already committed and pushed");
     - with changes in the tree, it refuses ("the work is approved but the tree has changes").
  5. **The allowed set:** every path in the `File` column of `changes.md`'s tables (backticks stripped, separators made `/`), every path under `docs/specs/<feature>/`, and `docs/specs/.sdd-state.json`. Any changed path outside the set refuses ("the tree has changes that are not part of this feature"), and nothing is written.
  6. Rewrite the Git state line (`writeAtomic`), stage the changed paths in the set, commit, then push.
     - If the stage or the commit fails, the Git state line is put back and the same paths are staged again, so the index matches the restored files. It refuses ("the commit failed"). The same applies to markDone's rollback (revision 1).
     - If the push fails, the commit is kept, and it refuses ("the push failed; the commit is kept. Approve the result again to retry the push").
- **markDone, in order:**
  1. The controller check and the node check, as in approveResult.
  2. The Git state line must say approved, or it refuses ("approve the result first").
  3. `changedPaths` must be empty, and the branch must have an upstream with ahead 0, or it refuses ("push the approved work first").
  4. The branch check.
  5. `transition('build-done', 'CLOSE')` must be ok.
  6. Set SPECS.md's status to `done` (`setFrontmatterStatus`, `writeAtomic`). Remove the state file when it names this feature. Stage those two paths, commit `Close <feature> spec`, and push.
     - If the commit fails, SPECS.md and the state file are put back.
     - If the push fails, the commit is kept, with the push-failed reason. A second `mark-done` on a closed feature with an unpushed close pushes only.
  7. The folder then detects as `closed`.

### Handlers (`src/main/human/ship-handlers.ts`)

- `createShipHandlers({ root, onLockChanged, controllerNode })` returns `approve-result` and `mark-done` handlers. They return the D33 result with `code: 'refused'` and the ship module's reason, never throw, and call `onLockChanged` after every ship call, refused or not, so the watcher re-reads the lock (revision 1).
- `index.ts` registers them in `startSpecLock`, next to the spec handlers, with `controllerNode` read from `buildControllers`.

### Rule events

- `JobRunnerOptions` gets `onRuleEvent?: (event: RuleEvent) => void`.
- The runner calls it with `checkToolCall`'s `event` for every call, allowed or denied. It passes it to `makeToolRunner`, which sends the revert and network events.
- A throwing callback is caught. The default is to do nothing, and index.ts passes `logRuleEvent(log)` when it builds a runner.

## Acceptance criteria

- **AC1: approve-result only when legal.** It is reachable only through the D33 channel, with its checks. It refuses with a fixed reason and changes nothing:
  - when the folder is not at `build-done` (for example implementing, paused or closed);
  - when the lock is not `approved` for this feature;
  - while the feature's controller is not at `build-done`;
  - on a detached HEAD, or on the default branch (`origin/HEAD`, or `main` and `master` when it is unset);
  - when the tree has a change outside the allowed set.
- **AC2: commit and push.**
  - At `build-done` with the lock approved, approve-result rewrites the Git state line, commits exactly the changed paths in the allowed set, and pushes the branch to origin with its upstream set.
  - The commit message is `<ticket>: <summary>` or `<summary>`, from SUBTASK.md's title, with the fallbacks.
  - The committed SUMMARY has the approved Git state line, and the bare remote has the commit.
- **AC3: nothing before approval.**
  - The build loop and every agent job make no commit. A build run on a temp repo leaves `git log` unchanged.
  - No tool or job base tool is a git tool, and a scripted `git commit` through `run_command` is denied.
  - Only `src/main/git/` imports `node:child_process` to run git, shown by a scan. The D31 `ls-files` query is moved there from `protect.ts`, and the existing protect tests pass unchanged (revision 1). No file under `src/agent/` names the git module.
- **AC4: push failure and retry.**
  - With an unreachable remote, approve-result refuses with the fixed push-failed reason, and the commit stays in `git log`.
  - Once the remote is reachable, a second approve-result pushes only, with no new commit.
  - No reason or log line contains the remote URL, a branch name, the commit message or git's output.
- **AC5: mark-done.**
  - mark-done is refused before the result is approved, and while the approved work is unpushed.
  - After a pushed approval, it sets SPECS.md's status to `done`, removes the state file when it names this feature, commits `Close <feature> spec` with only those two paths, and pushes. The folder then detects as `closed`.
  - The state file is removed only when it names this feature. A close retry on a closed feature whose state file names another feature leaves that file untouched and commits nothing (revision 1). Nothing else is committed.
  - A failed close commit puts SPECS.md and the state file back.
- **AC6: Rule events.** A job run through `createInProcessJobRunner` with `onRuleEvent` sends one decision event per tool call, allowed or denied, with the gate's sanitized target. A throwing callback does not fail the run.
- **AC7: workflow events.** CLOSE goes through `transition()` from `build-done`. approve-result raises no event. Any other node refuses, and the workflow table is unchanged.
- **AC8: docs.** In the build on the feature branch:
  - the CHANGELOG entry under [Unreleased], as top-level bullets;
  - D38 in `docs/decisions.md`;
  - a "Ship and close" section in `docs/workflow-engine.md`;
  - the two handlers in `docs/human-actions.md`;
  - stale docs checked and updated: `CLAUDE.md` (D1–D38), `README.md`, `docs/PRD.md` (F2's "Nothing is committed before the user approves the result" ticked), `docs/workflow.md`, `docs/phases/phase-03-workflow-engine.md` and the progress file's follow-ups. The check is recorded in `changes.md`.
- **AC9: checks.** `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test` pass. The temp-repo tests use no network. CI on the pull request is green on every job before the merge.

## Open questions

- 2026-11-24, revision 1, from the implement step at T6. AC3's scan failed on the existing read-only `git ls-files` in `src/main/commands/protect.ts` (D31). Decided: move that query into `src/main/git/git.ts` as `ignoredEntries`, with the same behaviour, so AC3 holds as written. Not taken: allowing that one query in the scan.
- 2026-11-24, revision 1: AC5's "a state file naming another feature is left alone" cannot happen at build-done, because the lock names this feature there. Decided: AC5 is reworded to the close-retry path that the implementor tested. Not taken: keeping the wording.
- 2026-11-24, revision 1: three of the implementor's decisions are recorded in the Design:
  - a missing SUMMARY, or one with no Git state line, refuses;
  - a failed commit puts the files back and stages them again;
  - `onLockChanged` runs after every ship call.

  Not taken: firing `onLockChanged` only after a change.
