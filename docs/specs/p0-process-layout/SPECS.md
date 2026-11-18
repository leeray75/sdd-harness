---
status: done
ticket:
---

# p0-process-layout

## Problem

The app has a main process and a renderer, but no agent process and no place where agent tool calls are checked. D1, D3 and D4 and the PRD's "Agent isolation" requirement need agents to run outside the main process. Every tool call must be checked in main before it runs, and there must be no route for an agent to trigger a human-only action. Later phases (providers, tool policy, workflow engine) need this boundary to exist first, with tests that prove it denies by default.

## Goals

- **G1:** A separate agent process (Electron `utilityProcess` stub) that main starts and stops, with its own build entry.
- **G2:** A typed message channel between main and the agent. Its types and hand-written validators live in `src/shared`, and main treats every agent message as untrusted.
- **G3:** A pure main-process policy gate that every agent tool call request passes through. It denies everything by default with a reason, and the denial goes back to the agent as an error result. Nothing is executed.
- **G4:** Lifecycle handling: the agent starts after app ready, stops on quit, and an unexpected exit is logged.
- **G5:** Automated proof (unit tests and an e2e test) and the choices recorded as D19.

## Non-goals

- Real tools, the per-job policy table, path rules and the command allowlist (Phase 2).
- Providers, the agent loop and model calls (Phase 1).
- Workflow states (Phase 3).
- Restarting the agent after a crash.
- Frameless window, title bar, design tokens and CI (later Phase 0 subtasks).
- Any change to the renderer bridge (`window.harness` keeps exactly `getVersion`).
- A logging library or log files (logs go to stdout and stderr).

## Acceptance criteria

- **AC1:** An agent entry, `src/agent/index.ts`, is built by electron-vite as a second input of the main build and lands at `out/main/agent.js`. `tsconfig.node.json` includes `src/agent`. `pnpm build` and `pnpm typecheck` pass.
- **AC2:** After `app.whenReady`, main starts the agent with `utilityProcess.fork`, so it runs in a separate OS process with its own pid, distinct from main's. The agent has no window, preload or renderer access.
- **AC3:** `src/shared/agent-protocol.ts` (no Node, Electron or DOM imports) defines the message types as discriminated unions on `type`:
  - agent → main: `ready` (with the agent's `pid`), `pong`, and `tool-call-request` `{ id, job, tool, args }`;
  - main → agent: `ping` and `tool-call-result` `{ id, ok, error? }`, where a denial is `ok: false` with `error: { code: 'denied', reason }`;
  - a `JobId` union of `planner`, `writer`, `reviewer` and `reader`.
- **AC4:** `isAgentToMainMessage` in `src/shared` accepts only well-formed agent → main messages. It rejects non-objects, unknown `type` values, missing or wrongly typed fields, unknown job ids and strings over a fixed length limit. The agent validates main → agent messages with its own guard.
- **AC5:** No message type, job or tool name exists for approve spec, approve result, close (mark done), change rules or edit an approved spec (D3). A unit test shows that messages with such `type` values are rejected.
- **AC6:** `src/main/policy/gate.ts` exports a pure `checkToolCall({ job, tool, args })` with no Electron imports. It returns `{ allow: false, reason }` with a non-empty reason for every input in this subtask, and its return type also allows `{ allow: true }` for Phase 2.
- **AC7:** A pure router in `src/main/agent/router.ts` handles every agent message:
  - an invalid message is logged as rejected (with the reason) and gets no reply;
  - a `tool-call-request` calls the gate exactly once and gets back a `tool-call-result` with the same `id`, `ok: false` and the gate's reason, and main logs a line naming the job, the tool and the reason, never the arguments;
  - there is no code path that executes a tool.
- **AC8:** The host in `src/main/agent/host.ts` stops the agent when the app quits, without logging it as unexpected. If the agent exits for any other reason, main logs its exit code as an unexpected exit and does not restart it.
- **AC9:** When the env var `HARNESS_AGENT_SELFCHECK=1` is set for the app, main passes it to the agent. The agent then sends exactly one `tool-call-request` after the handshake and logs the result it receives. Without the flag, the agent sends no tool call request.
- **AC10:** Unit tests (Vitest) cover:
  - the protocol guard (valid and invalid cases, including AC5);
  - the gate (denies every job and several tool names, with a non-empty reason);
  - the router (a request reaches the gate once, yields a denied result with the same id, and an injected executor spy is never called; invalid messages are logged and get no reply).
- **AC11:** An e2e test (Playwright for Electron) launches the built app with `HARNESS_AGENT_SELFCHECK=1` and reads its stdout. It sees:
  - the agent's ready line, with a pid different from main's;
  - main's denial line for the self-check tool call;
  - the agent's line saying it received a denied result.
  After the app closes, no unexpected-exit line has been logged. The existing smoke test still passes unchanged.
- **AC12:** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` and `pnpm e2e` all pass.
- **AC13:** `docs/decisions.md` has D19 in the file's format (Outcome, Why, Date), covering:
  - the agent process as a `utilityProcess` using `parentPort` and `postMessage`, with `child_process.fork` as the alternative not chosen;
  - hand-written message guards, with zod not chosen;
  - the default-deny gate in main;
  - log-only on an unexpected exit, with restart not chosen.

## Open questions

- none
