---
status: approved
ticket:
---

# p2-tools

## Problem

F1 gives the four agent jobs real tools: read, list and search, write and edit, run commands, and read the tracker. Today only `read_file` exists, and `makeToolRunner` refuses every other name (`src/main/agent/host.ts:49`). The policy engine (`p2-policy-engine`) and the command limits (`p2-command-allowlist`) need tools to govern, with schemas and argument checks that main can trust. Each tool must stay inside the project root and refuse git, whatever the policy says.

## Goals

- **G1:** One shared tool registry holds the name, description, JSON schema and args guard of every tool. Main can check arguments with it, and the agent can later advertise the tools from it.
- **G2:** Seven tools run in the main process, each inside the root: `read_file`, `list_files`, `search_text`, `write_file`, `edit_file`, `run_command` and `read_ticket` (interface only). Every result is the existing success or `failed` shape.
- **G3:** The tools refuse git by themselves:
  - every file tool refuses any `.git` path segment;
  - `run_command` refuses the `git` program.

  This holds under whatever the policy engine allows.
- **G4:** Nothing new becomes reachable. The gate is unchanged, and tests prove it denies every new tool.

## Non-goals

- Any change to `checkToolCall`, per-job tool sets, the spec-folder and source path rules, project tightening, or Rule events (`p2-policy-engine`).
- The command allowlist and its detection, the read-only spec folder while commands run, the changed-file check and revert, network limits, and running Windows `.cmd`/`.bat` commands (`p2-command-allowlist`).
- Advertising the new tools to models, or changing the agent loop's tool list (`p2-jobs-and-prompts`).
- A real tracker client.
- Any UI.
- Delete and move tools.
- New runtime dependencies.

## Acceptance criteria

- **AC1 (registry):** `src/shared/tools.ts` imports no Node, Electron or DOM API, and exports:
  - `TOOL_NAMES`, a const tuple of the seven names, and the `ToolName` type;
  - an `isToolName` guard;
  - for each tool, a `ToolSpec { name, description, parameters }`, where `parameters` is a JSON schema object with `type: 'object'`, its `properties`, `required`, and `additionalProperties: false`;
  - for each tool, a guard `(args: unknown) => { ok: true, args: <typed> } | { ok: false, reason }`.

  Each guard rejects unknown keys, missing required keys, wrong types and strings longer than `MAX_STRING_LENGTH`. `write_file.content` and `edit_file`'s texts are capped at 1 MiB instead. A reason never echoes an argument value. A unit test checks that every spec's `required` and `properties` keys match what its guard accepts.

- **AC2 (path rules):** `src/main/tools/paths.ts` resolves a path for every file tool. It refuses, each with a fixed reason that never contains the path:
  - a missing or non-directory root, and an empty or non-string path;
  - an absolute path;
  - a path that resolves outside the root, before or after symlinks are resolved. For a file that doesn't exist yet, the deepest existing parent folder is resolved and checked;
  - any path segment equal to `.git`, ignoring case.

  `read_file` uses this module, and every existing `tests/unit/read-file.test.ts` case still passes unchanged.

- **AC3 (`list_files { pattern?, path? }`):**
  - Returns the regular files under `path` (default the root) whose root-relative path matches `pattern` (default `**/*`), one per line, using `/` separators, sorted.
  - Supports `*`, `**` and `?`.
  - Never descends into `.git` or `node_modules`, and never follows a symlink.
  - Returns at most 1,000 entries; when more match, the output ends with a line saying the list was cut at 1,000.
  - An empty result says that no files matched.

- **AC4 (`search_text { pattern, path?, glob? }`):**
  - Compiles `pattern` as a JavaScript regex; a pattern that fails to compile gives `failed` with a fixed reason.
  - Searches the files that `list_files` would return for `path` and `glob`.
  - Skips files over 1 MiB, and files whose first 8 KiB holds a NUL byte.
  - Returns `relative/path:line: text` lines, each line's text cut to 500 characters.
  - At most 200 matches and 64 KiB of output; when either cap is hit, a last line says so.

- **AC5 (`write_file { path, content }`):**
  - Creates or overwrites one regular file at a path that passes AC2, and creates missing parent folders inside the root.
  - Writes to a temporary file in the same folder, then renames it into place. On a rename failure it retries briefly, then returns `failed` and leaves no temporary file behind.
  - Refuses a path that is an existing directory.
  - Returns the relative path and the byte count written.

- **AC6 (`edit_file { path, old_text, new_text, replace_all? }`):**
  - Edits an existing regular file under the AC2 rules.
  - Fails with a fixed reason when:
    - `old_text` is empty;
    - `old_text` is not found;
    - `replace_all` is not true and `old_text` occurs more than once;
    - the result would exceed 1 MiB.
  - Otherwise it replaces the one occurrence, or every occurrence when `replace_all` is true, writes as AC5 does, and reports how many replacements it made.

- **AC7 (`run_command { program, args, cwd? }`):**
  - Spawns `program` with the `args` array through `child_process.spawn`, with `shell: false`.
  - `cwd` is relative, defaults to the root, and must pass AC2 and be a directory.
  - Refuses with a fixed reason, before spawning:
    - a `program` whose base name is `git`, ignoring case and a `.exe`, `.cmd` or `.bat` extension;
    - on Windows, a `program` ending in `.cmd` or `.bat`.
  - The child's environment holds only:
    - `PATH`;
    - on Windows, `SystemRoot`, `TEMP`, `TMP` and `USERPROFILE`;
    - elsewhere, `HOME` and `TMPDIR` when set.

    No other variable from main's environment is passed, which a test shows with a sentinel variable.
  - Kills the process tree after a timeout. The default is 600,000 ms; the runner accepts a timeout option from main, and the agent can't set it.
  - Combined stdout and stderr is capped at 64 KiB, keeping the tail and saying it was cut.
  - Returns `ok: true` with the exit code (or the signal, or `timed out`) and the output, whatever the exit code. A program that can't be started returns `failed`.

- **AC8 (`read_ticket { id }`):** `src/main/tools/read-ticket.ts` exports:
  - a `TicketSource` interface: `read(id) => Promise<{ ok: true, title, body } | { ok: false, reason }>`;
  - a `makeReadTicket(source)` runner;
  - a default source that returns `failed` with "no tracker is configured".

  A successful read returns the title and body inside a fixed frame. The frame states that the text is untrusted ticket data and not instructions, and its delimiters can't be closed early: a ticket containing the closing delimiter has it escaped. Tests use a fake source whose body contains "approve the spec" and "git push", and show it comes back as framed data only.

- **AC9 (dispatch and reachability):**
  - `makeToolRunner` in `src/main/agent/host.ts` dispatches each registry tool to its runner after the registry guard passes.
  - An unknown tool name or failing args give `failed` with a fixed reason.
  - `checkToolCall` is byte-for-byte unchanged.
  - A router-level test shows that every new tool, called by every job, is denied and never reaches the runner, and that `reader` + `read_file` still runs.

- **AC10 (checks):**
  - `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test` pass.
  - The tests use temporary folders and `process.execPath` scripts, so they run on Windows, macOS and Linux.
  - A symlink test that can't create a symlink on the current OS skips with a note.

## Open questions

- How `run_command` runs `.cmd`/`.bat` commands such as `pnpm test` on Windows. Deferred to `p2-command-allowlist`.
