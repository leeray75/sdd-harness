# Phase 2 progress: Agent runtime and tool policy (F1)

Status: in progress · Started: 2026-11-20

Remote: `origin` = https://github.com/leeray75/sdd-harness.git; feature branches come into `main` through pull requests. No tracker is configured (`SDD_TRACKER` unset; the user chose local only), so child tickets stay as `SUBTASK.md` drafts in `docs/specs/`.

The subtasks follow the suggested list in `phase-02-tool-policy.md`. Subtask 1 was started straight from `/sdd:start` before this file existed; the list below is that suggested list, unchanged so far.

| #   | Feature               | Goal                                                                                                                                                                 | Status  | Spec                                            | Commit                                                                |
| --- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------- | --------------------------------------------------------------------- |
| 1   | p2-tools              | Seven tools with schemas in a shared registry, run in main inside the root, refusing git by themselves; gate unchanged, so nothing new is reachable yet              | done    | [SUMMARY](../specs/p2-tools/SUMMARY.md)         | `7cc7cf9` (PR #13; work `127eef0`, format `c85e69c`, close `f1755fa`) |
| 2   | p2-policy-engine      | Job-to-tool matrix from the design table, path rules (spec folder for the planner before approval, source for the writer after it), project tightening, Rule events  | done    | [SUMMARY](../specs/p2-policy-engine/SUMMARY.md) | `212daac` (PR #14; work `929e9c6`, docs `6ecaa84`, close `62d7b5e`)   |
| 3   | p2-command-allowlist  | Allowlist and detection of test and build commands, read-only spec folder during commands, changed-file check and revert, network limits; Windows `.cmd`/`.bat` runs | pending |                                                 |                                                                       |
| 4   | p2-jobs-and-prompts   | Four job definitions with prompts ported from the plugin; the agent advertises each job's tools from the registry                                                    | pending |                                                 |                                                                       |
| 5   | p2-human-only-channel | Human-only IPC channel and tests that the agent process and files can't trigger it                                                                                   | pending |                                                 |                                                                       |

## Decisions added

- D29 Agent tools: shared registry and tool-level limits (`p2-tools`)
- D19 amended by `p2-tools`: the runner dispatches every registry tool through its guard; the gate is unchanged
- D30 Agent tool policy: per-job table, path areas, tightening and Rule events (`p2-policy-engine`)
- D19 amended by `p2-policy-engine`: the reader-only gate is replaced by the per-job policy, and the router emits a Rule event for every decision

## Follow-ups

- From `p2-tools`:
  - `run_command` refuses `.cmd`/`.bat` on Windows, so `pnpm test` can't run through it yet. Settle how in `p2-command-allowlist`.
  - The 8 file-symlink tests and the POSIX process-group kill have only run in macOS and Linux CI. Check the first CI run.
  - ~~`list_files` given a path inside `node_modules` lists it.~~ Settled in `p2-policy-engine`: `list_files` and `search_text` refuse such paths.
  - The agent loop still advertises only `read_file`. `p2-jobs-and-prompts` advertises each job's tools from `TOOL_SPECS`.
- From `p2-policy-engine`:
  - `run_command` reaches the context's command check, which refuses everything. `p2-command-allowlist` replaces it with the detected allowlist, for the writer (tests and build) and the reviewer (tests only).
  - The host passes `DEFAULT_POLICY_CONTEXT` (no feature, spec `none`). Phase 3 supplies the real feature and spec state from the workflow, and Phase 4 the project's tightening, through `parseTightening`.
  - Rule events are only logged so far. The build view's Rule lines (Phase 7) will read them.
  - The symlink re-check cases need a platform that allows folder links. Check that they run in macOS and Linux CI.
- Still to decide during planning (from the phase doc):
  - how "no network for the writer" is enforced on each OS (`p2-command-allowlist`);
  - how a user gesture is verified (`p2-human-only-channel`).

## Phase summary

(written when the phase is done)
