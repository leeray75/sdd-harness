# Summary Report: p0-process-layout
Ticket: none   Date: 2026-11-17
Outcome: Clean
Review rounds: 1 of 3 per revision; revisions: 0 of 2
Models: implementor haiku; reviewer sonnet; data agent not used (all chosen by the user); respawns: none

## What was built
The main process now starts a separate agent process, an Electron `utilityProcess` stub built as `out/main/agent.js`, once the app is ready, and stops it on quit (G1, G4). Main and the agent exchange typed messages over `parentPort` and `postMessage`: ready, ping/pong, and a tool call request and result. The types and the bounded hand-written guards live in `src/shared/agent-protocol.ts`, and main rejects and logs any malformed agent message (G2). Every tool call request goes through the pure gate `src/main/policy/gate.ts`. The gate denies everything with a reason, the agent receives the denial as an error result, and nothing is executed, because the router also refuses an `allow` for now (G3). An unexpected agent exit is logged and the agent is not restarted. Three unit test files, one new e2e test and D19 cover G5.

## Files changed
Product files (group 1):
| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/shared/agent-protocol.ts | created | Message unions, `JobId`, tool call result, bounded guards; no human-only action messages | T1 |
| src/main/policy/gate.ts | created | Pure default-deny `checkToolCall` with a reason | T2 |
| src/main/log.ts | created | `[harness]` log helper and passthrough for agent output | T3 |
| src/main/agent/router.ts | created | Validates agent messages, routes tool calls through the gate once, replies with a denied result, no execute path | T3 |
| src/agent/index.ts | created | Agent stub: ready with pid, pong, guard on incoming messages, one self-check request under `HARNESS_AGENT_SELFCHECK=1` | T4 |
| electron.vite.config.ts | edited | Second main-build input `agent` → `out/main/agent.js` | T4 |
| tsconfig.node.json | edited | Includes `src/agent/**/*` | T4 |
| src/main/agent/host.ts | created | `utilityProcess.fork` after ready, routing, ping, output forwarding, flag passthrough, quiet stop on quit, logged unexpected exit, no restart | T5 |
| src/main/index.ts | edited | Calls `startAgentHost()` after the window is created; bridge unchanged | T5 |
| tests/unit/agent-protocol.test.ts | created | Guard tests incl. human-only action names rejected | T6 |
| tests/unit/policy-gate.test.ts | created | Gate denies every job and several tools with a reason | T6 |
| tests/unit/agent-router.test.ts | created | One gate call, same-id denied result, args not logged, executor spy never called, invalid messages get no reply | T6 |
| tests/e2e/agent-process.spec.ts | created | Self-check e2e: ready line with a different pid, denial line, agent received-denied line, no unexpected exit on close, args never in output | T7 |
| docs/decisions.md | edited | D19 added | T8 |

Workflow files (group 2):
| File | Action | What and why | Task |
| --- | --- | --- | --- |
| docs/specs/p0-process-layout/PLAN.md | created | Approved plan | plan |
| docs/specs/p0-process-layout/SPECS.md | created | Approved spec (sha256 05dd53cc…) | plan |
| docs/specs/p0-process-layout/SUBTASK.md | created | Child-ticket draft (tracker: none) | plan |
| docs/specs/p0-process-layout/tasks.md | created | T1–T8, all ticked | T1–T8 |
| docs/specs/p0-process-layout/build-ledger.md | created | Build ledger | build |
| docs/specs/p0-process-layout/changes.md | created | Implementor's change notes | build |
| docs/specs/p0-process-layout/SUMMARY.md | created | This report | build |

Git and `changes.md` agree: every file git shows is listed, and every listed file appears in git.

## Acceptance criteria
| AC | Status | Evidence |
| --- | --- | --- |
| AC1 | Met | `agent` input in electron.vite.config.ts; tsconfig.node.json includes src/agent; build produced out/main/agent.js; typecheck passed |
| AC2 | Met | host.ts `utilityProcess.fork` from `startAgentHost()` in `whenReady`; e2e checks the agent pid differs from main's |
| AC3 | Met | agent-protocol.ts unions, `JobId`, denied result shape; no Node/Electron/DOM imports |
| AC4 | Met | Guards reject non-objects, unknown types, bad fields, unknown jobs, long strings; agent guards main messages; unit tests |
| AC5 | Met | No human-only message types; unit test rejects those names |
| AC6 | Met | gate.ts pure, always denies with a non-empty reason; unit tests |
| AC7 | Met | router.ts: reject+log with no reply, one gate call, same-id denied result, log without args, no execute path; unit tests with executor spy |
| AC8 | Met | `before-quit` marks a deliberate stop; other exits logged with code, no restart; e2e asserts no unexpected-exit line on close |
| AC9 | Met | One self-check request only when flag is `1`; manual run without the flag sent none |
| AC10 | Met | `pnpm test`: 4 files, 35 tests passed |
| AC11 | Met | `pnpm e2e`: agent-process and the unchanged smoke test passed |
| AC12 | Met | typecheck, lint, format:check, test, e2e passed (implementor's run) |
| AC13 | Met | D19 in docs/decisions.md with the four points and alternatives not chosen |

## Needs a runtime check
- The reviewer did not re-run tests; the 35 unit and 2 e2e passes are the implementor's results. Test file contents were checked by list, not line by line.
- Killing main without a normal quit (e.g. an external kill) logs "agent exited unexpectedly with code 143", which is expected; only a normal quit is quiet.
- `pnpm e2e` ran on Windows only; `p0-ci` covers macOS and Linux.

## Review ledger
### Revision 0, round 1  (PASS)
| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| (none) | | | | | |

## Spec revisions
none

## Rejected findings
none

## Open issues
- The agent gets a full copy of the app's environment (only the self-check flag is controlled). Harmless for a stub, but an untrusted agent should get an allowlisted env before Phase 1 passes it anything real; worth a follow-up.
- The logged `tool` name is untrusted agent input: bounded to 4096 characters but newlines are not escaped, so a hostile agent could forge log lines. Optional hardening in Phase 2 (reviewer note).
- Implementor choices where the spec is silent: an `allow` from the gate is also refused for now; the self-check is sent after the first ping/pong; guards ignore extra top-level fields and limit `args` to JSON-like values, 4096-character strings and depth 8.

## Git state
Branch `feature/p0-process-layout`; approved; committed and pushed in the commit that adds this report.

## Next steps
Approve, commit and push; or request changes (for example, an allowlisted agent env or escaped log fields now); or not yet.
