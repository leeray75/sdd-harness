# Plan: p2-tools

Ticket: none (vibe planning; Phase 2, subtask 1)
Status: approved
Date: 2026-11-20

## Objective

The agent jobs need real tools before the policy engine can decide who may use which. This subtask builds the tools themselves:

- the tools run in the main process;
- each tool has a schema and an argument check in one shared registry;
- every tool stays inside the project root and refuses git;
- each tool has unit tests.

It makes nothing new reachable. The gate stays as it is, so only the reader's `read_file` can run until `p2-policy-engine` adds the per-job table.

## Scope

- **In:**
  - A shared tool registry, `src/shared/tools.ts`. Shared code must not import Node or Electron.
    - Each tool has a name, a description, a JSON schema for its arguments, and a hand-written args guard in the style of D19.
    - The registry exports the list of tool names.
  - Seven tools, with runners in `src/main/tools/`:
    - `read_file { path }`: exists today. Its args check moves into the registry; its behaviour is unchanged.
    - `list_files { pattern?, path? }`: walks the root with `node:fs` and returns the matching file paths, relative to the root and sorted.
      - Glob support: `*`, `**`, `?`, written in-house.
      - Skips `.git` and `node_modules`, and never follows a symlink out of the root.
      - Capped at 1,000 entries; if more match, it says the list was cut.
    - `search_text { pattern, path?, glob? }`: searches files with a JavaScript regex and returns `path:line: text` lines.
      - Uses the same walk and skips as `list_files`.
      - Skips binary files and files over 1 MiB.
      - Capped at 200 matches and at 64 KiB of output.
      - A regex that fails to compile is a `failed` result.
    - `write_file { path, content }`: creates or overwrites one file inside the root.
      - Creates missing parent folders inside the root.
      - Writes to a temporary file, then renames it into place.
      - Refuses content over 1 MiB.
    - `edit_file { path, old_text, new_text, replace_all? }`: an exact string replacement in an existing file.
      - Without `replace_all`, `old_text` must occur exactly once.
      - Refuses when `old_text` is not found, or is empty.
      - Writes the same way as `write_file`.
    - `run_command { program, args, cwd? }`: spawns `program` with an `args` array, never through a shell.
      - `cwd` is relative to the root and must stay inside it.
      - Timeout: 10 minutes by default, overridable by the caller in main (not by the agent).
      - Combined output is capped at 64 KiB; the tail is kept and the result says it was cut.
      - The environment is minimal: PATH, plus the variables each OS needs to start a process (`SystemRoot`, `TEMP`, `TMP`, `HOME` or `USERPROFILE`). The app's other variables and keys are never passed.
      - The result reports the exit code (or the signal or the timeout) and the output.
    - `read_ticket { id }`: an interface only.
      - A `TicketSource` type, and a runner that takes one.
      - The default source answers that no tracker is configured.
      - The output wraps ticket text in an explicit "untrusted data" frame.
  - Shared path rules for every file tool (one module, `src/main/tools/paths.ts`, taking over `isInside` from `read-file.ts`):
    - paths are relative;
    - a path resolves inside the root after real paths are resolved, including the parent folder of a file that doesn't exist yet;
    - any path with a `.git` segment is refused, case-insensitively;
    - reasons are fixed strings that never echo the path or the contents.
  - Git refusal in `run_command`:
    - The program is refused when its base name is `git`, ignoring case and a `.exe`, `.cmd` or `.bat` extension.
    - `cwd` follows the same `.git` path rule.
  - Dispatch: `makeToolRunner` in `src/main/agent/host.ts` dispatches every registry tool to its runner by name, after the registry's args guard passes. An unknown name or bad args gives a `failed` result.
  - Unit tests for every tool, the path rules, the guards and the dispatch. The existing `read-file` tests keep passing.
- **Out:**
  - Any gate change. `checkToolCall` still allows only `reader` with `read_file` (`p2-policy-engine`).
  - Per-job tool sets, the spec-folder and source rules, project tightening and Rule events (`p2-policy-engine`).
  - The command allowlist and its detection, the read-only spec folder while commands run, the changed-file check and revert, and network limits (`p2-command-allowlist`).
  - Advertising the new tools to models, and the agent loop's tool list (`p2-jobs-and-prompts`). The loop keeps advertising only `read_file`.
  - A real tracker client, and any UI.
  - Delete and move tools.

## Decisions

| Question | Decision | Alternatives considered |
| --- | --- | --- |
| Tool set | Seven tools: read_file, list_files, search_text, write_file, edit_file, run_command, read_ticket (interface) | Five coarse tools (read, find, write, run_command, read_ticket); seven plus delete_file and move_file |
| Reachability | Runners, schemas and dispatch only. The gate is unchanged, so nothing new is reachable until p2-policy-engine | A temporary gate that allows the new tools now |
| run_command shape | Program plus an args array, no shell. Cwd inside the root, a timeout, an output cap, a minimal environment. Allowlist and limits come in p2-command-allowlist | A shell command string; leave run_command for p2-command-allowlist |
| list and search implementation | Pure Node with caps, skipping .git and node_modules, no symlinks out of the root | Bundle ripgrep per OS |
| Where schemas live | One shared registry, `src/shared/tools.ts`, with JSON schemas and hand-written guards | Schemas next to each runner in main |
| .git defence | The tools themselves refuse any `.git` path segment, and refuse `git` as a program, under the policy engine | Policy engine only |
| Slug and branch (default) | `p2-tools` on `feature/p2-tools` from `main` | none |
| Output cap (default) | The existing 64 KiB (`MAX_TOOL_OUTPUT_LENGTH`) for every tool | none |

## Approach

1. **Registry.** `src/shared/tools.ts`: the tool names as a const tuple, a `ToolSpec` per tool (name, description, JSON schema) and a guard per tool. Each guard rejects unknown keys, wrong types and over-long strings, using the existing `MAX_STRING_LENGTH` where it applies (content gets its own 1 MiB limit). Tests in `tests/unit/tool-registry.test.ts`.
2. **Path rules.** `src/main/tools/paths.ts`: `resolveInRoot(root, path, { mustExist })` and the `.git` check. `read-file.ts` uses it, and its tests stay green.
3. **Read tools.** `list-files.ts` and `search-text.ts`, sharing one walker. Tests use temp folders: symlinks (skipped where the OS can't create them), caps, skipped folders and binary files.
4. **Write tools.** `write-file.ts` and `edit-file.ts`, with the temp-and-rename write. Tests cover escapes, `.git`, parent creation, the uniqueness rule and the size limit.
5. **run_command.** `run-command.ts` using `child_process.spawn` with `shell: false`, the minimal env, a timeout that kills the process tree, and the output tail cap. Tests run `process.execPath` with small scripts, so they work on all three OSes, and cover the git refusal and the timeout.
6. **read_ticket.** `read-ticket.ts`: the `TicketSource` interface, the not-configured default and the untrusted-data frame.
7. **Dispatch.** `makeToolRunner` uses the registry: guard, then runner. Tests confirm the gate still denies every new tool, end to end through the router.

## Verified assumptions

| Assumption | Evidence |
| --- | --- |
| The four job ids already exist in the protocol | `src/shared/agent-protocol.ts:9` `JOB_IDS = ['planner','writer','reviewer','reader']` |
| The gate denies by default and allows only reader/read_file | `src/main/policy/gate.ts:3`, `:28` |
| Allowed calls run through an injected runner that dispatches by tool name | `src/main/agent/host.ts:49` `makeToolRunner`, `src/main/agent/router.ts` `ToolRunner` |
| The router already caps output at 64 KiB and never logs args or output | `src/shared/agent-protocol.ts:20` `MAX_TOOL_OUTPUT_LENGTH`; `router.ts` comment and `runAllowed` |
| The existing root-containment logic can be shared | `src/main/tools/read-file.ts:29` `isInside`, `:73`, `:84` |
| The agent loop advertises only `read_file` today | `src/agent/loop.ts:21`, `:77` |
| The tool root comes from `HARNESS_SPIKE_ROOT` for now | `src/main/agent/host.ts:17`, `:124` |
| No new runtime dependency is needed | `package.json` dependencies: `@anthropic-ai/sdk`, `openai` only |

## Risks

- **Windows `.cmd` shims.** Without a shell, `spawn` can't run `.cmd` or `.bat` files: since the 2024 security fix, Node refuses them when `shell` is false. Common commands like `pnpm test` are `.cmd` shims on Windows, so `run_command` returns a clear `failed` reason for them in this subtask. How detected commands run on Windows is settled in `p2-command-allowlist`. A Windows CI test shows it early.
- **Symlink tests on Windows.** Creating symlinks may need Developer Mode on Windows. Those tests skip with a note when creation fails, and Linux and macOS CI still cover them.
- **Killing the process tree on timeout.** This differs by OS (`taskkill /T` on Windows, a process group elsewhere). A timeout test with a child that spawns a grandchild shows it in CI on all three OSes.
- **Rename over an open file on Windows.** This can fail with `EPERM`. The write retries briefly, then returns `failed`.

## Open questions

- How `run_command` runs `.cmd`/`.bat` commands on Windows. Deferred to `p2-command-allowlist`.
