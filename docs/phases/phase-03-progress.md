# Phase 3 progress: Workflow engine (F2)

Status: in progress · Started: 2026-11-22

Remote: `origin` = https://github.com/leeray75/sdd-harness.git; feature branches come into `main` through pull requests, merged only when CI is green on every job. From `p3-state-machine` on, the user merges each pull request on GitHub themselves and says when it is done; Claude then fills in this file. No tracker is configured, so child tickets stay as `SUBTASK.md` drafts in `docs/specs/`.

The suggested subtask 2 (`p3-spec-docs-and-lock`) is split in two, because templates, folder reading, the state file, the hash lock and file watching are too much for one build. The user went ahead with `/sdd:start` on the recommended list. Every subtask's spec has a docs task and acceptance criterion (CHANGELOG, stale docs including `CLAUDE.md` and `README.md`, useful new docs), done in the build.

| #   | Feature          | Goal                                                                                                                                                                                            | Status  | Spec                                            | Commit                                                                  |
| --- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | p3-state-machine | Hand-written typed table of the plugin's states and events, stage mapping and labels, legal next events, event kinds and the human-action map                                                   | done    | [SUMMARY](../specs/p3-state-machine/SUMMARY.md) | `d261b51` (PR #20; work `b24f5c3`), close `63bb4b2` (PR #21; `9afaec9`) |
| 2   | p3-spec-docs     | Ported templates (PLAN, SPECS, tasks, SUBTASK), the `docs/specs/<feature>/` layout, and reading existing folders (and the ledger) to the right stage                                            | done    | [SUMMARY](../specs/p3-spec-docs/SUMMARY.md)     | `e5eda75` (PR #22; work `d05f094`, close `c94b250`)                     |
| 3   | p3-spec-lock     | Small state file in the repo, approved-spec hash, spec-changed detection by file watching, approve-spec and edit-approved-spec handlers                                                         | pending |                                                 |                                                                         |
| 4   | p3-build-loop    | Writer then reviewer rounds, round limit (3, project can lower), spec-problem pause, ask for changes counted separately, ledger, changes and SUMMARY; a minimal scripted provider for its tests | pending |                                                 |                                                                         |
| 5   | p3-ship          | Result approval, commit and push by the app with the commit format, close (mark-done handler)                                                                                                   | pending |                                                 |                                                                         |
| 6   | p3-headless-e2e  | Scripted fake provider and an end-to-end test of a full feature on a fixture repo, plus a real plugin `docs/specs` folder opening with the right stage                                          | pending |                                                 |                                                                         |

## Decisions added

- D34: the workflow table is hand-written in `src/shared/workflow.ts`, with the stage mapping, the data-agent overlay, the event kinds and the human-action map (`p3-state-machine`).
- D35: the document layer. The templates, folder layout, parsers and folder detector are pure shared modules, the scanner is in main, the plugin's session-marker and subagent inputs are dropped, and the approval is an input (`p3-spec-docs`).

## Decided during planning

- State machine: hand-written typed table, no XState (`p3-state-machine`).
- State file name and format: to decide in `p3-spec-lock`.

## Follow-ups

- From `p3-state-machine`:
  - The build paused once on a spec problem: AC4 fixed the label "Build, paused" and also forbade internal ids in labels. Revision 1 exempts `PAUSED_LABEL` from the id check and checks it by exact value.
  - The work came in as PR #20, and its `main` CI run (45033757830) is green. The close commit came in separately as PR #21. Its main CI run (45033938509) ended green.
  - `docs/roadmap.md` still lists Phase 3 as "not started". Set it to "in progress" with the progress link at the next roadmap edit (done in this commit).
  - `EVENT_KINDS` is a starting classification. `p3-spec-lock`, `p3-build-loop` and `p3-ship` may amend D34 when they wire events to handlers and agent results.
- From `p3-spec-docs`:
  - The slug pattern in `src/main/policy/context.ts` is looser than the shared `FEATURE_SLUG_PATTERN`. Unifying the two is a follow-up (PLAN, out of scope here).
  - The approval callback of `scanSpecFolders` is synchronous. `p3-spec-lock` may need an async form when it reads the state file.
  - The test for a file symlink is skipped where Windows refuses file symlinks (no developer mode). It runs on the Linux `check` job and in any environment that allows them; the directory junction case always runs.
  - `p3-spec-lock` supplies the approval that `detectFolder` takes as an input, and the current-feature choice that the plugin's "newest folder" rule made.
  - `scanSpecFolders` does not guard the caller's `approvalOf` callback, so one that throws rejects the scan (reviewer note, not a defect). `p3-spec-lock` can guard it where it supplies the callback.
  - The work and the close commit came in together as PR #22. Its `check` job is green (PR run 45036939521, main run 45036948955); the `e2e` jobs were still running when this row was written. PR #21's main run (45033938509) ended green.
- The sdd plugin's own templates in the separate `repos/claude` repo are not changed by this phase. A later change there could carry the docs item into the plugin's subtask briefs (out of this repo, raised in `p3-state-machine`).

## Phase summary

(written when the phase is done)
