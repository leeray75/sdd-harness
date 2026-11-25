# Changes: p4-project-store

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/shared/project-rules.ts | created | The rules model: ProjectRules, DEFAULT_RULES, checkRoundLimit, parseRules, hasLineBreak and formatCommitMessage, with fixed reasons (spec Design, Rules). | T1 |
| src/main/workflow/build-loop.ts | edited | roundLimit now calls checkRoundLimit from the shared rules module, with the same results. | T1 |
| tests/unit/project-rules.test.ts | created | Covers every AC3 case, the defaults, the round limit of the build loop, and formatCommitMessage. | T1 |
| src/main/projects/store.ts | created | The project store: load (with set-aside of a bad file), list, get, add, rename, setRules and remove, atomic save, and the add checks (spec Design, Store). | T2 |
| tests/unit/project-store.test.ts | created | Covers AC1 (every operation, persistence, refused adds), AC2 (folder hash around remove), AC6 (set-aside cases, failed rename) and the failed-save case. | T2 |
| src/shared/human-actions.ts | edited | The request gains `project` (dev or a lowercase UUID); parseHumanActionRequest requires exactly action, project and feature; DEV_PROJECT_ID, PROJECT_ID_PATTERN and isProjectId added (D40 amendment of D33). | T3 |
| src/main/human/channel.ts | edited | The decision line adds `project=<id>` after `feature=<slug>` for a valid request. | T3 |
| tests/unit/human-actions.test.ts | edited | Requests carry project; cases added for a missing project, an extra key and bad project ids. | T3 |
| tests/unit/human-channel.test.ts | edited | Requests carry project; log lines expect project=; reason text updated. | T3 |
| tests/unit/spec-handlers.test.ts | edited | Requests carry project; log line expects project=. | T3 |
| tests/unit/ship-handlers.test.ts | edited | Requests carry project; log line expects project=. | T3 |
| tests/unit/headless-e2e.test.ts | edited | The human() helper sends project `dev`. | T3 |
| tests/unit/bridge.test.ts | edited | The request sent through the bridge carries project. | T3 |
| tests/e2e/human-action.spec.ts | edited | Every request sends project `dev`; with no projects the request is refused as an unknown project, so the expectations for (c), (d) and (e) change from not-available to refused. | T3, T6 |
| src/main/workflow/ship.ts | edited | commitMessage replaced by formatCommitMessage (shared rules); ShipOptions gains commitFormat, default DEFAULT_RULES.commitFormat (AC4). | T4 |
| src/main/human/ship-handlers.ts | edited | ShipHandlersDeps gains commitFormat (default DEFAULT_RULES.commitFormat), passed to approve-result. | T4 |
| tests/unit/ship.test.ts | edited | Helper test uses formatCommitMessage; new cases for a custom format with a ticket and with no ticket. | T4 |
| src/main/projects/registry.ts | created | The registry: stored projects plus the dev project, one watcher per project, per-project spec and ship handlers, handlerFor with the unknown-project refusal, addProject, removeProject, close and buildOptionsFor (spec Design, Registry). | T5 |
| tests/unit/project-registry.test.ts | created | Covers AC5 (two temp folders, unknown project refused and nothing changed), AC7 (watchers closed on remove and close, fake startLock) and AC4 (buildOptionsFor round limit 1, controller stops after one review round with the scripted provider). | T5 |
| src/main/index.ts | edited | Creates and loads the store in userData, adds the dev project from HARNESS_SPIKE_ROOT in unpackaged runs only, creates the registry and registers the four handlers with handlerFor (change-rules stays unregistered), points the spike agent's live context at the dev watcher, closes the registry at before-quit, and removes startSpecLock and the single root (spec Design, App). | T6 |
| CHANGELOG.md | edited | Entries under Unreleased: the store, the rules, the registry, the dev project, the request shape and the commit format (AC8). | T7 |
| docs/decisions.md | edited | D40 added (store, rules model, registry, dev project, request shape); a note under D33 that D40 amends its request shape; a pointer in D36 that D40 replaces the single root. | T7 |
| docs/workflow-engine.md | edited | Handlers paragraph names the registry; new Projects section; approve-result commit format; code map for the new files. | T7 |
| docs/human-actions.md | edited | Status, the three-field request, the registry step, the refused code for an unknown project, the log examples and the handler registration. | T7 |
| CLAUDE.md | edited | The workflow-engine pointer names the Projects section; the HARNESS_SPIKE_ROOT line describes the dev project (D40). | T7 |
| README.md | edited | Status line names the in-progress phase and this subtask; the HARNESS_SPIKE_ROOT row describes the dev project. | T7 |
| docs/phases/phase-04-progress.md | edited | Row 1 is in build with its spec link; D40 under Decisions added; follow-ups for p4-project-store. | T7 |
| docs/specs/p4-project-store/tasks.md | edited | Ticked T1 to T8, each after its check passed. | T1 to T8 |
