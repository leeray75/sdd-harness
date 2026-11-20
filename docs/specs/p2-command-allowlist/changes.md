# Changes: p2-command-allowlist

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/main/commands/detect.ts | created | Detects test and build commands from Node, Python, Go and Rust markers, with a root-backed marker reader (size cap, no symlinks) and a structural TOML check for pyproject.toml. | T1 |
| tests/unit/command-detect.test.ts | created | AC1 tests: every type, every package-manager source, missing and invalid markers, a mixed repo, the root reader. | T1 |
| src/main/policy/command-allowlist.ts | created | The command check (makeCommandCheck): six ordered steps, fixed reasons, exact form matching on the base name. | T2 |
| tests/unit/command-allowlist.test.ts | created | AC2 tests: each step and reason, exact and case rules, no echo of the call. | T2 |
| tests/unit/policy-gate.test.ts | edited | Added AC3 gate cases with a detected allowlist: allow and deny events, reviewer tests-only reason, deny-all default kept. | T2 |
| src/main/commands/lookup.ts | created | resolveProgram (PATH, PATHEXT, platform and file probe as parameters), the cmd.exe line builder with the token and path rules, and cmd.exe and script helpers. | T3 |
| tests/unit/command-lookup.test.ts | created | AC4 tests: PATH and PATHEXT order, missing programs, the cmd line rules, and a real .cmd stub through cmd.exe (Windows only). | T3 |
| src/main/tools/run-command.ts | edited | runCommandInRoot takes the job and the command check, re-checks the call, resolves the program, and runs a .cmd or .bat through cmd.exe only when allowed. programRefusal keeps git and no longer refuses .cmd by name. | T3 |
| src/main/agent/router.ts | edited | The ToolRunner call carries the job of the request (ToolRunner gains job). | T3 (ToolRunner job moved here from T7) |
| src/main/agent/host.ts | edited | makeToolRunner takes an optional commandCheck (deny-all by default) and passes the job and check to runCommandInRoot. | T3 (host wiring of the check moved here from T7) |
| tests/unit/tool-command.test.ts | edited | Runner tests use an allowing context through a local wrapper; programRefusal is platform-free; .cmd is refused by the check, not by name; a check denial runs nothing; a missing program gives the PATH reason. | T3 |
| tests/unit/tool-reachability.test.ts | edited | Direct runner calls act as the writer through a local wrapper, with run_command allowed to reach the stub; router calls keep their own job. | T3 |
| tests/unit/agent-router.test.ts | edited | The runner call assertion now includes the job. | T3 |
| src/main/commands/protect.ts | created | Protected set per job (docs/specs and the .git key files; for the reviewer the non-ignored project files), the 256 MiB cap, the read-only lock on docs/specs, the read-only git ignore query with a no-git fallback, and the restore of contents, modes, created and deleted paths. | T4 |
| tests/unit/command-protect.test.ts | created | Module-level tests for the collection, the cap, the ignored set with and without git, the lock, and the restore for the writer and the reviewer (symlink case skipped without the capability). | T4 |
| src/main/commands/network.ts | created | The pure wrapper choice (unshare on Linux, sandbox-exec on macOS, else proxy-only), the one-time unshare and sandbox-exec probes, the macOS profile, the Linux loopback step, and the writer's dead proxy and offline variables. | T5 |
| tests/unit/command-network.test.ts | created | AC9 tests: the choice matrix, the wrapper arguments, the profile, the writer environment, the probes, and a real stub run that skips where the OS method is missing. | T5 |
| src/main/policy/rule-event.ts | edited | RuleEvent becomes a union of the decision event, the revert event (with the action) and the network event; their builders, formatting (rule reverted, rule network), sanitizing, and log levels (revert error; network info for os, warn for proxy-only). | T6 |
| src/main/log.ts | edited | Adds a warn level for the app log (stderr, same prefix); the Logger interface is unchanged. | T6 |
| src/main/policy/gate.ts | edited | The gate's decision carries a DecisionEvent (the decision type of the union), so its callers are unchanged. | T6 |
| src/main/commands/protect.ts | edited | Takes RevertAction from rule-event instead of defining its own; the restore reads the ignore rules again for created paths and falls back to the snapshot's set when the query fails. | T6 (type move), T4 fix |
| tests/unit/policy-rule-events.test.ts | edited | Adds revert and network event tests (building, formatting, sanitizing, levels, no content); the sink mocks gain warn. | T6 |
| tests/unit/agent-router.test.ts | edited | The decision assertion narrows on the decision kind (RuleEvent is now a union). | T6 |
| tests/unit/policy-acceptance.test.ts | edited | The same decision narrowing as agent-router (RuleEvent is now a union). | T6 |
| src/main/tools/run-command.ts | edited | runCommandInRoot now runs the full order: git refusal, the check again, lookup, the Windows cmd line, the cwd, the snapshot (cap refusal before anything changes), the writer's network choice and env, the spec lock, the run, and the restore in a finally. Emits the network and revert events and the area result lines. The spawn code moved into runProcess. | T7 |
| src/main/agent/host.ts | edited | Adds commandPolicyFor(root) (detected allowlist, or deny-all with no root), passes the check and the event sink to the runner, and builds the gate's context from the same check in startAgentHost. | T7 |
| tests/unit/command-acceptance.test.ts | created | AC5 to AC8 end to end on temp roots with Node stubs (spec lock and revert, .git key files, reviewer and writer rules, no-git fallback, the cap, timeout and start-failure restore), AC9 writer and reviewer environment and network event, AC10 router job, AC3 host policy. | T7 |
| docs/decisions.md | edited | Added D31 (allowlist and detection, the Windows rule, lock, snapshot and revert per job, main's read-only git query, the network limit per OS and best effort, the crash note); marked D29's open question as settled by D31. | T8 |
| CHANGELOG.md | edited | Added Unreleased entries for Added (command allowlist, cmd.exe shims, lock and revert, network limit, revert and network events, the command tests), Changed (run_command through the check, programRefusal, RuleEvent union, log warn) and Known issues (best-effort network, OS check skipped on Windows, crash leftovers, partial restore without an event, startAgentHost untested); removed the Windows .cmd/.bat known issue. | T9 |
| docs/agent-commands.md | created | Reference page: commands per job and project type, what is protected and reverted, the network limit per OS (best effort), and recovery of read-only bits and files after a crash. Links D6, D29 and D31. Untracked until committed, so `git diff --stat` does not list it. | T9 |
| CLAUDE.md | edited | Added the command rule to the rules that must hold (allowlist, read-only spec folder during commands, revert, writer network best effort), linking docs/agent-commands.md. | T9 |
| docs/PRD.md | edited | The "Commands" feature line now says the allowlist is of detected commands, and that the writer's no-network limit is OS-level on Linux and macOS and best effort elsewhere (D31). | T9 |
| docs/phases/phase-02-tool-policy.md | edited | The "How no network for the writer is enforced" decision is marked settled in p2-command-allowlist (D31). | T9 |
| docs/phases/phase-02-progress.md | edited | Follow-ups: the Windows .cmd/.bat item, the command-check item and the network item are struck through as settled by p2-command-allowlist (D31); added D31 to Decisions added. The subtask status and commit row are left for after the merge. | T9 |
| src/main/commands/lookup.ts | edited | The cmd.exe line is now wrapped in one more pair of quotes, so cmd's /s strips only the outer pair and a shim path with a space stays quoted. The doc comment explains why. | R1-1, round 1 |
| tests/unit/command-lookup.test.ts | edited | Line expectations take the outer pair; adds a Windows test that runs a .cmd stub under a folder whose name has a space through cmd.exe (it failed before the fix). | R1-1, round 1 |
| docs/specs/p2-command-allowlist/tasks.md | edited | Ticked T1 to T10 after their checks passed. | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 |

Docs checked for what this work makes stale (not in the table above when unchanged):

| Doc | Changed | Why |
| --- | --- | --- |
| README.md | no | Its statements (pnpm commands, Windows and WSL notes, the test command) still hold; it does not describe agent commands. |
| docs/workflow.md | no | The "Run tests and build" row (writer yes, reviewer tests only) and the blocked-call wording already match D31. |
| docs/PRD.md | yes | See the row above (Commands line). The D6 row and the risk row already describe the implemented behaviour. |
| CLAUDE.md | yes | See the row above. |
| docs/phases/phase-02-tool-policy.md | yes | See the row above. |
| docs/phases/phase-02-progress.md | yes | See the row above. |
