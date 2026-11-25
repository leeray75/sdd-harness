# Ship a feature: approve the result, commit and push by the app, and mark it done

**Parent:** none: no parent chosen
**Spec:** docs/specs/p3-ship/SPECS.md
**Repo and base branch:** sdd-harness, main, feature branch feature/p3-ship

## Context

The app can lock a spec (D36) and run a build to `build-done` (D37), but it cannot finish a feature. `approve-result` and `mark-done` have no handler (D33). D4 says commit and push are done by the app, only after the result is approved. This work adds:

- **A typed git module** in main (`src/main/git/git.ts`). It runs the user's git CLI through `execFile`, with no shell, from the project root.
  - It has a fixed set of commands and fixed failure codes.
  - It runs with `GIT_TERMINAL_PROMPT=0` and a timeout, so credentials stay in the user's git setup.
  - git's output is never logged.
- **approve-result,** legal only at `build-done` with the lock approved, and not while a build is running.
  - It refuses a detached HEAD, the default branch, and unrelated changes in the tree.
  - It rewrites SUMMARY's Git state line, commits the files in `changes.md` plus the feature folder and the state file, and pushes the branch.
  - The message is `<ticket>: <summary>` or `<summary>`, from SUBTASK.md's title.
  - A push failure keeps the commit, and a second approval pushes only.
- **mark-done,** legal once the work is committed and pushed. It raises CLOSE through `transition()`, sets SPECS.md's status to `done`, removes the state file for this feature, and commits and pushes `Close <feature> spec`.
- **Rule events:** the job runner forwards the gate's Rule events to an `onRuleEvent` callback (D30).

No build controller is created at startup, and the workflow table is unchanged. The docs, with D38, are updated in the same change.

## Required work

- T1 Git module
- T2 Ship module, approve
- T3 Ship module, close
- T4 Handlers and wiring
- T5 Rule events
- T6 No git before approval
- T7 Docs
- T8 Full checks

## Acceptance criteria

- **AC1: approve-result only when legal.** It is reachable only through the D33 channel. It refuses with a fixed reason, and changes nothing:
  - off `build-done`;
  - without the lock approved for the feature;
  - while a controller is mid-build;
  - on a detached HEAD or the default branch;
  - with changes outside the allowed set.
- **AC2: Commit and push.** The Git state line is rewritten before the commit. Exactly the allowed changed paths are committed with the commit-format message, and the branch is pushed with its upstream set.
- **AC3: Nothing before approval.** The build loop and agent jobs make no commit. No agent tool is a git tool, and only `src/main/git/` runs git.
- **AC4: Push failure and retry.** A failed push keeps the commit and gives a fixed reason. A second approval pushes only. No URL, branch, message or git output appears in a reason or the log.
- **AC5: mark-done.**
  - It is refused before approval and before the push.
  - It then sets status `done`, removes this feature's state file, commits and pushes the close, and the folder detects as `closed`.
  - A failed close commit puts both files back.
- **AC6: Rule events.** Every gate decision of a build job reaches `onRuleEvent`, and a throwing callback does not fail the run.
- **AC7: Workflow events.** CLOSE goes through `transition()` from `build-done`, approve-result raises no event, and the table is unchanged.
- **AC8: Docs.** In the build on the feature branch:
  - the CHANGELOG entry;
  - D38;
  - a "Ship and close" section in `docs/workflow-engine.md`;
  - `docs/human-actions.md`;
  - stale docs checked and updated: `CLAUDE.md`, `README.md`, the PRD (the F2 "Nothing is committed before the user approves the result" item ticked), `workflow.md`, the phase-03 doc and the progress follow-ups, recorded in `changes.md`.
- **AC9: Checks.** typecheck, lint, format:check and test pass, with no network in the temp-repo tests. CI on the PR is green on every job before the merge.

## Out of scope

- The headless end-to-end test, and agent-process IPC (`p3-headless-e2e`).
- Pull requests, or any git-host API.
- Any UI, and a build start in the app.
- A commit format from project settings.
- Tracker writes (D8).
- Changing the plugin.
- `change-rules`.

## Links

- Plan: docs/specs/p3-ship/PLAN.md
- Spec and tasks: docs/specs/p3-ship/SPECS.md, docs/specs/p3-ship/tasks.md
