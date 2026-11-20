# Changes: p2-policy-engine

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/main/policy/policy-table.ts | created | `BASE_TOOLS`, the per-job tool table from the design. Read-only data; a project can only remove from it. | T1 |
| src/main/policy/context.ts | created | `SpecState`, `PolicyContext`, `CommandCall`, `CommandCheck`, `denyAllCommands`, `DEFAULT_POLICY_CONTEXT` and the feature-slug rule (`effectiveFeature`). | T1 |
| src/main/policy/tightening.ts | created | `Tightening` type (T1, so the context compiles), then `parseTightening` and `effectiveTools`, which refuse everything but `{}` and `{ remove }`, and only ever remove. | T1, T3 |
| tests/unit/policy-table.test.ts | created | AC1 table part: `BASE_TOOLS` matches the design, read_ticket and run_command holders, slug rule, default context and deny-all reason. | T1 |
| src/main/policy/path-areas.ts | created | `classifyPath` and `sameArea`: normalizes the path (separators, `.`/`..`, case, trailing dots and spaces) into outside, git, spec-doc, spec-other or source. | T2 |
| tests/unit/policy-paths.test.ts | created | AC2: 36 `classifyPath` cases, including the spec's list, plus `sameArea`. | T2 |
| tests/unit/policy-tightening.test.ts | created | AC6: accepted and refused shapes, fixed refusal reason with no echoed value, and the every-job, every-tool "never adds" check. | T3 |
| src/main/policy/rule-event.ts | created | `RuleEvent`, `makeRuleEvent` (target from the guarded args, `-` for unknown tools or bad args), `sanitizeTarget` (control characters escaped, cut at 200 plus `…`), `formatRuleEvent` and `logRuleEvent`. | T4 |
| tests/unit/policy-rule-events.test.ts | created | AC7 event and sink parts: fields, no argument value besides the target, escaping and cutting, info for allow and error for deny. | T4 |
| src/main/policy/gate.ts | edited | Rewritten: `checkToolCall(request, context)` runs the seven ordered checks with the fixed reasons and returns a `PolicyDecision` with its rule event. Replaces the reader-only gate. | T5 |
| tests/unit/policy-gate.test.ts | edited | Rewritten for AC1, AC3, AC4, AC5, AC6 (gate level), AC8 (no echo) and rule events, replacing the reader-only tests. | T5 |
| src/main/agent/router.ts | edited | `checkToolCall` returns `PolicyDecision`; new `onRuleEvent` dep, called once per validated tool call before running or replying; the `tool call denied` log line removed. | T6 |
| src/main/agent/host.ts | edited | Router deps built once: `checkToolCall` bound to `DEFAULT_POLICY_CONTEXT`, `onRuleEvent: logRuleEvent(log)`. | T6 |
| tests/unit/agent-router.test.ts | edited | Updated to `PolicyDecision` and `onRuleEvent`; AC7 router part (one event per validated call, none for invalid, sentinel check, escaping and cutting); AC8 six-step spy test; denial log line test replaced. | T6 |
| tests/unit/tool-reachability.test.ts | edited | Reachability matrix now follows the table under the default context (list and search for all jobs, read_ticket for planner and reader, writes denied at step 2 or by path rules, run_command denied); `read_file` allowed for every job. | T6 |
| src/main/tools/paths.ts | edited | Adds `hasNodeModulesSegment`, `areaMismatch` (the symlink re-check), and the reasons `AREA_CHANGED_REASON` and `NODE_MODULES_REASON`. | T7 |
| src/main/tools/write-file.ts | edited | Symlink re-check after `resolveInRoot`: refuses when the real path is in a different policy area. | T7 |
| src/main/tools/edit-file.ts | edited | Same symlink re-check as write-file. | T7 |
| src/main/tools/list-files.ts | edited | `collectMatchingFiles` (shared with search_text) refuses a `path` inside node_modules with the fixed reason. search-text.ts needed no change, since it uses the same function. | T7 |
| tests/unit/tool-write.test.ts | edited | AC9: folder link `src/link` to the spec folder; write and edit of `src/link/SPECS.md` refused, nothing created, plain source write still works. File-link cases skip here as before. | T7 |
| tests/unit/tool-files.test.ts | edited | AC10: list_files and search_text refuse `node_modules`, `NODE_MODULES/x`, `a/node_modules/b`, `a\node_modules`; read_file still reads under node_modules; segment helper cases. | T7 |
| tests/unit/policy-acceptance.test.ts | created | AC11 and the F1 criteria as named tests: the router with the real gate and runner on a temp root, every job in every spec state, hostile ticket and file text, human-only messages and tool names, tightening, rule events. | T8 |
| docs/specs/p2-policy-engine/tasks.md | edited | Ticked T1 to T8 as each check passed, and T9 once the full checks passed. | T1, T2, T3, T4, T5, T6, T7, T8, T9 |
| docs/specs/p2-policy-engine/changes.md | created | This file. | T1–T9 |
