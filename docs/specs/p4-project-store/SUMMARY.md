# Summary Report: p4-project-store

Ticket: none Date: 2026-11-25
Outcome: Clean
Review rounds: 1 of 3 per revision; revisions: 0 of 2
Models: implementor haiku; reviewer sonnet; data agent not used (all chosen by the user); respawns: none

## What was built

The app now keeps projects in `projects.json` in app data. Add, list, get, rename, set rules and remove are each saved atomically. Remove never touches the project's folder, and a corrupt file is set aside, so the app starts with no projects (G1, G5).

Each project has validated rules: round limit 1–3, a model-policy value, and a commit format with `{summary}` and an optional `{ticket}`. Spec approval and review cannot be switched off. The round limit reaches the build controller's options, and the commit format makes the `approve-result` commit message. With no ticket, that message is the summary alone (G2, G3).

A human-only request is now exactly `{ action, project, feature }`, which amends D33. A new registry runs one spec-lock watcher and the four handlers per project, and refuses an unknown project (G4). `HARNESS_SPIKE_ROOT` gives an in-memory `dev` project in unpackaged runs only (G6). D40 records the design, and the docs are updated (G7).

## Files changed

Product files (group 1):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/shared/project-rules.ts | created | Rules model: `ProjectRules`, `DEFAULT_RULES`, `checkRoundLimit`, `parseRules`, `hasLineBreak`, `formatCommitMessage`, fixed reasons | T1 |
| src/main/workflow/build-loop.ts | edited | `roundLimit` calls `checkRoundLimit`, same results | T1 |
| tests/unit/project-rules.test.ts | created | Every AC3 case, defaults, round limit, `formatCommitMessage` | T1 |
| src/main/projects/store.ts | created | Project store: load with set-aside, list, get, add, rename, setRules, remove, atomic save, add checks | T2 |
| tests/unit/project-store.test.ts | created | AC1, AC2 (folder hash around remove), AC6, failed save | T2 |
| src/shared/human-actions.ts | edited | Request gains `project` (`dev` or lowercase UUID); exact three keys; `DEV_PROJECT_ID`, `PROJECT_ID_PATTERN`, `isProjectId` | T3 |
| src/main/human/channel.ts | edited | Decision line adds `project=<id>` | T3 |
| tests/unit/human-actions.test.ts | edited | Requests carry project; missing project, extra key, bad id cases | T3 |
| tests/unit/human-channel.test.ts | edited | Requests carry project; log lines expect `project=` | T3 |
| tests/unit/spec-handlers.test.ts | edited | Requests carry project; log line expects `project=` | T3 |
| tests/unit/ship-handlers.test.ts | edited | Requests carry project; log line expects `project=` | T3 |
| tests/unit/headless-e2e.test.ts | edited | The `human()` helper sends project `dev` | T3 |
| tests/unit/bridge.test.ts | edited | Bridge request carries project | T3 |
| tests/e2e/human-action.spec.ts | edited | Sends project `dev`; with no projects the request is refused, so (c), (d), (e) expect `refused` | T3, T6 |
| src/main/workflow/ship.ts | edited | `formatCommitMessage` replaces `commitMessage`; options gain `commitFormat` | T4 |
| src/main/human/ship-handlers.ts | edited | `ShipHandlersDeps` gains `commitFormat` | T4 |
| tests/unit/ship.test.ts | edited | Custom format with and without a ticket; default unchanged | T4 |
| src/main/projects/registry.ts | created | Registry: stored and dev projects, watcher per project, per-project handlers, `handlerFor` with unknown-project refusal, add, remove, close, `buildOptionsFor` | T5 |
| tests/unit/project-registry.test.ts | created | AC5 (two temp folders, unknown project), AC7 (watchers closed), AC4 (round limit 1 stops after one review round) | T5 |
| src/main/index.ts | edited | Store in userData, dev project (unpackaged only), registry and four handlers, spike live context from dev watcher, close at quit; `startSpecLock` removed | T6 |
| CHANGELOG.md | edited | Unreleased entries for the store, rules, registry, dev project, request shape, commit format | T7 |
| docs/decisions.md | edited | D40; amendment note under D33; pointer in D36 | T7 |
| docs/workflow-engine.md | edited | Projects section, registry, commit format, code map | T7 |
| docs/human-actions.md | edited | Three-field request, registry step, unknown-project refusal, log examples | T7 |
| CLAUDE.md | edited | Projects section pointer; `HARNESS_SPIKE_ROOT` as the dev project | T7 |
| README.md | edited | Status line; `HARNESS_SPIKE_ROOT` row | T7 |
| docs/phases/phase-04-progress.md | edited | Row 1 in build with spec link; D40; follow-ups | T7 |

Workflow files (group 2):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| docs/specs/p4-project-store/PLAN.md | created | Approved plan | planning |
| docs/specs/p4-project-store/SPECS.md | created | Approved spec | planning |
| docs/specs/p4-project-store/SUBTASK.md | created | Child-ticket draft (no tracker) | planning |
| docs/specs/p4-project-store/tasks.md | created | T1–T8, all ticked | T1–T8 |
| docs/specs/p4-project-store/build-ledger.md | created | Build ledger | build |
| docs/specs/p4-project-store/changes.md | created | The implementor's change rows | build |
| docs/specs/p4-project-store/SUMMARY.md | created | This report | build |

## Acceptance criteria

| AC | Status | Evidence |
| --- | --- | --- |
| AC1 | Pass | `tests/unit/project-store.test.ts`: every operation, persistence through a second store, each refused add |
| AC2 | Pass | `tests/unit/project-store.test.ts`: folder hash equal before and after `remove` |
| AC3 | Pass | `tests/unit/project-rules.test.ts`: every listed accept and refuse case, fixed reasons |
| AC4 | Pass | `tests/unit/project-registry.test.ts` (round limit 1 stops after one review round), `tests/unit/ship.test.ts` (custom format, no ticket, default) |
| AC5 | Pass | `tests/unit/human-actions.test.ts`, `tests/unit/project-registry.test.ts` (two projects, unknown project refused); `pnpm e2e` 21 passed, 2 skipped (macOS-only), run by the implementor |
| AC6 | Pass | `tests/unit/project-store.test.ts`: not JSON, other version, invalid project, missing file, failed rename |
| AC7 | Pass | `tests/unit/project-registry.test.ts`: watchers closed on remove and on `close()` |
| AC8 | Pass | CHANGELOG, D40 and the D33 note, `workflow-engine.md`, `human-actions.md`, `CLAUDE.md`, `README.md`, progress file; PRD, `workflow.md` and the phase doc checked and not stale |

Full checks re-run by the orchestrator: `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test` all pass (81 files, 1652 passed, 15 skipped).

## Needs a runtime check

- If a stored project and the dev project share the same root, the registry starts two watchers on that folder. The spec does not forbid it, and the app's dev watcher is taken from the first start. This case is not exercised.
- Some store tests depend on the real filesystem: the two with 15 s and 20 s timeouts, and the case-only duplicate-root test, which runs on Windows and macOS only. CI on all three systems confirms them.

## Review ledger

Covers every revision, copied from `docs/specs/p4-project-store/build-ledger.md`.

### Revision 0, round 1 (PASS)

| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| ------- | -------- | -------- | -------------------- | --------- | ------ |
| (none)  |          |          |                      |           |        |

## Spec revisions

none

## Rejected findings

none

## Open issues

none

## Git state

Branch `feature/p4-project-store`: approved; committed and pushed in the commit that adds this report. The branch also carries the `docs: phase 4 plan` commit (`ecae3b0`).

## Next steps

Approve, then commit and push the feature branch and open a pull request. Or ask for changes, or choose not yet.
