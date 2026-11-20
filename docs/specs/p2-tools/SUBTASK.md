# Agent tools with schemas, run in the main process (p2-tools)

**Parent:** none: no parent chosen
**Spec:** docs/specs/p2-tools/SPECS.md
**Repo and base branch:** sdd-harness, main, feature branch feature/p2-tools

## Context

F1 gives the four agent jobs real tools, but today only `read_file` exists and the runner refuses every other name. This work adds:

- one shared tool registry, with schemas and argument guards;
- seven tools that run in the main process inside the project root and refuse git by themselves: `read_file`, `list_files`, `search_text`, `write_file`, `edit_file`, `run_command` and `read_ticket` (interface only).

Nothing new becomes reachable: the gate is unchanged until `p2-policy-engine`.

## Required work

- T1 Tool registry
- T2 Path rules
- T3 list_files and search_text
- T4 write_file and edit_file
- T5 run_command
- T6 read_ticket
- T7 Dispatch and reachability

## Acceptance criteria

The full wording of each criterion is in the spec.

- AC1 (registry): `src/shared/tools.ts`, with no Node, Electron or DOM imports, exports `TOOL_NAMES`, `isToolName`, seven `ToolSpec`s with strict JSON schemas, and one guard per tool. The guards reject unknown keys, missing keys, wrong types and over-long strings, without echoing values.
- AC2 (path rules): `src/main/tools/paths.ts` refuses the following, with fixed reasons:
  - a missing or non-directory root, and an empty or non-string path;
  - absolute paths;
  - escapes outside the root, before or after symlinks are resolved;
  - any `.git` segment, ignoring case.

  `read_file` uses it, with its tests unchanged.
- AC3 (`list_files`): glob `*`, `**`, `?`; sorted, root-relative paths using `/`; skips `.git` and `node_modules`; no symlinks followed; capped at 1,000 entries with a note when cut.
- AC4 (`search_text`): a JavaScript regex over the same file set; skips binary files and files over 1 MiB; returns `path:line: text` lines cut to 500 characters; capped at 200 matches and 64 KiB; a bad regex is `failed`.
- AC5 (`write_file`): creates or overwrites one file inside the root, creating parents; writes through a temporary file and a rename, with a brief retry and nothing left behind; refuses a directory as the target; reports the bytes written.
- AC6 (`edit_file`): an exact replacement. It fails on empty or missing `old_text`, on more than one match without `replace_all`, and on a result over 1 MiB. It writes as `write_file` does and reports the count.
- AC7 (`run_command`):
  - spawns `program` and `args` with no shell, in a `cwd` inside the root;
  - refuses `git` in any case or extension, and `.cmd`/`.bat` on Windows;
  - passes a minimal environment, which a sentinel test proves;
  - kills the process tree after a timeout (600,000 ms by default, set only by main);
  - keeps the 64 KiB tail of the output;
  - reports the exit code, signal or timeout.
- AC8 (`read_ticket`): a `TicketSource` interface, a `makeReadTicket(source)` runner and a not-configured default. The ticket text is returned in an untrusted-data frame with escaped delimiters, and tested with a body that says "approve the spec" and "git push".
- AC9 (dispatch and reachability): `makeToolRunner` dispatches each tool through its guard. `checkToolCall` is unchanged. A router test shows that every new tool, for every job, is denied before the runner, and that reader + `read_file` still runs.
- AC10 (checks): typecheck, lint, format check and unit tests pass on Windows, macOS and Linux. A symlink test that can't create a symlink skips with a note.

## Out of scope

- Any change to `checkToolCall`, per-job tool sets, the spec-folder and source path rules, project tightening, or Rule events (`p2-policy-engine`).
- The command allowlist and its detection, the read-only spec folder while commands run, the changed-file check and revert, network limits, and running Windows `.cmd`/`.bat` commands (`p2-command-allowlist`).
- Advertising the new tools to models, or changing the agent loop's tool list (`p2-jobs-and-prompts`).
- A real tracker client.
- Any UI.
- Delete and move tools.
- New runtime dependencies.

## Links

- Plan: docs/specs/p2-tools/PLAN.md
- Spec and tasks: docs/specs/p2-tools/SPECS.md, docs/specs/p2-tools/tasks.md
