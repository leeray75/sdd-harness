# Summary Report: p2-tools
Ticket: none   Date: 2026-11-20
Outcome: Clean
Review rounds: 1 of 3 per revision; revisions: 0 of 2
Models: implementor haiku; reviewer sonnet; data agent not used (all chosen by the user); respawns: none

## What was built

- **G1 (registry):** a shared tool registry in `src/shared/tools.ts`. Each of the seven tools has a JSON schema and an args guard, both built from one field table, so they can't drift apart.
- **G2 (seven tools):** each runs in main, inside the project root, through shared path rules in `src/main/tools/paths.ts`.
  - `list_files` and `search_text`: a pure-Node walk with caps.
  - `write_file` and `edit_file`: writes go through a temporary file and a rename.
  - `run_command`: no shell, a minimal environment, a timeout that kills the process tree, and a 64 KiB tail of the output.
  - `read_ticket`: an interface only, which returns ticket text inside an untrusted-data frame.
- **G3 (git refusal):** the tools refuse git by themselves. Any `.git` path segment is refused, including 8.3 short names and forms with trailing dots or spaces, and so is the `git` program.
- **G4 (no new reach):** `makeToolRunner` dispatches each tool through its guard. The gate is unchanged, so every new tool is still denied for every job, and a router-level test proves it.

## Files changed

Product files (group 1):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/shared/tools.ts | created | Shared tool registry: TOOL_NAMES, isToolName, the seven ToolSpecs with JSON schemas, and each tool's args guard (AC1) | T1 |
| tests/unit/tool-registry.test.ts | created | Guard and schema tests (AC1) | T1 |
| src/main/tools/paths.ts | created | Shared path rules: resolveInRoot and the .git check (AC2) | T2 |
| src/main/tools/read-file.ts | edited | Uses paths.ts; the root and path refusals now use the shared reason strings | T2 |
| tests/unit/tool-paths.test.ts | created | Path rule tests (AC2) | T2 |
| src/main/tools/walk.ts | created | Shared folder walk and glob matcher (AC3, AC4) | T3 |
| src/main/tools/list-files.ts | created | list_files runner, with the 1,000-entry and 64 KiB caps (AC3) | T3 |
| src/main/tools/search-text.ts | created | search_text runner (AC4) | T3 |
| tests/unit/tool-files.test.ts | created | list_files and search_text tests (AC3, AC4) | T3 |
| src/main/tools/atomic-write.ts | created | Temporary-file write and rename, with a retry and cleanup (AC5, AC6) | T4 |
| src/main/tools/write-file.ts | created | write_file runner (AC5) | T4 |
| src/main/tools/edit-file.ts | created | edit_file runner (AC6) | T4 |
| tests/unit/tool-write.test.ts | created | write_file and edit_file tests (AC5, AC6) | T4 |
| src/main/tools/run-command.ts | created | run_command runner (AC7) | T5 |
| tests/unit/tool-command.test.ts | created | run_command tests, using process.execPath scripts (AC7) | T5 |
| src/main/tools/read-ticket.ts | created | TicketSource, makeReadTicket, the not-configured default and the untrusted-data frame (AC8) | T6 |
| tests/unit/tool-ticket.test.ts | created | read_ticket tests, including "approve the spec" and "git push" bodies (AC8) | T6 |
| src/main/agent/host.ts | edited | makeToolRunner dispatches each registry tool through its guard; takes the ToolRunnerOptions set by main (AC9) | T7 |
| tests/unit/tool-reachability.test.ts | created | Router-level test with the real gate: every new tool is denied for every job; reader + read_file still runs (AC9) | T7 |

Workflow files (group 2):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| docs/specs/p2-tools/PLAN.md | created | Approved plan | planning |
| docs/specs/p2-tools/SPECS.md | created | Approved spec | planning |
| docs/specs/p2-tools/SUBTASK.md | created | Child-ticket draft, not published (tracker: none) | planning |
| docs/specs/p2-tools/tasks.md | created | Tasks T1–T7, all ticked | T1–T7 |
| docs/specs/p2-tools/build-ledger.md | created | Build ledger | build |
| docs/specs/p2-tools/changes.md | created | The implementor's change rows | build |
| docs/specs/p2-tools/SUMMARY.md | created | This report | build |

Project docs updated after the build, at the user's request (not product code):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| CHANGELOG.md | edited | p2-tools entries under Added, Changed and Known issues | docs |
| docs/decisions.md | edited | D19 amended; new D29 (shared registry and tool-level limits) | docs |
| docs/roadmap.md | edited | Phase 2 marked in progress, with a link to its progress file | docs |
| docs/phases/phase-02-progress.md | created | Phase 2 subtask list, status, decisions and follow-ups | docs |

## Acceptance criteria

| AC | Status | Evidence |
| --- | --- | --- |
| AC1 registry | Met | `src/shared/tools.ts` imports only `agent-protocol`; the reviewer verified the guards and the schema/guard parity; `tool-registry.test.ts` |
| AC2 path rules | Met | `paths.ts`; the reviewer verified the refusals and the parent-folder resolution; `tool-paths.test.ts`; `read-file.test.ts` unchanged and passing |
| AC3 list_files | Met | `list-files.ts` and `walk.ts`; `tool-files.test.ts` |
| AC4 search_text | Met | `search-text.ts`; `tool-files.test.ts` |
| AC5 write_file | Met | `write-file.ts` and `atomic-write.ts`; `tool-write.test.ts` |
| AC6 edit_file | Met | `edit-file.ts`; `tool-write.test.ts` |
| AC7 run_command | Met | `run-command.ts`; `tool-command.test.ts`, with the sentinel environment test and the grandchild timeout test |
| AC8 read_ticket | Met | `read-ticket.ts`; `tool-ticket.test.ts` |
| AC9 dispatch and reachability | Met | `host.ts`; `tool-reachability.test.ts`; `git diff main -- src/main/policy/gate.ts` is empty |
| AC10 checks | Met on Windows | The orchestrator re-ran typecheck, lint, format:check and test: all pass, 35 files, 720 passed, 9 skipped. macOS and Linux run in CI |

## Needs a runtime check

- **macOS and Linux CI is the first real run of two kinds of test.** The POSIX process-group kill on timeout, and the 8 file-symlink tests, were skipped on this Windows machine.
- **8.3 short names.** On Windows, the `realpath.native` expansion of short names such as `GIT~1` only matters where short-name generation is enabled.
- **`list_files` given a path inside `node_modules`** lists that folder's contents, because only folders below the given path are skipped. The reviewer says the spec's "never descends into" can be read either way, and did not count this as a defect.

## Review ledger

### Revision 0, round 1  (PASS)

The reviewer's first pass returned PASS without opening six source files. The orchestrator asked the same reviewer to complete round 1 on them, and the combined review is PASS with no findings.

| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| (none) | | | | | |

## Spec revisions

none

## Rejected findings

none

## Open issues

none

The implementor reported these deviations; none is a defect against the spec:

- The `read_file` refusal texts now use the shared strings, for example "no root is configured".
- `list_files` also cuts at 64 KiB of output, with a note.
- The `run_command` tail is 64 KiB minus 512 bytes, so the status lines fit within the router's limit.
- `search_text` searches every matching file, not just the first 1,000.
- The glob matcher doesn't support braces.
- How `run_command` runs `.cmd`/`.bat` commands on Windows stays deferred to `p2-command-allowlist`.

## Git state

feature/p2-tools; approved; committed and pushed in the commit that adds this report

## Next steps

Approve, then commit and push. Or request changes, or say not yet.
