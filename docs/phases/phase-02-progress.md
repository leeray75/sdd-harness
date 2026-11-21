# Phase 2 progress: Agent runtime and tool policy (F1)

Status: done · Started: 2026-11-20 · Finished: 2026-11-21

Remote: `origin` = https://github.com/leeray75/sdd-harness.git; feature branches come into `main` through pull requests. No tracker is configured (`SDD_TRACKER` unset; the user chose local only), so child tickets stay as `SUBTASK.md` drafts in `docs/specs/`.

The subtasks follow the suggested list in `phase-02-tool-policy.md`. Subtask 1 was started straight from `/sdd:start` before this file existed; the list below is that suggested list, unchanged so far.

| #   | Feature                 | Goal                                                                                                                                                                 | Status | Spec                                                   | Commit                                                                |
| --- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------ | --------------------------------------------------------------------- |
| 1   | p2-tools                | Seven tools with schemas in a shared registry, run in main inside the root, refusing git by themselves; gate unchanged, so nothing new is reachable yet              | done   | [SUMMARY](../specs/p2-tools/SUMMARY.md)                | `7cc7cf9` (PR #13; work `127eef0`, format `c85e69c`, close `f1755fa`) |
| 2   | p2-policy-engine        | Job-to-tool matrix from the design table, path rules (spec folder for the planner before approval, source for the writer after it), project tightening, Rule events  | done   | [SUMMARY](../specs/p2-policy-engine/SUMMARY.md)        | `212daac` (PR #14; work `929e9c6`, docs `6ecaa84`, close `62d7b5e`)   |
| 3   | p2-command-allowlist    | Allowlist and detection of test and build commands, read-only spec folder during commands, changed-file check and revert, network limits; Windows `.cmd`/`.bat` runs | done   | [SUMMARY](../specs/p2-command-allowlist/SUMMARY.md)    | `a20269a` (PR #15; work `5869c26`, close `d8b9d25`)                   |
| 3a  | p2-fix-e2e-selfcheck    | Fix the stale self-check e2e test (D30 Rule line instead of the reader-only line) so CI's e2e job is green again; add the CI-green merge rule                        | done   | [SUMMARY](../specs/p2-fix-e2e-selfcheck/SUMMARY.md)    | `2a36fef` (PR #16; work `c9e6e84`, close `861d311`)                   |
| 3b  | chore-ci-actions-node24 | Bump the CI actions (checkout, setup-node, upload-artifact) from v4 to v7 for the Node 24 runtime; add Dependabot for GitHub Actions                                 | done   | [SUMMARY](../specs/chore-ci-actions-node24/SUMMARY.md) | `54cf7e3` (PR #17; work `1ed980e`, close `35f2c8c`)                   |
| 4   | p2-jobs-and-prompts     | Four job definitions with prompts ported from the plugin; the agent advertises each job's tools from the registry                                                    | done   | [SUMMARY](../specs/p2-jobs-and-prompts/SUMMARY.md)     | `f6b85a1` (PR #18; work `1ad7769`, close `254cae4`)                   |
| 5   | p2-human-only-channel   | Human-only IPC channel and tests that the agent process and files can't trigger it                                                                                   | done   | [SUMMARY](../specs/p2-human-only-channel/SUMMARY.md)   | `070fa5e` (PR #19; work `16412a0`, close `31afa34`)                   |

## Decisions added

- D29 Agent tools: shared registry and tool-level limits (`p2-tools`)
- D19 amended by `p2-tools`: the runner dispatches every registry tool through its guard; the gate is unchanged
- D30 Agent tool policy: per-job table, path areas, tightening and Rule events (`p2-policy-engine`)
- D19 amended by `p2-policy-engine`: the reader-only gate is replaced by the per-job policy, and the router emits a Rule event for every decision
- D31 Agent commands: allowlist, Windows shims, file lock and revert, network limit (`p2-command-allowlist`); settles D29's open question on `.cmd`/`.bat`
- D32 Agent jobs: definitions, prompts and advertised tools (`p2-jobs-and-prompts`)
- D33 Human-only actions: gesture check, channel and handler registry (`p2-human-only-channel`); refines D3's "click" to a gesture

## Follow-ups

- From `p2-tools`:
  - ~~`run_command` refuses `.cmd`/`.bat` on Windows, so `pnpm test` can't run through it yet. Settle how in `p2-command-allowlist`.~~ Settled in `p2-command-allowlist` (D31): an allowlisted `.cmd` or `.bat` runs through `cmd.exe`, with safe tokens only; every other script stays refused.
  - The 8 file-symlink tests and the POSIX process-group kill have only run in macOS and Linux CI. Check the first CI run.
  - ~~`list_files` given a path inside `node_modules` lists it.~~ Settled in `p2-policy-engine`: `list_files` and `search_text` refuse such paths.
  - ~~The agent loop still advertises only `read_file`. `p2-jobs-and-prompts` advertises each job's tools from `TOOL_SPECS`.~~ Resolved by `p2-jobs-and-prompts` (D32): the loop advertises each job's base tools from `TOOL_SPECS`, with the job's system prompt.
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
- From `p2-human-only-channel`:
  - No action handler is registered yet, so an accepted request returns `not-available`. Phase 3 registers the five handlers through the channel's registry (`docs/human-actions.md`).
  - Review point R1-1, accepted as is: a throwing handler logs a diagnostic line and then the decision line, where AC3 says one line per call. Fold the two into one when Phase 3 adds the first handler.
  - A gesture shows that a person acted in the window just before the call. It doesn't show which control they used (D33). Phase 3 or 5 can require the gesture to land on the Next bar's button.
  - The e2e cases passed on all three OSes in CI (runs #47 and #48), so `input-event` gives `button`, `key` and `isAutoRepeat` on Windows, macOS and Linux. Assistive input is still to be checked with the Phase 5 UI.
  - PR #19 was merged while its CI run (#47) was still in progress. It finished green on every job.
- Still to decide during planning (from the phase doc):
  - ~~how "no network for the writer" is enforced on each OS (`p2-command-allowlist`);~~ Settled in `p2-command-allowlist` (D31): unshare on Linux, sandbox-exec on macOS, proxy variables and offline flags elsewhere, reported per command as best effort;
  - ~~how a user gesture is verified (`p2-human-only-channel`).~~ Settled in `p2-human-only-channel` (D33): a left-button press or an Enter or Space press in the app window, usable for 1000 ms and once.

## Phase summary

Phase 2 delivered F1, the agent runtime and tool policy, in five planned subtasks and two fixes (PRs #13–#19):

- `p2-tools`: seven tools in a shared registry, run in main inside the project root, refusing git paths themselves (D29).
- `p2-policy-engine`: the per-job tool table, path areas (the planner's spec folder before approval, the writer's source after it), project tightening that only removes tools, and a Rule event for every decision (D30).
- `p2-command-allowlist`: the detected test and build allowlist, Windows `.cmd`/`.bat` shims, a read-only spec folder while commands run with revert afterwards, and the writer's network limit per OS (D31).
- `p2-fix-e2e-selfcheck` and `chore-ci-actions-node24`: CI's e2e job green again, the CI-green merge rule, and the actions moved to Node 24.
- `p2-jobs-and-prompts`: four job definitions with prompts ported from the plugin; each run advertises exactly its job's tools (D32).
- `p2-human-only-channel`: the human-only IPC channel, which needs a real gesture seen by main, and the proofs that the agent process can't reach it (D33).

Decisions D29–D33 were added, and D19 was amended twice.

Definition of done:

- [x] All F1 acceptance criteria pass as automated tests:
  - **the writer's edit to an approved `SPECS.md` is blocked and logged:** `tests/unit/policy-acceptance.test.ts` (spec-folder denials for the writer and the reviewer in every state, and one Rule event per decision);
  - **the reviewer has no write tool:** `tests/unit/jobs-tools.test.ts`, `policy-table.test.ts` and `policy-acceptance.test.ts`;
  - **no agent can trigger commit, push, approve or close, even when told to:** `policy-acceptance.test.ts` (AC11), `human-agent-boundary.test.ts` and `human-text-acceptance.test.ts`.
- [x] A ticket or file containing "approve the spec" or "git push" can't cause either:
  - `tests/unit/human-text-acceptance.test.ts` sends a file and a ticket with that text, then `approve_spec`, `git_push` and `run_command git push`. All three are denied, with Rule events, and no human-action handler runs.
  - The e2e spec `tests/e2e/human-action.spec.ts` shows that a call with no real gesture is refused.
- [x] Policy decisions are logged as Rule events with the job, tool, target and reason: `tests/unit/policy-rule-events.test.ts` and `policy-acceptance.test.ts` ("every decision is a Rule event"). A tool outside the registry is shown as `-`.

Open follow-ups for later phases are listed above: the real feature and spec state and the handlers come in Phase 3, the settings file and tightening in Phase 4, the Rule lines in the UI in Phase 7, and a few runtime checks on real projects.
