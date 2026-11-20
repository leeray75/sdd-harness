# Summary Report: p2-policy-engine
Ticket: none   Date: 2026-11-20
Outcome: Clean
Review rounds: 1 of 3 per revision; revisions: 0 of 2
Models: implementor haiku; reviewer sonnet; data agent not used (all chosen by the user); respawns: none

## What was built

- **G1 (table):** `BASE_TOOLS` gives each job its tool set from the design table, over the seven registry tools. A project can only tighten it. `parseTightening` accepts only a removal list, and `effectiveTools` filters the base set by it, so no input can add a tool.
- **G2 (path rules):** `checkToolCall(request, context)` takes the feature, the spec state, the tightening and a command check from its caller. It classifies every write path, after normalizing it, as `outside`, `git`, `spec-doc`, `spec-other` or `source`:
  - The planner may write only the four planning docs of the current feature, and only before approval.
  - The writer may write source only after approval, and never `docs/specs/**`.
  - `run_command` goes to a command check that denies everything until `p2-command-allowlist`.
- **G3 (Rule events):** the router emits exactly one typed Rule event per validated tool call, carrying the job, tool, sanitized target and reason. The host logs it through the redacting logger: allows as info, denies as errors. A denied call returns `denied` with a fixed reason and never reaches the runner.
- **G4 (tool layer):**
  - `write_file` and `edit_file` refuse a write that a symlink moves into a different area.
  - `list_files` and `search_text` refuse paths inside `node_modules`.

## Files changed

Product files (group 1):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/main/policy/policy-table.ts | created | `BASE_TOOLS`, the per-job tool table from the design (AC1) | T1 |
| src/main/policy/context.ts | created | `SpecState`, `PolicyContext`, `CommandCheck`, `denyAllCommands`, `DEFAULT_POLICY_CONTEXT` and the feature-slug rule | T1 |
| src/main/policy/tightening.ts | created | `Tightening`, `parseTightening` and `effectiveTools`; can only remove tools (AC6) | T1, T3 |
| src/main/policy/path-areas.ts | created | `classifyPath` and `sameArea`: normalizes a path and returns its area (AC2) | T2 |
| src/main/policy/rule-event.ts | created | `RuleEvent`, target extraction and sanitizing, `formatRuleEvent`, `logRuleEvent` (AC7) | T4 |
| src/main/policy/gate.ts | edited | Rewritten: seven ordered checks with fixed reasons, returning a `PolicyDecision` with its Rule event; replaces the reader-only gate | T5 |
| src/main/agent/router.ts | edited | `PolicyDecision` and the new `onRuleEvent` dep: one event per validated call, before running or replying; the denial log line removed (AC7, AC8) | T6 |
| src/main/agent/host.ts | edited | Router deps use `DEFAULT_POLICY_CONTEXT` and `logRuleEvent(log)` (AC12) | T6 |
| src/main/tools/paths.ts | edited | `hasNodeModulesSegment`, `areaMismatch`, and their two fixed reasons (AC9, AC10) | T7 |
| src/main/tools/write-file.ts | edited | Symlink re-check after `resolveInRoot` (AC9) | T7 |
| src/main/tools/edit-file.ts | edited | Same symlink re-check (AC9) | T7 |
| src/main/tools/list-files.ts | edited | `collectMatchingFiles`, which `search_text` shares, refuses `node_modules` paths (AC10) | T7 |
| tests/unit/policy-table.test.ts | created | Table, holders, slug rule and default context (AC1) | T1 |
| tests/unit/policy-paths.test.ts | created | 36 `classifyPath` cases and `sameArea` (AC2) | T2 |
| tests/unit/policy-tightening.test.ts | created | Accepted and refused shapes, no echoed values, every-job and every-tool "never adds" (AC6) | T3 |
| tests/unit/policy-rule-events.test.ts | created | Event fields, sentinel absence, escaping and cutting, sink levels (AC7) | T4 |
| tests/unit/policy-gate.test.ts | edited | Rewritten for AC1, AC3, AC4, AC5, AC6 (gate level) and AC8 (no echo) | T5 |
| tests/unit/agent-router.test.ts | edited | One event per validated call, none for invalid messages; the six-step runner-spy test (AC7, AC8) | T6 |
| tests/unit/tool-reachability.test.ts | edited | Reachability follows the table under the default context (AC12) | T6 |
| tests/unit/tool-write.test.ts | edited | Folder link into the spec folder: write and edit refused, nothing created (AC9) | T7 |
| tests/unit/tool-files.test.ts | edited | `node_modules` refusals for `list_files` and `search_text`; `read_file` still works (AC10) | T7 |
| tests/unit/policy-acceptance.test.ts | created | The F1 criteria as named tests: router, real gate and real runner on a temp root, every job in every spec state, hostile ticket and file text, human-only messages (AC11) | T8 |

Workflow files (group 2):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| docs/specs/p2-policy-engine/PLAN.md | created | Approved plan | planning |
| docs/specs/p2-policy-engine/SPECS.md | created | Approved spec | planning |
| docs/specs/p2-policy-engine/SUBTASK.md | created | Child-ticket draft, not published (no tracker) | planning |
| docs/specs/p2-policy-engine/tasks.md | created | Tasks T1–T9, all ticked | T1–T9 |
| docs/specs/p2-policy-engine/build-ledger.md | created | Build ledger | build |
| docs/specs/p2-policy-engine/changes.md | created | The implementor's change rows | build |
| docs/specs/p2-policy-engine/SUMMARY.md | created | This report | build |

Project docs updated after the build, as the plan says (not product code):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| docs/decisions.md | edited | D19 amended; new D30 (per-job table, path areas, tightening and Rule events) | docs |

## Acceptance criteria

| AC | Status | Evidence |
| --- | --- | --- |
| AC1 table | Met | `policy-table.ts`; `policy-table.test.ts`; `policy-gate.test.ts` across 18 contexts |
| AC2 path areas | Met | `path-areas.ts`; 36 cases in `policy-paths.test.ts`, covering every listed form |
| AC3 planner | Met | `gate.ts`; `policy-gate.test.ts`, with exact reasons |
| AC4 writer | Met | `gate.ts`; the approved `SPECS.md` edit checked against the full deny event |
| AC5 commands | Met | `context.ts` (`denyAllCommands`); `policy-gate.test.ts`, with a spy check |
| AC6 tightening | Met | `tightening.ts`; `policy-tightening.test.ts`; a hostile tightening tested over every state, job and tool |
| AC7 Rule events | Met | `rule-event.ts`, `router.ts`; `policy-rule-events.test.ts`, `agent-router.test.ts` |
| AC8 denied calls | Met | `router.ts`; a runner-spy test for each of steps 1–6 |
| AC9 symlink re-check | Met on Windows | `areaMismatch` in the write and edit runners; the folder-link (junction) cases ran here |
| AC10 `node_modules` | Met | `paths.ts`, `list-files.ts`; `tool-files.test.ts` |
| AC11 human-only actions | Met | `policy-acceptance.test.ts` (26 tests) |
| AC12 wiring | Met | `host.ts`, read from the diff (not testable without Electron); `tool-reachability.test.ts` updated |
| AC13 checks | Met on Windows | The orchestrator re-ran typecheck, lint, format:check and test: all pass, 40 files, 890 passed, 9 skipped. macOS and Linux run in CI |

## Needs a runtime check

- **The AC9 folder-link cases** need a platform that allows creating the link. They skip otherwise, so check in CI that they run on macOS and Linux.
- **The host wiring** (`DEFAULT_POLICY_CONTEXT` and `logRuleEvent(log)`) is checked only by reading the code: `startAgentHost` needs Electron and has no unit test.
- **Case-sensitive file systems:** a source folder genuinely named `Docs/Specs/...` is treated as spec and denied for the writer. This is the spec's deliberate conservative rule, not a defect.

## Review ledger

### Revision 0, round 1  (PASS)

The reviewer's first pass returned PASS without opening the test files. The orchestrator asked the same reviewer to complete round 1 on them, and the combined review is PASS with no findings.

| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| (none) | | | | | |

## Spec revisions

none

## Rejected findings

none

## Open issues

none

The implementor reported these deviations; the reviewer found none in conflict with the spec:

- `tightening.ts` was created in T1 with only the type and filled in during T3.
- A `.. ` segment (with a trailing space) climbs like `..`. A segment that becomes empty after its trailing dots and spaces are stripped is kept. Both are the stricter reading.
- Targets are escaped with lowercase `\uXXXX`. A target over 200 code points becomes its first 200 plus `…`, never splitting a surrogate pair.
- The gate doesn't re-validate the job at run time; the router's protocol check does that first.
- `search-text.ts` is unchanged: the `node_modules` refusal is in `collectMatchingFiles`, which `list_files` and `search_text` share.
- CHANGELOG.md is left for after the merge, as before.

## Git state

feature/p2-policy-engine; approved; committed and pushed in the commit that adds this report

## Next steps

Approve, then commit and push. Or request changes, or say not yet.
