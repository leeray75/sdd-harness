# Changes: p0-process-layout

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/shared/agent-protocol.ts | created | Typed agent and main message unions, JobId, tool call result, bounded hand-written guards (with reasons), and a note that human-only actions have no message type. | T1 |
| src/main/policy/gate.ts | created | Pure default-deny `checkToolCall` that always returns a denial with a reason. No Electron imports. | T2 |
| src/main/log.ts | created | Main-side log helper: `[harness]` lines to stdout and stderr, plus a passthrough for agent output. | T3 |
| src/main/agent/router.ts | created | Pure router: validates agent messages, logs rejections, sends tool call requests through the gate once, returns a denied result with the same id. No execute path. | T3 |
| src/agent/index.ts | created | Agent stub on `process.parentPort`: posts ready with pid, answers ping with pong, validates main messages, sends one self-check tool call when `HARNESS_AGENT_SELFCHECK=1`. | T4 |
| electron.vite.config.ts | edited | Added `agent: src/agent/index.ts` as a second input of the main build (output `out/main/agent.js`). | T4 |
| tsconfig.node.json | edited | Added `src/agent/**/*` to `include`. | T4 |
| src/main/agent/host.ts | created | Forks the agent with `utilityProcess.fork` after app ready, routes its messages through the router, pings after ready, forwards its output to main's log, passes the self-check flag through, stops it on quit without an unexpected-exit log, logs any other exit with its code and does not restart. | T5 |
| src/main/index.ts | edited | Calls `startAgentHost()` after the main window is created. Renderer bridge unchanged. | T5 |
| tests/unit/agent-protocol.test.ts | created | Guard tests: valid and invalid messages, length and depth limits, and rejection of every human-only action name (AC5). | T6 |
| tests/unit/policy-gate.test.ts | created | Gate denies every job and several tool names, with a non-empty reason. | T6 |
| tests/unit/agent-router.test.ts | created | Router: one gate call, denied result with same id, log without arguments, injected executor spy never called, invalid messages logged with no reply. | T6 |
| tests/e2e/agent-process.spec.ts | created | Launches the built app with `HARNESS_AGENT_SELFCHECK=1`; checks the agent ready line (different pid), the denial line, the agent's received-denied line, and no unexpected-exit line after close. | T7 |
| docs/decisions.md | edited | Added D19: utilityProcess and parentPort channel (fork not chosen), hand-written guards (zod not chosen), default-deny gate in main, log-only on unexpected exit (restart not chosen). Ran `pnpm format`; no other file changed. | T8 |
| docs/specs/p0-process-layout/tasks.md | edited | Ticked boxes T1 to T8 after each check passed. | T1, T2, T3, T4, T5, T6, T7, T8 |
| docs/specs/p0-process-layout/changes.md | created | This file. | T8 |
