# Changes: p2-fix-e2e-selfcheck

Implementation report, round 0 (Mode 1). No product code under `src/` changed.

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| docs/specs/p2-fix-e2e-selfcheck/changes.md | created | This record of the files touched and the checks run. | T1-T4 |
| tests/e2e/agent-process.spec.ts | edited | Title and comments now describe the D30 Rule event. The two `toMatch` patterns expect `[harness] rule blocked: job=writer tool=write_file target=selfcheck.txt reason=not allowed: source files can be edited only after the spec is approved` and the agent's `received denied result id=selfcheck-1` line with the same reason. The `selfcheck.txt` ban is replaced by a `probe-body` check and a check that no `rule ` line contains `root` (backslash and forward-slash forms). The pid and clean-exit checks are unchanged. | T1 |
| CHANGELOG.md | edited | Fixed entry under `[Unreleased]` for the restored CI e2e job (AC6). | T3 |
| CLAUDE.md | edited | Conventions bullet: a pull request is merged only when its CI run is green on every job; approval and close messages state the CI state and link the run or compare page (AC6). Prettier made no other change. | T3 |
| docs/phases/phase-02-tool-policy.md | edited | Step 6 carries the same CI-green merge rule (AC6). | T3 |
| docs/phases/phase-02-progress.md | edited | Row `3a` for p2-fix-e2e-selfcheck (status pending, spec and commit empty), and a follow-up section "From p2-fix-e2e-selfcheck" on CI red from PR #14 (run #31) through PR #15 and the restore (AC6). | T3 |
| docs/specs/p2-fix-e2e-selfcheck/tasks.md | edited | Ticked T1, T2, T3 and T4 after each check passed. | T1, T2, T3, T4 |

## T2 other e2e specs result

Checked `smoke.spec.ts`, `design-tokens.spec.ts`, `spike-agent.spec.ts` and `window-chrome.spec.ts` for stale expectations after D29 to D31. None needed a change:

- `spike-agent.spec.ts` expects `[harness] tool call ran: job=reader tool=read_file outcome=ok`, which `src/main/agent/router.ts:118` still logs for allowed calls. It also expects `[agent] spike finished stopped=answered turns=2`, which `src/agent/index.ts:94` still prints. The comment "the one read_file call the gate allowed" is still accurate under the per-job policy (the reader may read).
- `smoke.spec.ts`, `design-tokens.spec.ts` and `window-chrome.spec.ts` check only the window, the bridge keys and the styles. None mention the agent, tool calls or rule events.
- Local `pnpm e2e` on Windows: 15 passed, 2 skipped (the macOS-only window-chrome tests), 0 failed.

## Stale-doc check

| Doc | Changed or unchanged | Why |
| --- | --- | --- |
| CLAUDE.md | changed | Conventions bullet for the CI-green merge rule (the task requires it). |
| README.md | unchanged | Its CI pointer ("see CLAUDE.md, CI") stays correct. It has no merge or approval rule. Its "Settled decisions D1-D20" line was already stale before this fix, and it is out of scope. |
| docs/PRD.md | unchanged | It has no CI or merge wording, and the app's behaviour is unchanged. |
| docs/workflow.md | unchanged | Its stage and state diagrams do not cover the PR merge step, and the app's behaviour is unchanged. |
| docs/phases/phase-02-tool-policy.md | changed | Step 6 carries the CI-green merge rule (AC6). |
| docs/phases/phase-02-progress.md | changed | Row 3a and the follow-up section (AC6). Status and commit for 3a are filled in after the merge. |
| CHANGELOG.md | changed | Fixed entry (AC6). |

## Checks run

- `pnpm e2e` -> 15 passed, 2 skipped, 0 failed. `agent-process.spec.ts` passes.
- `pnpm typecheck` -> pass (tsc for the node and web configs).
- `pnpm lint` -> pass (eslint .).
- `pnpm format:check` -> pass ("All matched files use Prettier code style!").
- `pnpm test` -> 46 files passed; 1030 tests passed, 12 skipped.
