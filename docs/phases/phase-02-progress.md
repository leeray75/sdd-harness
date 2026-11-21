# Phase 2 progress: Agent runtime and tool policy (F1)

Status: in progress · Started: 2026-11-20

Remote: `origin` = https://github.com/leeray75/sdd-harness.git; feature branches come into `main` through pull requests. No tracker is configured (`SDD_TRACKER` unset; the user chose local only), so child tickets stay as `SUBTASK.md` drafts in `docs/specs/`.

The subtasks follow the suggested list in `phase-02-tool-policy.md`. Subtask 1 was started straight from `/sdd:start` before this file existed; the list below is that suggested list, unchanged so far.

| #   | Feature                 | Goal                                                                                                                                                                 | Status  | Spec                                                   | Commit                                                                |
| --- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------ | --------------------------------------------------------------------- |
| 1   | p2-tools                | Seven tools with schemas in a shared registry, run in main inside the root, refusing git by themselves; gate unchanged, so nothing new is reachable yet              | done    | [SUMMARY](../specs/p2-tools/SUMMARY.md)                | `7cc7cf9` (PR #13; work `127eef0`, format `c85e69c`, close `f1755fa`) |
| 2   | p2-policy-engine        | Job-to-tool matrix from the design table, path rules (spec folder for the planner before approval, source for the writer after it), project tightening, Rule events  | done    | [SUMMARY](../specs/p2-policy-engine/SUMMARY.md)        | `212daac` (PR #14; work `929e9c6`, docs `6ecaa84`, close `62d7b5e`)   |
| 3   | p2-command-allowlist    | Allowlist and detection of test and build commands, read-only spec folder during commands, changed-file check and revert, network limits; Windows `.cmd`/`.bat` runs | done    | [SUMMARY](../specs/p2-command-allowlist/SUMMARY.md)    | `a20269a` (PR #15; work `5869c26`, close `d8b9d25`)                   |
| 3a  | p2-fix-e2e-selfcheck    | Fix the stale self-check e2e test (D30 Rule line instead of the reader-only line) so CI's e2e job is green again; add the CI-green merge rule                        | done    | [SUMMARY](../specs/p2-fix-e2e-selfcheck/SUMMARY.md)    | `2a36fef` (PR #16; work `c9e6e84`, close `861d311`)                   |
| 3b  | chore-ci-actions-node24 | Bump the CI actions (checkout, setup-node, upload-artifact) from v4 to v7 for the Node 24 runtime; add Dependabot for GitHub Actions                                 | pending | [SUMMARY](../specs/chore-ci-actions-node24/SUMMARY.md) |                                                                       |
| 4   | p2-jobs-and-prompts     | Four job definitions with prompts ported from the plugin; the agent advertises each job's tools from the registry                                                    | pending |                                                        |                                                                       |
| 5   | p2-human-only-channel   | Human-only IPC channel and tests that the agent process and files can't trigger it                                                                                   | pending |                                                        |                                                                       |

## Decisions added

- D29 Agent tools: shared registry and tool-level limits (`p2-tools`)
- D19 amended by `p2-tools`: the runner dispatches every registry tool through its guard; the gate is unchanged
- D30 Agent tool policy: per-job table, path areas, tightening and Rule events (`p2-policy-engine`)
- D19 amended by `p2-policy-engine`: the reader-only gate is replaced by the per-job policy, and the router emits a Rule event for every decision
- D31 Agent commands: allowlist, Windows shims, file lock and revert, network limit (`p2-command-allowlist`); settles D29's open question on `.cmd`/`.bat`

## Follow-ups

- From `p2-tools`:
  - ~~`run_command` refuses `.cmd`/`.bat` on Windows, so `pnpm test` can't run through it yet. Settle how in `p2-command-allowlist`.~~ Settled in `p2-command-allowlist` (D31): an allowlisted `.cmd` or `.bat` runs through `cmd.exe`, with safe tokens only; every other script stays refused.
  - The 8 file-symlink tests and the POSIX process-group kill have only run in macOS and Linux CI. Check the first CI run.
  - ~~`list_files` given a path inside `node_modules` lists it.~~ Settled in `p2-policy-engine`: `list_files` and `search_text` refuse such paths.
  - The agent loop still advertises only `read_file`. `p2-jobs-and-prompts` advertises each job's tools from `TOOL_SPECS`.
- From `p2-policy-engine`:
  - ~~`run_command` reaches the context's command check, which refuses everything. `p2-command-allowlist` replaces it with the detected allowlist, for the writer (tests and build) and the reviewer (tests only).~~ Settled in `p2-command-allowlist` (D31): the host builds the check from the detected commands, and the gate and the runner both use it. With no root, it still refuses everything.
  - The host passes `DEFAULT_POLICY_CONTEXT` (no feature, spec `none`). Phase 3 supplies the real feature and spec state from the workflow, and Phase 4 the project's tightening, through `parseTightening`.
  - Rule events are only logged so far. The build view's Rule lines (Phase 7) will read them.
  - The symlink re-check cases need a platform that allows folder links. Check that they run in macOS and Linux CI.
- From `p2-command-allowlist`:
  - The real network block (Linux `unshare` with loopback, macOS `sandbox-exec`) is tested only for its arguments here. Its real-OS tests skip on Windows. Check that they run and pass in Linux and macOS CI.
  - Main runs git with the minimal environment to find ignored files. On a real repo it may stop on "dubious ownership" or a missing HOME and fall back, which would revert the reviewer's changes to ignored files. Check this once on a real project.
  - A restore that only partly succeeds adds a result line but no Rule event (a CHANGELOG known issue).
  - The host's command detection runs once at start. Phase 4's settings file can let users edit the allowlist.
- From `p2-fix-e2e-selfcheck`:
  - CI's `e2e` job was red on Windows, macOS and Linux from PR #14 (run #31) through PR #15, because `tests/e2e/agent-process.spec.ts` still expected the reader-only gate's `tool call denied` line, which D30 replaced. `p2-fix-e2e-selfcheck` updates the test, and that restores CI. Its PR must show a green run on every job before it is merged.
  - The rule that a pull request is merged only when its CI run is green is now in `CLAUDE.md` and the phase doc, and the result-approval and close messages name the CI state.
- Still to decide during planning (from the phase doc):
  - ~~how "no network for the writer" is enforced on each OS (`p2-command-allowlist`);~~ Settled in `p2-command-allowlist` (D31): unshare on Linux, sandbox-exec on macOS, proxy variables and offline flags elsewhere, reported per command as best effort;
  - how a user gesture is verified (`p2-human-only-channel`).

## Phase summary

(written when the phase is done)
