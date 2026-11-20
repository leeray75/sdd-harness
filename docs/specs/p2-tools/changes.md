# Changes: p2-tools

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/shared/tools.ts | created | Shared tool registry: TOOL_NAMES, isToolName, the seven ToolSpecs with JSON schemas, and the args guard for each tool (AC1). | T1 |
| tests/unit/tool-registry.test.ts | created | Checks valid args, unknown keys, missing keys, wrong types, length caps, reasons without values, and that every spec matches its guard (AC1). | T1 |
| src/main/tools/paths.ts | created | Shared path rules: resolveInRoot (relative, real-path containment, missing-file parents, fixed reasons) and the .git segment check (AC2). Takes over isInside from read-file.ts. | T2 |
| src/main/tools/read-file.ts | edited | Now resolves its path through paths.ts; read behaviour and size cap unchanged, and the root and path reasons are the shared fixed strings. | T2 |
| tests/unit/tool-paths.test.ts | created | Checks absolute paths, `..` escapes, file and folder symlink escapes, missing files with existing parents, and .git in any case (AC2). | T2 |
| src/main/tools/walk.ts | created | Shared folder walk (skips .git and node_modules, never follows symlinks, sorted) and the in-house glob matcher for *, ** and ? (AC3, AC4). | T3 |
| src/main/tools/list-files.ts | created | list_files runner and the shared collectMatchingFiles used by search_text; 1,000-entry cap and 64 KiB output cap with a cut note (AC3). | T3 |
| src/main/tools/search-text.ts | created | search_text runner: JavaScript regex, binary and over-1-MiB skips, 200-match and 64 KiB caps, 500-character line cut (AC4). | T3 |
| tests/unit/tool-files.test.ts | created | Glob forms, skipped folders, symlinks not followed, entry and output caps, binary and large files, bad regex, match and output caps (AC3, AC4). | T3 |
| src/main/tools/atomic-write.ts | created | Writes through a temporary file in the same folder and renames it into place; retries a failed rename briefly, then removes the temporary file and returns a fixed failure (AC5, AC6). | T4 |
| src/main/tools/write-file.ts | created | write_file runner: AC2 path rules, refuses a directory or non-regular target, 1 MiB byte cap, creates parent folders inside the root, returns the path and byte count (AC5). | T4 |
| src/main/tools/edit-file.ts | created | edit_file runner: exact replacement with the empty, not-found, uniqueness and replace_all rules, a 1 MiB result cap, literal `$` in new_text (AC6). | T4 |
| tests/unit/tool-write.test.ts | created | Parent creation, overwrite, directory target, size limits, uniqueness rule, replace_all, no temporary file left behind, rename retry and give-up, and the AC2 refusals (AC5, AC6). | T4 |
| src/main/tools/run-command.ts | created | run_command runner: spawn with shell false, cwd inside the root, git and Windows .cmd/.bat refusal before start, minimal environment, timeout that kills the tree (default 600,000 ms, set by main only), 64 KiB output tail with a cut note, ok with exit code, signal or timeout (AC7). | T5 |
| tests/unit/tool-command.test.ts | created | process.execPath scripts: exit codes, stdout and stderr, argument array, cwd, minimal environment with a sentinel, tail cap, timeout that kills a grandchild, git and .cmd refusal, and a program that cannot start (AC7). | T5 |
| src/main/tools/read-ticket.ts | created | read_ticket interface: TicketSource, makeReadTicket, the not-configured default source, and the untrusted-data frame with delimiter escaping and size limits (AC8). | T6 |
| tests/unit/tool-ticket.test.ts | created | Not-configured default, fake source with "approve the spec" and "git push" kept inside the frame, delimiter escaping, size and title caps, and failing sources (AC8). | T6 |
| src/main/agent/host.ts | edited | makeToolRunner now checks the registry name and each tool's args guard, then dispatches to that tool's runner; takes ToolRunnerOptions (run_command timeout and ticket source) from main. The gate call and the rest of the file are unchanged (AC9). | T7 |
| tests/unit/tool-reachability.test.ts | created | Router-level test: every new tool, called by every job through the real gate, is denied and never reaches the runner, with no trace on disk; reader + read_file still runs; dispatch, guard failures, unknown names and the timeout and ticket options (AC9). | T7 |
| docs/specs/p2-tools/tasks.md | edited | Ticked the task boxes as each check passed. | T1, T2, T3, T4, T5, T6, T7 |
