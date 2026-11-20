# Summary Report: p2-command-allowlist
Ticket: none   Date: 2026-11-20
Outcome: Clean
Review rounds: 2 of 3 per revision; revisions: 0 of 2
Models: implementor haiku; reviewer sonnet; data agent not used (all chosen by the user); respawns: none

## What was built

- **G1 (allowlist):**
  - `detectCommands` finds test and build forms for Node (the package manager comes from `packageManager` or the lockfile), Python, Go and Rust.
  - `makeCommandCheck` allows the writer the test and build forms, and the reviewer the test forms only. Matching is exact and runs from the root only, and every refusal has a fixed reason.
  - The host builds the gate's context and the runner's second check from the same detected allowlist. With no root it keeps the deny-all default.
- **G2 (Windows):**
  - Main resolves the program on `PATH`, using `PATHEXT` on Windows.
  - An allowlisted `.cmd`/`.bat` runs through `cmd.exe /d /s /c`. The line is built only from safe tokens and a safe path, and wrapped in one more pair of quotes so paths with spaces work.
- **G3 (file protection):**
  - While a command runs, `docs/specs/` is snapshotted and made read-only, and the `.git` key files are snapshotted.
  - For the reviewer, every file that isn't git-ignored is snapshotted too. Main finds the ignored set with a read-only git query and falls back when git is missing. The snapshot is capped at 256 MiB.
  - Afterwards the modes are put back and changes are reverted, always, in a `finally`.
- **G4 (network):**
  - The writer's commands run under `unshare` on Linux or `sandbox-exec` on macOS when a probe shows the method works. Dead proxy variables and offline flags are added on every OS.
  - The level reached, `os` or `proxy-only`, is reported.
- **G5 (reporting):**
  - New `revert` and `network` Rule event kinds.
  - The tool result gets fixed "reverted changes in …" lines.

## Files changed

Product files (group 1):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/main/commands/detect.ts | created | Test and build detection for Node, Python, Go and Rust, with a root-backed marker reader (size cap, no symlinks) and a structural TOML check (AC1) | T1 |
| src/main/policy/command-allowlist.ts | created | `makeCommandCheck`: six ordered steps with fixed reasons and exact matching on the base name (AC2) | T2 |
| src/main/commands/lookup.ts | created | `resolveProgram` (PATH, PATHEXT) and the `cmd.exe` line builder with the token and path rules. The outer quote pair was added in round 1 (AC4) | T3, R1-1 |
| src/main/commands/protect.ts | created | Protected set per job, the cap, the read-only lock, the read-only git ignore query and fallback, and the restore of contents, modes, created and deleted paths (AC5–AC8) | T4, T6 |
| src/main/commands/network.ts | created | The pure wrapper choice, the probes, the macOS profile, the Linux loopback step, and the writer's proxy and offline variables (AC9) | T5 |
| src/main/tools/run-command.ts | edited | The full order: git refusal, the check again, lookup, the cmd line, snapshot and cap, the network wrapper, the lock, the run, and the restore in `finally`. It emits the events and the result lines | T3, T7 |
| src/main/agent/router.ts | edited | The `ToolRunner` call carries the job (AC10) | T3 |
| src/main/agent/host.ts | edited | `commandPolicyFor(root)`; the runner and the gate context share the detected check and the event sink (AC3) | T3, T7 |
| src/main/policy/rule-event.ts | edited | `RuleEvent` is now a union of decision, revert (with an action) and network events, with formatting, sanitizing and log levels | T6 |
| src/main/policy/gate.ts | edited | The decision carries a `DecisionEvent` (the union's decision kind); callers unchanged | T6 |
| src/main/log.ts | edited | A warn level for the proxy-only network event | T6 |
| tests/unit/command-detect.test.ts | created | AC1 | T1 |
| tests/unit/command-allowlist.test.ts | created | AC2 | T2 |
| tests/unit/command-lookup.test.ts | created | AC4, including the Windows `.cmd` stub and spaced-folder runs | T3, R1-1 |
| tests/unit/command-protect.test.ts | created | AC5–AC7 at module level, with the cap boundary | T4 |
| tests/unit/command-network.test.ts | created | AC9: choice matrix, wrapper args, profile, env, probes, and a real-OS run (skipped here) | T5 |
| tests/unit/command-acceptance.test.ts | created | AC3, AC5–AC10 end to end with Node stub commands on temp roots | T7 |
| tests/unit/policy-gate.test.ts | edited | AC3 gate cases | T2 |
| tests/unit/policy-rule-events.test.ts | edited | Revert and network event tests | T6 |
| tests/unit/tool-command.test.ts | edited | Runner tests through an allowing wrapper; `.cmd` decided by the check; PATH-miss reason | T3 |
| tests/unit/tool-reachability.test.ts | edited | Direct calls act as the writer through a wrapper | T3 |
| tests/unit/agent-router.test.ts | edited | The runner call includes the job; the decision kind is narrowed | T3, T6 |
| tests/unit/policy-acceptance.test.ts | edited | The decision kind is narrowed (union) | T6 |
| docs/decisions.md | edited | New D31; D29's open question settled by D31 (AC11) | T8 |
| CHANGELOG.md | edited | Unreleased entries under Added, Changed and Known issues; the Windows `.cmd`/`.bat` known issue removed (AC12) | T9 |
| docs/agent-commands.md | created | New reference page: commands per job and project type, protection and reverts, the network limit per OS, and crash recovery (AC12) | T9 |
| CLAUDE.md | edited | The command rule added to the rules that must hold (AC12). The diff also holds the docs-in-every-spec convention, which the orchestrator added during planning at your request | T9, planning |
| docs/PRD.md | edited | The F1 "Commands" line describes the detected allowlist and the network levels (AC12) | T9 |
| docs/phases/phase-02-tool-policy.md | edited | The network decision is marked settled (AC12). The diff also holds the orchestrator's docs-convention note from planning | T9, planning |
| docs/phases/phase-02-progress.md | edited | Follow-ups settled by this work struck through; D31 listed. The status and commit row are left for after the merge (AC12) | T9 |

`README.md` and `docs/workflow.md` were checked and left unchanged: they already match D31.

Workflow files (group 2):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| docs/specs/p2-command-allowlist/PLAN.md | created | Approved plan | planning |
| docs/specs/p2-command-allowlist/SPECS.md | created | Approved spec | planning |
| docs/specs/p2-command-allowlist/SUBTASK.md | created | Child-ticket draft, not published (no tracker) | planning |
| docs/specs/p2-command-allowlist/tasks.md | created | Tasks T1–T10, all ticked | T1–T10 |
| docs/specs/p2-command-allowlist/build-ledger.md | created | Build ledger | build |
| docs/specs/p2-command-allowlist/changes.md | created | The implementor's change rows and the stale-doc check table | build |
| docs/specs/p2-command-allowlist/SUMMARY.md | created | This report | build |

## Acceptance criteria

| AC | Status | Evidence |
| --- | --- | --- |
| AC1 detection | Met | `detect.ts`; `command-detect.test.ts` (exact forms for every type and package-manager source; invalid and missing markers) |
| AC2 check | Met | `command-allowlist.ts`; `command-allowlist.test.ts` (each step and exact reason, case and extension rules, no echo) |
| AC3 gate and host | Met | `policy-gate.test.ts` (allow and deny events); `command-acceptance.test.ts` (`commandPolicyFor`) |
| AC4 lookup and Windows | Met on Windows | `lookup.ts`; `command-lookup.test.ts`. The `.cmd` stub and the spaced-folder stub ran here through `cmd.exe` |
| AC5 spec lock and restore | Met | `command-acceptance.test.ts`: read-only during the run; bytes and modes identical after; exact revert events |
| AC6 `.git` key files | Met | `command-acceptance.test.ts`: HEAD, a ref and a hook restored; an added hook removed; the index untouched |
| AC7 reviewer revert | Met | `command-acceptance.test.ts` with a real git repo; the no-git fallback; the cap refused before start |
| AC8 restore always | Met | Timeout and start-failure tests restore the tree and the modes |
| AC9 network | Met for the choice and env; OS block not run here | `command-network.test.ts`; writer-only env and one network event in `command-acceptance.test.ts`. The real `unshare` and `sandbox-exec` runs are skipped on Windows |
| AC10 router | Met | `agent-router.test.ts`, `command-acceptance.test.ts` |
| AC11 D31 | Met | `docs/decisions.md` D31; D29's open question points to it |
| AC12 changelog and docs | Met | `CHANGELOG.md`, the new `docs/agent-commands.md`, stale docs updated; the check list in `changes.md` |
| AC13 checks | Met on Windows | The orchestrator re-ran typecheck, lint, format:check and test: all pass, 46 files, 1030 passed, 12 skipped. macOS and Linux run in CI |

## Needs a runtime check

- **Linux and macOS network block:** the `unshare` wrapper (loopback brought up) and the `sandbox-exec` profile are unit-tested for their arguments only. Their real-OS tests skip on this Windows machine. Check that they run and pass in CI on Linux and macOS.
- **Git with the minimal environment:** on a real repo, git may stop on "dubious ownership" or a missing HOME. The code then falls back to skipping only `node_modules` and `.git`, so the reviewer would see ignored files reverted. Worth one check on a real project.
- **The symlink restore case** is skipped here, because this machine can't create symlinks.
- **`startAgentHost`** needs Electron and has no unit test. `commandPolicyFor` is tested, and the wiring was checked by reading it.

## Review ledger

### Revision 0, round 1  (ISSUES)

| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| R1-1: the `cmd.exe` line breaks for a shim path that has a space. `/s` strips the first and last quote, which unquotes the path | major | src/main/commands/lookup.ts:119; run-command.ts:312-317 | ACCEPT | Reproduced first with a new Windows test, which failed | The line is wrapped in one more pair of quotes, the tests are updated, and a spaced-folder `.cmd` run test is added |

### Revision 0, round 2  (PASS)

The reviewer confirmed the fix. It then said it had not opened several test files in round 1, although it had claimed it had. The orchestrator had it read all of them before round 2 was recorded. The combined round 2 is PASS with no findings, and it maps each of AC1–AC10 to assertions that would fail on wrong behaviour.

| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| (none) | | | | | |

## Spec revisions

none

## Rejected findings

none

## Open issues

none

The implementor reported these deviations; the reviewer found none in conflict with the spec:

- **Events:** the revert event has an extra `action` field (`restored`, `re-created` or `deleted`). Folders that are re-created or deleted also get one event each.
- **Extra fixed reasons:**
  - a failed lock;
  - a snapshot read failure;
  - a non-command job reaching the runner;
  - the result line "some protected files could not be put back" for a partial restore. That case is not a Rule event; it is listed in the CHANGELOG known issues.
- **The git-ignore query** runs again after `.gitignore` is restored, so an ignored file the command created is kept. If that query fails, the restore falls back to the snapshot's set.
- **`resolveProgram`** treats a program that contains a separator as a file. Production can't reach this, because the check denies separators first.
- **Detection** is synchronous. `pyproject.toml` gets a structural check, not a full TOML parser, and marker symlinks aren't followed.
- **`programRefusal`** no longer takes a platform or refuses `.cmd` by name; the check and the cmd rule decide.
- **The T9 check** names `git diff --stat` for a new file; only `git status` shows it until the file is staged.

## Git state

feature/p2-command-allowlist; approved; committed and pushed in the commit that adds this report

## Next steps

Approve, then commit and push. Or request changes, or say not yet.
