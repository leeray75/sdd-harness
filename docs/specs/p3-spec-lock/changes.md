# Changes: p3-spec-lock

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/shared/spec-state.ts | created | Pure state file module: the file name, version and cap, parse and serialize of the state file, the hash input normalization, the approval table, the frontmatter status setter and the required-headings check. | T1 |
| tests/unit/spec-state.test.ts | created | Parse problems, the approval table, normalization, frontmatter cases, headings, and the purity import scan (AC2, AC8). | T1 |
| docs/specs/p3-spec-lock/tasks.md | edited | Ticked T1 to T7 as each check passed. | T1, T2, T3, T4, T5, T6, T7 |
| docs/specs/p3-spec-lock/changes.md | created | The record of this build: the file rows and the stale-doc check. | T1 to T7 |
| src/main/workflow/spec-lock.ts | created | The lock on disk: capped state read, atomic state write (temp and rename), SPECS.md hash, approvalOf, currentFeature and scanSpecFoldersWithLock. | T2 |
| src/main/workflow/spec-folders.ts | edited | The approvalOf call in scanSpecFolders is wrapped in try/catch, so a throw reads the folder as unchecked. Signature unchanged. | T2 |
| tests/unit/spec-lock.test.ts | created | AC1 round trip at lock level, AC2 read and write cases, hashing, current feature and the AC5 scan. Two symlink cases skip where file symlinks are refused. | T2 |
| src/main/workflow/spec-watch.ts | created | The watcher: non-recursive fs.watch on docs/specs and the current feature's folder, debounced refresh, change-only onChange, close. | T3 |
| tests/unit/spec-watch.test.ts | created | Real fs.watch in temp dirs: changed within 2 s, refresh after close, no callback after close, change-only calls. | T3 |
| src/shared/human-actions.ts | edited | Added `refused` to HumanActionRefusal, for handler refusals with a fixed reason. | T4 |
| src/main/human/spec-handlers.ts | created | The approve-spec and edit-approved-spec handlers: checks, atomic writes, restore of SPECS.md on a failed state write, and no throw. | T4 |
| tests/unit/spec-handlers.test.ts | created | Handlers driven through the channel: blocked calls never reach them, refusals change no file, success writes, restore, and the clock and listener failures. | T4 |
| src/main/index.ts | edited | startSpecLock registers both handlers and starts the watcher when HARNESS_SPIKE_ROOT is set, closes it on quit, and passes the watcher's live value to the agent host. Updated the channel comment. | T4, T5 |
| src/main/policy/context.ts | edited | Added the `locked` spec state, LiveSpec, specStateOf, and effectiveFeature on the shared slug pattern and length (the local pattern is removed). | T5 |
| src/main/policy/gate.ts | edited | The `locked` rule: spec, other spec and source writes are denied with a fixed reason, before the job rules. | T5 |
| src/main/agent/host.ts | edited | Optional live supplier: contextFor merges the live feature and spec into each call's context; commandPolicyFor and startAgentHost take the supplier. Without one, the default is used. | T5 |
| tests/unit/policy-gate.test.ts | edited | AC6 block: approval mapping, approved and draft denials, locked denials for every write, the state file denied to every job, and effectiveFeature cases. | T5 |
| tests/unit/host-context.test.ts | created | The host's per-call context follows the supplier, and the default holds without one. | T5 |
| docs/decisions.md | edited | D36 added: the state file, hash input, approval values, editing flag, gate mapping, watcher, current feature, handlers and the refused code. Amended note on D34: EDIT_SPEC may come from edit-approved-spec. | T6 |
| docs/workflow-engine.md | edited | New "Spec lock" section; the detection section's lock sentence; the code list; the extension note (the lock is no longer "later"). | T6 |
| docs/human-actions.md | edited | Status line (two handlers registered with a root), five refusal codes with `refused`, a refused log line, and the registration section retitled. Prettier realigned the table. | T6 |
| CHANGELOG.md | edited | Spec lock entry under Added, placed after the Document layer bullet and its sub-bullets, and a Changed entry for the gate's spec state, the slug rules and `refused`. | T6, U1, round U1 |
| CLAUDE.md | edited | Decisions D1–D36; the engine line now names the Spec lock section and its files; HARNESS_SPIKE_ROOT's new role. | T6 |
| README.md | edited | Decisions D1–D36; the engine doc row names the spec lock; HARNESS_SPIKE_ROOT row gets its new role. Prettier realigned the tables. | T6 |
| docs/PRD.md | edited | F2 item "Existing folders open with the right stage" ticked; the approval line cites D36. | T6 |
| docs/workflow.md | edited | The state paragraph says the approval comes from the spec lock (D36). | T6 |
| docs/agent-jobs.md | edited | The enforcement rule on the spec: the spec state comes from the lock, and an unchecked approval blocks spec and source writes. | T6 |
| docs/phases/phase-03-workflow-engine.md | edited | "State file name and format" recorded as decided in p3-spec-lock (D36). | T6 |
| docs/phases/phase-03-progress.md | edited | D36 in decisions added; planning decision recorded; p3-spec-docs follow-ups marked resolved; p3-spec-lock follow-ups added. The table row's status and commit are left for after the merge. | T6 |

## Stale-doc check (T6)

Each doc checked, and what changed:

- `CLAUDE.md`: changed (D1–D36, the engine line, HARNESS_SPIKE_ROOT).
- `README.md`: changed (D1–D36, engine row, HARNESS_SPIKE_ROOT row).
- `docs/PRD.md`: changed (F2 item ticked, approval line cites D36). The "Spec lock by hash" line already matches the design.
- `docs/workflow.md`: changed (approval paragraph cites the lock, D36). The approval-and-lock section already matched.
- `docs/agent-jobs.md`: changed (enforcement rule on the spec state).
- `docs/phases/phase-03-workflow-engine.md`: changed (state file decided).
- `docs/phases/phase-03-progress.md`: changed (decisions, planning decision and follow-ups). Table row left for after the merge.
- `docs/workflow-engine.md`: changed (Spec lock section, detection sentence, code list, extension note).
- `docs/human-actions.md`: changed (status, refusal codes, log example, registration section).
- `docs/decisions.md`: changed (D36 added, D34 amended).
- `CHANGELOG.md`: changed (Added and Changed entries).
- `docs/roadmap.md`: no change needed (Phase 3 row already reads "in progress").
- `docs/design-notes.md`: no change needed (the spec-lock lines are UI design copy, and no UI changed here).
- `docs/agent-commands.md`: no change needed (command policy is untouched).
- `docs/phases/phase-02-progress.md` and `phase-02-tool-policy.md`: no change needed (a record of Phase 2; their "Phase 3 supplies" lines describe the plan of that time).
- `docs/phases/README.md`: no change needed.
