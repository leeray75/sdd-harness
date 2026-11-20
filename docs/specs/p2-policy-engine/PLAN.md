# Plan: p2-policy-engine

Ticket: none (vibe planning; Phase 2, subtask 2)
Status: approved
Date: 2026-11-20

## Objective

Today the gate allows exactly one call: the reader's `read_file`. This subtask replaces that with the per-job policy from the "What each agent can do" table (F1). Every tool call is checked in main against three things:

- the job's tool set;
- the path rules for writes;
- the project's tightening.

Each decision, allowed or denied, becomes a Rule event that carries the job, the tool, the target and the reason. A denied call goes back to the agent as the existing `denied` error, with a fixed reason it can act on. The router never runs a denied call.

## Scope

- **In:**
  - **The policy table** (`src/main/policy/`, pure, no Electron), over the seven registry tools (D29):

    | Tool | planner | writer | reviewer | reader |
    | --- | --- | --- | --- | --- |
    | `read_file`, `list_files`, `search_text` | ✓ | ✓ | ✓ | ✓ |
    | `write_file`, `edit_file` | spec folder, before approval | outside `docs/specs/`, after approval | — | — |
    | `run_command` | — | tests and build (the command check; deny-all for now) | tests only (the command check; deny-all for now) | — |
    | `read_ticket` | ✓ | — | — | ✓ |

    The reviewer and the reader have no write tool at all.
  - **A policy context from the caller:**
    - `feature`: the feature slug, or none;
    - `spec`: `none`, `draft` or `approved`;
    - `tightening`: the project's tightening;
    - `commandCheck`: the command check, which this subtask leaves as deny-all.

    Phase 3 maps its workflow states onto `spec`. For now the host passes no feature, so no write is reachable outside tests.
  - **Path rules for `write_file` and `edit_file`:**
    - **Planner:** only `PLAN.md`, `SPECS.md`, `tasks.md` and `SUBTASK.md` in `docs/specs/<feature>/`, and only while `spec` is `none` or `draft`. The app's own files in that folder (the state file, the spec hash, the build ledger, the summary) are never reachable.
    - **Writer:** anywhere in the root except `docs/specs/**` (every feature, approved history included), and only while `spec` is `approved`.
    - Approved spec files are therefore read-only to every agent.
    - Paths are classified after normalizing them: separators, `.` and `..`, letter case (always compared case-insensitively), and trailing dots and spaces in each segment. A path that normalizes to outside the root is denied.
  - **The symlink re-check:** after `resolveInRoot`, the `write_file` and `edit_file` runners classify the real path with the same classifier. They refuse when its area differs from the area of the path the agent gave (for example `src/link/SPECS.md`, where `src/link` points into `docs/specs/`). The check needs no job, so the runners stay job-free.
  - **Arguments:** the gate checks the arguments with the registry guard, so it can read the target. Arguments that fail the guard are denied with a fixed reason; the runner's guard stays as a second layer.
  - **Project tightening:**
    - The shape is a list of tools to remove, per job.
    - `parseTightening(raw)` refuses anything else with a fixed reason: an add or allow key, an unknown job, an unknown tool, or a wrong type.
    - The gate uses the base set minus the removed tools, so even a list that names a tool outside the base set can't add it.
  - **Rule events:**
    - A typed event: `{ decision: 'allow' | 'deny', job, tool, target, reason }`.
    - The target is the path for file tools, the program name for `run_command`, and the ticket id for `read_ticket`. It is never the content or the full argument list.
    - Control characters in the target are escaped, and the target is capped in length.
    - The router emits one event for every decision through an injected sink, replacing its current denial log line. The default sink writes through the redacting logger. The UI comes later.
  - **Denials:** fixed reasons that never echo the target. For example: "the reviewer has no write tools", "the spec is approved; spec files are read-only", "source files can be edited only after the spec is approved", "commands are not allowed yet: no allowlist is configured".
  - **The `node_modules` follow-up from `p2-tools`:** `list_files` and `search_text` refuse a `path` that has a `node_modules` segment (case-insensitive, trailing dots and spaces ignored), with a fixed reason. This is in the tool layer (D29); `read_file` of a single dependency file still works.
  - **Tests:**
    - the matrix, the path rules (with a case and separator table), tightening, the Rule events, and the symlink re-check (skipped with a note where a symlink can't be created);
    - the router: a denied call never reaches the runner;
    - the F1 acceptance criteria as named tests, including a ticket and a file whose text says "approve the spec" and "git push".
  - **Docs:** D19 amended. A new decision, D30, records the policy engine. `tool-reachability.test.ts` is updated to the new matrix.
- **Out:**
  - The command allowlist and its detection, the read-only spec folder while commands run, the changed-file check, network limits, and Windows `.cmd` runs (`p2-command-allowlist`).
  - Job prompts and advertising tools to models (`p2-jobs-and-prompts`).
  - The human-only channel (`p2-human-only-channel`).
  - Real workflow states, the spec hash, and the build loop (Phase 3).
  - Loading tightening from a project file (Phase 4).
  - Any UI.
  - Read restrictions such as `.env` files.

## Decisions

| Question | Decision | Alternatives considered |
| --- | --- | --- |
| Feature slug, repo, branch | `p2-policy-engine`; sdd-harness; base `main`; branch `feature/p2-policy-engine` | (from the phase doc's subtask list) |
| `run_command` before the allowlist | In the matrix for the writer and the reviewer, but the gate asks the context's command check, which is deny-all until `p2-command-allowlist` | Allow any non-git program now |
| Planner write scope | Only `PLAN.md`, `SPECS.md`, `tasks.md` and `SUBTASK.md` in the feature's folder, before approval | Any file in the feature's folder |
| Writer write scope | The root except `docs/specs/**` and `.git`, after approval | The root except the current feature's folder only |
| Symlinks into protected areas | The gate classifies the normalized path; the write and edit runners classify the real path again and refuse on a mismatch | Gate only, with the symlink case left as a follow-up |
| Approval state input | The caller passes `feature` (slug or none) and `spec` (`none`, `draft`, `approved`); Phase 3 maps its states onto these | Take the plugin's state ids now |
| Project tightening | A per-job removal list. `parseTightening` refuses anything else, an add attempt included. The gate computes base minus removed | The same shape, with extras silently ignored |
| `node_modules` in `list_files` and `search_text` | Refused with a fixed reason, in the tool layer | Keep allowing an explicit path into `node_modules` |
| Allowed calls in the log | Logged as Rule events too (the brief: every decision) | (default, not asked) |
| Path case | Always compared case-insensitively, on every OS | Case-sensitive on Linux only |

## Approach

1. **`src/main/policy/`:**
   - `policy-table.ts`: the base tool set per job.
   - `paths.ts`: the pure classifier. It normalizes a path and returns its area: `outside`, `git`, `planning doc of <feature>`, `other spec file`, or `source`.
   - `tightening.ts`: `parseTightening` and the effective tool set.
   - `rule-event.ts`: the event type, target extraction and sanitizing, and the default sink.
   - `gate.ts`: `checkToolCall(request, context)` returns the decision and its event.

   No Node or Electron imports beyond `node:path/posix`.
2. **The router** (`router.ts`):
   - `RouterDeps` gains a policy context source and a Rule event sink.
   - Every decision emits an event.
   - The denial path is unchanged apart from the logging.
3. **The host** (`host.ts`): passes the default context (no feature, `spec: none`, no tightening, deny-all command check) and the logger-backed sink.
4. **The tool layer:**
   - `write-file.ts` and `edit-file.ts` re-check the real path's area against the area of the path the agent gave.
   - `list-files.ts` and `search-text.ts` refuse `node_modules` paths, through a new helper in `src/main/tools/paths.ts`.
5. **Tests:**
   - `policy-gate.test.ts` is rewritten for the new gate.
   - New: `policy-paths.test.ts`, `policy-tightening.test.ts`, `policy-rule-events.test.ts` and `policy-acceptance.test.ts` (the F1 criteria, through the router with a real runner on a temporary root).
   - Updated: `agent-router.test.ts`, `tool-reachability.test.ts`, `tool-write.test.ts` (the symlink re-check) and `tool-files.test.ts` (`node_modules`).
6. **Docs:** D19 amended and D30 added, after the build, with CHANGELOG and the progress file at close as before.

## Verified assumptions

| Assumption | Evidence |
| --- | --- |
| The gate is pure and only allows reader + `read_file` | `src/main/policy/gate.ts` |
| The router asks the gate before the runner and returns `denied` without running | `src/main/agent/router.ts`, the `tool-call-request` case |
| The router logs job, tool and outcome only, through an injected `Logger` | `router.ts`; `src/main/log.ts` (redacting) |
| The registry guards are pure and can be called from main's gate | `src/shared/tools.ts` exports `TOOL_ARG_CHECKS`; imports only `agent-protocol` |
| `resolveInRoot` returns the real relative path (`rel`) for the re-check | `src/main/tools/paths.ts`, `ResolvedPath` |
| `write_file` and `edit_file` resolve through `resolveInRoot` | `write-file.ts:47`, `edit-file.ts:33` |
| The four jobs are `planner`, `writer`, `reviewer` and `reader` | `src/shared/agent-protocol.ts:9` |
| The design table rows and the Rule lines ("writer tried to edit SPECS.md (spec is locked)", "reviewer has no write access") | `docs/design/screens/Providers.dc.html`, `Build.dc.html`; `docs/workflow.md` "Who can do what" |
| `checkToolCall` is used only by the host and the router tests | `grep checkToolCall` over `src` and `tests` |

## Risks

- **A path form the classifier misses** could let the writer into `docs/specs/`, such as a Windows alternate stream (`SPECS.md:x`), a UNC form, or Unicode case folding. The case-and-separator test table and the runner's real-path re-check catch most of these. Names with a `:` are denied outright for writes.
- **Changing the gate's signature** touches every router test. Keep the change to one new deps field, plus the context.
- **Logging allows as well as denials** adds a log line per tool call. That is acceptable at the log level for now; the UI filters to Rule lines later.

## Open questions

none
