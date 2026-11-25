# Changes: p3-ship

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/main/git/git.ts | created | The git module: one private runGit through execFile with no shell, the fixed functions currentBranch, defaultBranch, changedPaths, stage, commit, push and aheadOfUpstream (D38), and ignoredEntries, the D31 read-only ls-files query moved here from protect.ts (revision 1). | T1, T6 (revision 1) |
| tests/unit/git.test.ts | created | Temp-repo tests for each git function, the rename and deletion cases, the stage refusals, push to a bare remote and to a missing remote, a folder that is not a repo, and ignoredEntries (ignored file and folder, and null outside a repo, revision 1). | T1 |
| src/main/commands/protect.ts | edited | gitIgnoredEntries now delegates to ignoredEntries in the git module, keeping its name and signature for the callers and the tests, and no longer imports node:child_process (revision 1, AC3). Its behaviour is unchanged. | T1 (revision 1) |
| src/main/workflow/ship.ts | created | The ship module: approveResult (commit message, Git state line, allowed set from changes.md, push retry, rollback that restores and re-stages) and markDone (CLOSE through transition(), SPECS status done, state file removed only when it names the feature, close commit and push, rollback). A missing SUMMARY or one with no Git state line refuses both actions (revision 1). | T2, T3 |
| tests/unit/ship.test.ts | created | Temp-repo tests for every AC1 refusal with an unchanged-state check, the commit and message cases, the push failure and retry, the failed-commit rollback with a clean index, the SUMMARY refusals for both actions (revision 1), and the mark-done refusals, close, closed detection, other-feature state in the close-retry path, failed close commit with a clean index, and the close push retry. | T2, T3 |
| src/main/human/ship-handlers.ts | created | createShipHandlers: the approve-result and mark-done handlers on the D33 channel, a fixed refusal for any error, and onLockChanged after every ship call, refused or not (revision 1). | T4 |
| src/main/index.ts | edited | startSpecLock imports createShipHandlers and registers approve-result and mark-done, with controllerNode read from buildControllers. | T4 |
| tests/unit/ship-handlers.test.ts | created | Handler refusals, the thrown-error refusal, the controller check, the lock refresh (after a success and after a refusal, revision 1), and the handlers reached through the channel with and without a gesture. | T4 |
| src/main/workflow/job-runner.ts | edited | JobRunnerOptions gets onRuleEvent; every gate decision is sent to it (allowed or denied), it is passed to makeToolRunner for the revert and network events, and a throwing callback is caught. | T5 |
| tests/unit/job-runner.test.ts | edited | Four AC6 tests: one allow event per allowed call with its target, a deny event with the tool not run, a throwing callback that does not fail the run, and no callback. | T5 |
| tests/unit/build-loop.test.ts | edited | Added a build-loop run on a temp git repo with a commit: the scripted git commit is denied, and the log, the index and the committed README's status are unchanged. | T6 |
| tests/unit/git-boundary.test.ts | created | Scans: only src/main/git/git.ts imports node:child_process to start a git program (protect.ts no longer does), no file under src/agent or src/shared names the git module, and no registry tool or job base tool is a git tool. | T6 (revision 1) |
| CHANGELOG.md | edited | Under [Unreleased]: the Git module, Ship and close, and Rule events under Added, as top-level bullets; the protect.ts move under Changed. | T7 |
| docs/decisions.md | edited | D38: the git module, approve-result and mark-done, commit and push by the app, close, the rule events, with outcome, why, alternatives and date. | T7 |
| docs/workflow-engine.md | edited | New "Ship and close" section; the Spec lock sentence on p3-ship now says mark-done removes the state file; the Build loop's "No git" paragraph points to approve-result; the code map and the Extending note are updated. | T7 |
| docs/human-actions.md | edited | The status line names the ship handlers (D38); the registration paragraph names them; the handler guidance no longer defers git to Phase 3; a new "The ship handlers" section. | T7 |
| CLAUDE.md | edited | D1–D38; the engine-reading line names the ship step (D38); the agents-never-run-git rule cites D38. | T7 |
| README.md | edited | The decisions range is D1–D38. The status line already says Phase 3 in progress and is correct. | T7 |
| docs/PRD.md | edited | F2's "Nothing is committed before the user approves the result" is ticked, with the D38 reference. | T7 |
| docs/workflow.md | edited | One sentence on the push retry after approval (D38). The rest of the page was checked and is accurate. | T7 |
| docs/phases/phase-03-workflow-engine.md | edited | Subtask 4 note: p3-ship (D38) and its link. | T7 |
| docs/phases/phase-03-progress.md | edited | D38 under Decisions added; the p3-build-loop rule-events follow-up marked resolved (its wiring part stays open); a "From p3-ship" follow-up block. Row 5 is left pending. | T7 |
| docs/specs/p3-ship/tasks.md | edited | Ticked T1 to T8 as each check passed (revision 1 re-checked T1 to T4 and T6). | T1 to T8 |
| docs/specs/p3-ship/changes.md | edited | This file: the rows for each pass, and the stale-doc check. | T1 to T8 |

## Stale-doc check (T7, AC8)

Checked against the AC8 list and the CLAUDE.md rule on docs:

- CHANGELOG.md: updated under [Unreleased], top-level bullets.
- docs/decisions.md: D38 added after D37.
- docs/workflow-engine.md: updated (see the row above).
- docs/human-actions.md: updated; the two handlers are described.
- CLAUDE.md: updated (D1–D38, the engine line, the D4 line).
- README.md: updated (the decisions range). The status line is still accurate.
- docs/PRD.md: F2's item ticked.
- docs/workflow.md: updated (one sentence). The rest was read against the code and is accurate.
- docs/phases/phase-03-workflow-engine.md: updated (subtask 4 note).
- docs/phases/phase-03-progress.md: updated (D38, follow-ups; row 5 left pending).
- docs/roadmap.md: not in the AC8 list. Its Phase 3 status ("in progress") is still true, so no change.
- docs/agent-commands.md: checked with a search for the ls-files query and protect.ts; it names neither, so no change.
- Closed features' records under docs/specs/ (for example p2-command-allowlist, which names protect.ts's git query): history, left as written.
