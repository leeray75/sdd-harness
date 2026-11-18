# Tasks: p0-process-layout

Work in order. After each task, run its check, then tick the box.

- [x] **T1 — Shared agent protocol and guards.** Add `src/shared/agent-protocol.ts`:
  - the message unions, `JobId` and the tool call result type (AC3);
  - `isAgentToMainMessage` and `isMainToAgentMessage` guards with a string length limit (AC4);
  - a comment noting that there are no human-only action messages (AC5).

  **Check:** `pnpm typecheck` passes; the file imports nothing from Node, Electron or the DOM.
- [x] **T2 — Policy gate.** Add `src/main/policy/gate.ts` with a pure `checkToolCall` that always denies with a reason (AC6). **Check:** `pnpm typecheck` passes; no Electron import in the file.
- [x] **T3 — Router and log helper.** Add a small main-side log helper (`[harness]` prefix, stdout and stderr) and `src/main/agent/router.ts`:
  - it validates each message, calls the gate for tool call requests and builds the denied result;
  - it logs rejected messages and denials (job, tool and reason, never the args);
  - the gate and logger come in as dependencies, and there is no execute path (AC7).

  **Check:** `pnpm typecheck` passes.
- [x] **T4 — Agent stub entry and build.** Add `src/agent/index.ts` using `process.parentPort`:
  - it posts `ready` with its pid and answers `ping` with `pong`;
  - it validates incoming messages;
  - with `HARNESS_AGENT_SELFCHECK=1` it sends one tool call request and logs the result it receives (AC9).

  Add the `agent` input to the main build in `electron.vite.config.ts`, and `src/agent/**/*` to `tsconfig.node.json` (AC1). **Check:** `pnpm build` produces `out/main/agent.js`; `pnpm typecheck` passes.
- [x] **T5 — Host and wiring.** Add `src/main/agent/host.ts`, which:
  - forks the agent with `utilityProcess.fork` after app ready (AC2);
  - routes its messages through the router and posts replies;
  - sends `ping` after `ready`;
  - forwards the agent's stdout and stderr to main's log;
  - passes `HARNESS_AGENT_SELFCHECK` through only when it is set;
  - stops the agent on quit without an unexpected-exit log, and logs any other exit with its code, with no restart (AC8).

  Start it from `src/main/index.ts`, leaving the renderer bridge unchanged. **Check:** `pnpm build`, then run the built app (or `pnpm dev`) and see the ready and pong lines in the console.
- [x] **T6 — Unit tests.** Add `tests/unit/agent-protocol.test.ts`, `tests/unit/policy-gate.test.ts` and `tests/unit/agent-router.test.ts`, covering AC4, AC5, AC6 and AC7 as listed in AC10. **Check:** `pnpm test` passes.
- [x] **T7 — e2e test.** Add `tests/e2e/agent-process.spec.ts` as in AC11:
  - launch the built app with `HARNESS_AGENT_SELFCHECK=1` and collect stdout lines as they arrive;
  - assert the ready line with a different pid, the denial line and the agent's received-denied line;
  - close the app and assert there is no unexpected-exit line.

  **Check:** `pnpm e2e` passes, including the existing smoke test.
- [x] **T8 — Decision and repo checks.** Add D19 to `docs/decisions.md` (AC13), run `pnpm format`, then run the full set. **Check:** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` and `pnpm e2e` all pass (AC12).
