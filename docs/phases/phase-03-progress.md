# Phase 3 progress: Workflow engine (F2)

Status: in progress · Started: 2026-11-22

Remote: `origin` = https://github.com/leeray75/sdd-harness.git; feature branches come into `main` through pull requests, merged only when CI is green on every job. From `p3-state-machine` on, the user merges each pull request on GitHub themselves and says when it is done; Claude then fills in this file. No tracker is configured, so child tickets stay as `SUBTASK.md` drafts in `docs/specs/`.

The suggested subtask 2 (`p3-spec-docs-and-lock`) is split in two, because templates, folder reading, the state file, the hash lock and file watching are too much for one build. The user went ahead with `/sdd:start` on the recommended list. Every subtask's spec has a docs task and acceptance criterion (CHANGELOG, stale docs including `CLAUDE.md` and `README.md`, useful new docs), done in the build.

| #   | Feature          | Goal                                                                                                                                                                                            | Status  | Spec                                            | Commit                                                                  |
| --- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | p3-state-machine | Hand-written typed table of the plugin's states and events, stage mapping and labels, legal next events, event kinds and the human-action map                                                   | done    | [SUMMARY](../specs/p3-state-machine/SUMMARY.md) | `d261b51` (PR #20; work `b24f5c3`), close `63bb4b2` (PR #21; `9afaec9`) |
| 2   | p3-spec-docs     | Ported templates (PLAN, SPECS, tasks, SUBTASK), the `docs/specs/<feature>/` layout, and reading existing folders (and the ledger) to the right stage                                            | done    | [SUMMARY](../specs/p3-spec-docs/SUMMARY.md)     | `e5eda75` (PR #22; work `d05f094`, close `c94b250`)                     |
| 3   | p3-spec-lock     | Small state file in the repo, approved-spec hash, spec-changed detection by file watching, approve-spec and edit-approved-spec handlers                                                         | done    | [SUMMARY](../specs/p3-spec-lock/SUMMARY.md)     | `60b9f41` (PR #23; work `1f1ea98`, close `1ae8d3b`)                     |
| 4   | p3-build-loop    | Writer then reviewer rounds, round limit (3, project can lower), spec-problem pause, ask for changes counted separately, ledger, changes and SUMMARY; a minimal scripted provider for its tests | done    | [SUMMARY](../specs/p3-build-loop/SUMMARY.md)    | `12918ce` (PR #24; work `8b7c024`, close `0b13ee5`)                     |
| 5   | p3-ship          | Result approval, commit and push by the app with the commit format, close (mark-done handler)                                                                                                   | done    | [SUMMARY](../specs/p3-ship/SUMMARY.md)          | `cd4c796` (PR #25; work `c580d56`, close `59158f2`)                     |
| 6   | p3-headless-e2e  | Scripted fake provider and an end-to-end test of a full feature on a fixture repo, plus a real plugin `docs/specs` folder opening with the right stage                                          | pending |                                                 |                                                                         |

## Decisions added

- D34: the workflow table is hand-written in `src/shared/workflow.ts`, with the stage mapping, the data-agent overlay, the event kinds and the human-action map (`p3-state-machine`).
- D35: the document layer. The templates, folder layout, parsers and folder detector are pure shared modules, the scanner is in main, the plugin's session-marker and subagent inputs are dropped, and the approval is an input (`p3-spec-docs`).
- D36: the spec lock. The state file, the hash input, the approval values, the watcher, the two handlers, the `refused` code and the gate's spec state. It amends D34 (`EDIT_SPEC` may come from `edit-approved-spec`) (`p3-spec-lock`).
- D37: the build loop. The controller in main, the injected job runner with its turn caps, the round limit option, the pause choices with no revision cap, the change rounds, the two documents and the writer's own spec files. It amends D30 (the gate) and D34 (`CONTINUE` and `STOP_BUILD`, and `END_BUILD` from revision 1) (`p3-build-loop`).
- D38: the ship step. The git module is the only code that runs git, with the D31 `ls-files` query moved into it. `approve-result` commits the approved work and pushes the branch, `mark-done` closes the feature, and each has its checks, its fixed reasons and its rollbacks. The job runner reports every rule event. It amends nothing (`p3-ship`).
- D39: where build jobs run. They run in the main process for v1, through `createInProcessJobRunner`; the agent utility process keeps the spike loop, and no IPC message is added. The app builds runners only through `createAppJobRunner`, which logs every rule event. It amends nothing (`p3-headless-e2e`).

## Decided during planning

- State machine: hand-written typed table, no XState (`p3-state-machine`).
- State file name and format: decided in `p3-spec-lock` (D36). The file is `docs/specs/.sdd-state.json`.

## Follow-ups

- From `p3-state-machine`:
  - The build paused once on a spec problem: AC4 fixed the label "Build, paused" and also forbade internal ids in labels. Revision 1 exempts `PAUSED_LABEL` from the id check and checks it by exact value.
  - The work came in as PR #20, and its `main` CI run (45033757830) is green. The close commit came in separately as PR #21. Its main CI run (45033938509) ended green.
  - `docs/roadmap.md` still lists Phase 3 as "not started". Set it to "in progress" with the progress link at the next roadmap edit (done in this commit).
  - `EVENT_KINDS` is a starting classification. `p3-spec-lock`, `p3-build-loop` and `p3-ship` may amend D34 when they wire events to handlers and agent results.
- From `p3-spec-docs`:
  - Resolved in `p3-spec-lock`: `src/main/policy/context.ts` uses the shared `FEATURE_SLUG_PATTERN` and length, and the local pattern is gone.
  - Resolved in `p3-spec-lock`: the approval callback of `scanSpecFolders` stays synchronous. The lock is read, and the locked spec hashed, before the scan.
  - The test for a file symlink is skipped where Windows refuses file symlinks (no developer mode). It runs on the Linux `check` job and in any environment that allows them; the directory junction case always runs.
  - Done in `p3-spec-lock` (D36): it supplies the approval that `detectFolder` takes as an input, and the current-feature choice, which follows the state file and falls back to the newest folder.
  - Resolved in `p3-spec-lock`: `scanSpecFolders` guards its `approvalOf` callback, and a throwing one reads its folder as `unchecked`.
  - The work and the close commit came in together as PR #22. Its `check` job is green (PR run 45036939521, main run 45036948955); both runs later ended green on every job, including `e2e` on all three systems. PR #21's main run (45033938509) ended green.
- From `p3-spec-lock`:
  - The agent gate reads the watcher's last value through `current()`. A missed watch event leaves that value stale until the next event or refresh. Each refresh re-hashes, so this is bounded but not zero. Decide in the pilot whether the gate should refresh before each call.
  - An unreadable state file makes every folder `unchecked`, and `approve-spec` replaces that file when a person approves a spec.
  - Nothing raises `EDIT_SPEC` yet. `edit-approved-spec` sets `editing`, and `p3-build-loop` connects the event (D34, amended by D36).
  - `tests/e2e/human-action.spec.ts` expects `not-available` for `approve-spec`. It passes because the e2e launch sets no `HARNESS_SPIKE_ROOT`, so the spec handlers are not registered. A run with a root set would need those expectations changed.
  - The lock's file-symlink tests skip where Windows refuses file symlinks, as the `p3-spec-docs` test does.
  - The work and the close commit came in together as PR #23. The PR run (45040898895) was green on `check` and on `e2e` for Linux and Windows. macOS `e2e` and the main run (45040909398) were still running when this row was written. Both later ended green on every job.
  - Review round 1 passed with no findings. After it, the orchestrator found the CHANGELOG entry inside the Document layer bullet's sub-list. It was fixed in a user-requested change round (U1).
- From `p3-build-loop`:
  - No controller is created at startup, and no UI or IPC starts a build yet. `index.ts` only passes the `edit-approved-spec` hook, which allows the edit while no controller exists, so the app's behaviour is unchanged until a build start is wired (`p3-ship` or the pilot).
  - The jobs run in the main process through `createInProcessJobRunner`. Resolved in `p3-headless-e2e` (D39): they stay in main for v1, and no IPC is added. Moving them to the agent process is a later decision, if a need shows.
  - The job runner does not forward the gate's rule events to the log yet, though D30 asks for every decision to be logged. Wire it before any build runs in the app. Resolved in `p3-ship` (D38): the runner sends every decision, and the revert and network events, to `onRuleEvent`. Resolved in `p3-headless-e2e` (D39): `createAppJobRunner` passes `logRuleEvent(log)` to every runner the app builds. `index.ts` calls the factory only when the first build start lands.
  - Settled in revision 1 (D37): a failed step, and a continue with nothing left to run, end the build with END_BUILD and the outcome Open issues remain. The node, the ledger and SUMMARY then agree. No IMPLEMENTED is raised without a writer step.
  - Settled in revision 1 (D37): a change round's label is `U<k>` in the prompts and in the reviewer's heading, and `parseReview` returns it as the string `U<k>`. The counter is not changed.
  - Check in the pilot: a continue whose review pause had no findings to fix ends the build, so the user cannot ask the writer again on that review. Decide whether a later phase should offer a retry.
  - The build paused after the implement step on five gaps that the implementor reported as NEEDS-SPEC-CHANGE. The user chose to revise the spec (revision 1), and the decisions are in SPECS.md's Open questions. Review round 1 of revision 1 then passed with no findings.
  - After the PASS, two older tests (`policy-acceptance.test.ts`, `spec-folders.test.ts`) timed out at 5 s under full parallel load on 2 of 4 runs. A user-requested change round (U1) gave them a 20 s per-test timeout. The next 3 runs and CI `check` were green.
  - Pilot notes from the reviewer:
    - A change round that pauses or fails before its review reuses its `U<k>` label on the next request.
    - A continued Mode 3 adds a second Mode 3 entry to the ledger.
    - The report parsers have only been tested on scripted turns.
  - The work and the close commit came in together as PR #24. The PR run (45308324409) and the main run (45308344079) were green on `check`. The three `e2e` jobs of both runs were still running when this row was written. Both later ended green on every job.
- From `p3-ship`:
  - No job runner is built in the app yet, so `index.ts` passes no `logRuleEvent(log)`. The runner's default does nothing. Resolved in `p3-headless-e2e` (D39) as far as this phase goes: `createAppJobRunner` wires the log, and the build start (or the pilot) must call that factory.
  - `approve-result` and `mark-done` are registered when a project root is set (`HARNESS_SPIKE_ROOT`), like the spec handlers. Without a root they answer `not-available`.
  - A closed feature whose close is unpushed is retried by pushing alone. Nothing checks that its last commit is the close commit, because the git module has no log function. Decide in the pilot whether that check is needed.
  - `approve-result` rejects a SUMMARY with no Git state line and a missing SUMMARY. A user who wants a feature shipped without a build report has no path yet.
  - The 1,000-entry `list_files` test in `tests/unit/tool-files.test.ts` timed out at 5 s once in the full run of `p3-ship`. It passes alone (about 4 s). Give it an explicit timeout if it fails again under load.
  - The build paused at T6 on a spec problem. AC3's scan failed on the existing read-only `git ls-files` in `protect.ts` (D31). The user chose to revise the spec (revision 1):
    - the query moved into `git.ts` as `ignoredEntries`;
    - AC5 was reworded to the close-retry path;
    - three of the implementor's decisions were recorded in the Design.

    Review round 1 of revision 1 then passed with no findings.

  - Reviewer notes for the pilot: in a project that gitignores `docs/specs/.sdd-state.json`, staging the removed state file at close may fail, and the close would roll back.
  - The work and the close commit came in together as PR #25. It was merged while the PR run (45525735416) and the main run (45525749555) were still running, `check` included. Check both runs before the next merge.
- From `p3-headless-e2e`:
  - The walk shows that `edit-approved-spec` is refused at spec-changed, because `EDIT_SPEC` is legal only from spec-approved. The spec (revision 1) accepts this: the walk asserts the refusal, edits SPECS.md directly and re-approves. A later phase may want the channel to allow a revision edit; that would be a workflow-table change under D34.
  - While a build is paused for revision, the folder still detects as `paused` until the build resumes, because the ledger keeps its pause. The controller reads `spec-changed` at the same time.
  - The fixture check uses SHA-256 values recorded in the test, since CI's checkout is shallow and has no `c580d56`. A new plugin folder needs its own recorded values.
  - The `p3-ship` SUMMARY fixture was written by the orchestrator, because the implementor's file tool refused a report-named file.
  - `app-runner.ts` is not called by `index.ts` yet (no build start in the app), so the Rule-event log is wired in the factory only.
- The sdd plugin's own templates in the separate `repos/claude` repo are not changed by this phase. A later change there could carry the docs item into the plugin's subtask briefs (out of this repo, raised in `p3-state-machine`).

## Phase summary

(written when the phase is done)
