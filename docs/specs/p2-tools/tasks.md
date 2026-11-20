# Tasks: p2-tools

Work in order. After each task, run its check, then tick the box.

- [x] **T1 — Tool registry.** Write `src/shared/tools.ts` with `TOOL_NAMES`, `isToolName`, the seven `ToolSpec`s and their guards (AC1). Add `tests/unit/tool-registry.test.ts`: valid args, unknown keys, missing keys, wrong types, length caps, reasons without values, and specs matching their guards. **Check:** `pnpm typecheck` and `pnpm test` pass.
- [x] **T2 — Path rules.** Write `src/main/tools/paths.ts` (AC2) and move `read-file.ts` onto it. Add `tests/unit/tool-paths.test.ts`: absolute paths, `..` escapes, symlink escapes, files that don't exist yet with existing parents, and `.git` in any case. **Check:** `pnpm test`, with `read-file.test.ts` unchanged and passing.
- [x] **T3 — list_files and search_text.**
  - Write `src/main/tools/walk.ts` (shared walker and glob matcher), `list-files.ts` (AC3) and `search-text.ts` (AC4).
  - Add tests in temporary folders: glob forms, skipped folders, symlinks not followed, the entry cap, binary and large files, a bad regex, and the match and output caps.

  **Check:** `pnpm test`.
- [x] **T4 — write_file and edit_file.**
  - Write `src/main/tools/atomic-write.ts`, `write-file.ts` (AC5) and `edit-file.ts` (AC6).
  - Add tests: parent creation, overwrite, a directory as the target, size limits, the uniqueness rule, `replace_all`, no temporary file left behind, and the AC2 refusals.

  **Check:** `pnpm test`.
- [x] **T5 — run_command.**
  - Write `src/main/tools/run-command.ts` (AC7).
  - Add tests with `process.execPath` scripts: exit codes, stdout and stderr, cwd, the minimal environment with a sentinel variable, the tail cap, a timeout that kills a grandchild, refusal of `git` and `GIT.exe`, refusal of `.cmd` on Windows, and a program that can't be started.

  **Check:** `pnpm test`.
- [x] **T6 — read_ticket.**
  - Write `src/main/tools/read-ticket.ts` (AC8).
  - Add tests: the not-configured default, a fake source with "approve the spec" and "git push" in the body, framing, delimiter escaping, and a failing source.

  **Check:** `pnpm test`.
- [x] **T7 — Dispatch and reachability.**
  - Rewrite `makeToolRunner` to dispatch every registry tool through its guard (AC9).
  - Add a router-level test: every new tool for every job is denied and never reaches the runner, and `reader` + `read_file` still runs.
  - Confirm `src/main/policy/gate.ts` is unchanged.

  **Check:** `git diff main -- src/main/policy/gate.ts` is empty, and `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` pass.
