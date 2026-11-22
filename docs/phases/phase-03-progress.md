# Phase 3 progress: Workflow engine (F2)

Status: in progress · Started: 2026-11-22

Remote: `origin` = https://github.com/leeray75/sdd-harness.git; feature branches come into `main` through pull requests, merged only when CI is green on every job. No tracker is configured, so child tickets stay as `SUBTASK.md` drafts in `docs/specs/`.

The suggested subtask 2 (`p3-spec-docs-and-lock`) is split in two, because templates, folder reading, the state file, the hash lock and file watching are too much for one build. The user went ahead with `/sdd:start` on the recommended list. Every subtask's spec has a docs task and acceptance criterion (CHANGELOG, stale docs including `CLAUDE.md` and `README.md`, useful new docs), done in the build.

| #   | Feature          | Goal                                                                                                                                                                                            | Status   | Spec | Commit |
| --- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---- | ------ |
| 1   | p3-state-machine | Hand-written typed table of the plugin's states and events, stage mapping and labels, legal next events, event kinds and the human-action map                                                   | planning |      |        |
| 2   | p3-spec-docs     | Ported templates (PLAN, SPECS, tasks, SUBTASK), the `docs/specs/<feature>/` layout, and reading existing folders (and the ledger) to the right stage                                            | pending  |      |        |
| 3   | p3-spec-lock     | Small state file in the repo, approved-spec hash, spec-changed detection by file watching, approve-spec and edit-approved-spec handlers                                                         | pending  |      |        |
| 4   | p3-build-loop    | Writer then reviewer rounds, round limit (3, project can lower), spec-problem pause, ask for changes counted separately, ledger, changes and SUMMARY; a minimal scripted provider for its tests | pending  |      |        |
| 5   | p3-ship          | Result approval, commit and push by the app with the commit format, close (mark-done handler)                                                                                                   | pending  |      |        |
| 6   | p3-headless-e2e  | Scripted fake provider and an end-to-end test of a full feature on a fixture repo, plus a real plugin `docs/specs` folder opening with the right stage                                          | pending  |      |        |

## Decisions added

- D34: the workflow table is hand-written in `src/shared/workflow.ts`, with the stage mapping, the data-agent overlay, the event kinds and the human-action map (`p3-state-machine`).

## Decided during planning

- State machine: hand-written typed table, no XState (`p3-state-machine`).
- State file name and format: to decide in `p3-spec-lock`.

## Follow-ups

- The sdd plugin's own templates in the separate `repos/claude` repo are not changed by this phase. A later change there could carry the docs item into the plugin's subtask briefs (out of this repo, raised in `p3-state-machine`).

## Phase summary

(written when the phase is done)
