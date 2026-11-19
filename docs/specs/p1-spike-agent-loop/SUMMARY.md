# Summary Report: p1-spike-agent-loop
Ticket: none   Date: 2026-11-18
Outcome: Clean
Review rounds: 1 of 3 per revision (in revision 1); revisions: 1 of 2
Models: implementor haiku; reviewer sonnet; data agent not used (all chosen by the user); respawns: none

## What was built

The agent process now runs a real loop (G1): with `HARNESS_AGENT_SPIKE=1` it streams a chat completion from an OpenAI-compatible server through the `openai` SDK, sends one `read_file` call to main, and finishes its answer with the result, within 4 model turns. Main's gate allows only `reader` + `read_file {path}`; main runs it inside `HARNESS_SPIKE_ROOT` with real-path containment and a 64 KiB cap, and returns the text over the typed channel (G2). The agent's environment is an allowlist, case-insensitive on Windows, with the spike variables passed only under the flag (G3). Tests replay a fixture recorded from the user's agentgateway, an Electron e2e test runs the whole spike against a local replay server, and `pnpm test:live` is opt-in (G4). CHANGELOG, README, CLAUDE.md, D17/D19 and the Phase 0 follow-ups were updated (G5).

## Files changed
Product files (group 1):
| File | Action | What and why | Task |
| --- | --- | --- | --- |
| package.json | edited | `openai` in `dependencies`; `record:spike` and `test:live` scripts | T1, T7, T10 |
| pnpm-lock.yaml | edited | Lockfile for `openai` | T1 |
| tsconfig.node.json | edited | Typecheck covers `scripts/**/*` and `vitest.live.config.mts` | T7, T10 |
| scripts/record-spike-fixture.ts | created | Records the two streamed bodies of one `read_file` round trip; models check; 404 hint names the failing request; refuses to write if the key appears | T7 |
| src/agent/loop.ts | created | The agent loop: streaming, tolerant tool-call delta accumulation, `read_file` via injected `callTool`, 4-turn cap, bad args become tool errors | T8 |
| src/agent/index.ts | edited | Runs the loop once after the handshake when `HARNESS_AGENT_SPIKE=1`; id-matched results, 30 s timeout; self-check unchanged | T9 |
| src/main/agent/host.ts | edited | Allowlisted `agentEnv(parent, platform)` (case-insensitive on win32, `WINDIR` added); awaits the async router; `read_file` runner from `HARNESS_SPIKE_ROOT` | T5, T6 |
| src/main/agent/router.ts | edited | Async; allowed calls go to injected `runTool`, reply with output or `failed`; logs job, tool, outcome only | T5 |
| src/main/policy/gate.ts | edited | Allows only `reader` + `read_file` with args exactly `{ path: string }` | T3 |
| src/main/tools/read-file.ts | created | Root-contained `read_file` with real-path checks and 64 KiB cap | T4 |
| src/shared/agent-protocol.ts | edited | Success result carries `output` (≤ 65,536 chars); `failed` error code; guards updated | T2 |
| tests/unit/agent-protocol.test.ts | edited | New result forms and bounds | T2 |
| tests/unit/policy-gate.test.ts | edited | Allow case and denials | T3 |
| tests/unit/read-file.test.ts | created | Each refusal and the cap; symlink cases skip where symlinks are not allowed | T4 |
| tests/unit/agent-router.test.ts | edited | Spy runner: denied calls never reach it; outputs and failures; log content | T5 |
| tests/unit/agent-env.test.ts | created | Allowlist on linux and win32 (`SYSTEMROOT`, `WINDIR`, `COMSPEC`, secrets, flag) | T6 |
| tests/unit/agent-loop.test.ts | created | Fixture replay with a sentinel key; tolerant streams, bad args, failed results, turn cap, no key in output or fixtures | T8 |
| tests/fixtures/spike/turn1-tool-call.sse | created | Recorded by the user from agentgateway (vLLM): reply asking for `read_file` | T7 |
| tests/fixtures/spike/turn2-final.sse | created | Recorded by the user: final answer after the tool result | T7 |
| tests/e2e/agent-process.spec.ts | edited | Expected denial text follows the new gate reason | T5 |
| tests/e2e/spike-agent.spec.ts | created | Electron e2e: full spike against a local replay server; `read_file` ran, spike finished, sentinel absent | T13 |
| tests/live/spike.live.test.ts | created | Opt-in live loop against `HARNESS_SPIKE_BASE_URL`; skipped when unset | T10 |
| vitest.live.config.mts | created | Vitest config for `tests/live` only | T10 |
| CHANGELOG.md | edited | `[Unreleased]` entries for the spike, tool, protocol, env, live suite; known issue for symlink skips | T11 |
| README.md | edited | Commands and "Run the spike (dev only)" with `/v1` base URL | T11 |
| CLAUDE.md | edited | Commands and "Run the spike (dev only)" | T11 |
| docs/decisions.md | edited | D17 and D19 amended | T11 |
| docs/phases/phase-00-progress.md | edited | Struck the agent-env and router-refusal follow-ups as done | T11 |
| docs/phases/phase-01-progress.md | edited | not in implementor notes: orchestrator's planning note that subtask 1 runs on agentgateway and the Anthropic adapter moves to `p1-provider-interface` (made before the build) | planning |

Workflow files (group 2: PLAN.md, SPECS.md, SUBTASK.md, tasks.md, build-ledger.md, changes.md, this report):
| File | Action | What and why | Task |
| --- | --- | --- | --- |
| docs/specs/p1-spike-agent-loop/PLAN.md | created | Approved plan | planning |
| docs/specs/p1-spike-agent-loop/SPECS.md | created | Approved spec, revised once (AC8, revision 1) | planning, revision 1 |
| docs/specs/p1-spike-agent-loop/SUBTASK.md | created | Child-ticket draft (not published; tracker none) | planning |
| docs/specs/p1-spike-agent-loop/tasks.md | created | T1–T13, all ticked | all |
| docs/specs/p1-spike-agent-loop/build-ledger.md | created | Build ledger | workflow |
| docs/specs/p1-spike-agent-loop/changes.md | created | Implementor's change notes | workflow |
| docs/specs/p1-spike-agent-loop/SUMMARY.md | created | This report | workflow |

## Acceptance criteria
| AC | Status | Evidence |
| --- | --- | --- |
| AC1 | Met | `openai` in `dependencies`; `out/main/agent.js` has `require("openai")` |
| AC2 | Met | Protocol forms and guards; `agent-protocol.test.ts` |
| AC3 | Met | `gate.ts`; `policy-gate.test.ts` |
| AC4 | Met | Spy-runner tests in `agent-router.test.ts`; log content checked |
| AC5 | Met (symlink cases unexercised here) | `read-file.test.ts`; symlink tests skipped on this Windows account |
| AC6 | Met | `agent-loop.test.ts` fixture replay, turn cap, bad args |
| AC7 | Met on Windows | `spike-agent.spec.ts` passes locally; macOS/Linux first run in CI |
| AC8 | Met (revision 1) | `agent-env.test.ts`; spike e2e proves the allowlisted agent opens a socket |
| AC9 | Met | Record script; user's run wrote both fixtures; 404 hint names the request |
| AC10 | Met | Sentinel checks in unit and e2e tests; fixtures hold no Authorization or key |
| AC11 | Met | `pnpm test:live` skipped without the variable; the user's run against agentgateway (`…:4100/v1`) passed: 1 test, the `read_file` call ran and the model answered (1.5 s) |
| AC12 | Met | Docs updated; remaining grep hits are struck follow-ups and historical approved specs |
| AC13 | Met | typecheck, lint, format:check pass; `pnpm test` 137 passed, 2 skipped |

## Needs a runtime check
- The spike e2e on macOS and Linux (first run is CI).
- The symlink-escape cases in `read-file.test.ts` (skipped on this Windows account; they run where symlinks are allowed).
- ~~`pnpm test:live` against the real gateway~~: done by the user on 2026-11-18; passed.

## Review ledger
Covers every revision, copied from `docs/specs/p1-spike-agent-loop/build-ledger.md`.
### Revision 1, round 1  (PASS)
| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| (none) | | | | | |

No review ran in revision 0; the build paused at the implementor's spec problem before review.

## Spec revisions
- Revision 1: with the original AC8 allowlist the agent could not open sockets in Electron on Windows (`connect UNKNOWN`), because the parent environment spells it `SYSTEMROOT` and the allowlist matched `SystemRoot` case-sensitively. The user chose **Revise the spec**: case-insensitive matching on win32 only (keeping the parent's spelling), add `WINDIR` (not `COMSPEC`), and an Electron e2e proof (new task T13). Re-approved by the user.

## Rejected findings
none

## Open issues
none. Implementor notes for your judgement: the spike e2e checks for no "agent exited unexpectedly" line after `app.close()` rather than waiting on the close event (weaker than the agent-process test); on win32 duplicate spellings of one variable keep the first seen (the spec does not say which).

## Git state
feature/p1-spike-agent-loop; approved; committed and pushed in the commit that adds this report.

## Next steps
Approve, commit and push; or request changes; or not yet.
