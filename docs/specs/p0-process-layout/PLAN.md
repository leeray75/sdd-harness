# Plan: Agent process stub, typed agent channel and default-deny policy gate

Ticket: none (vibe planning; subtask 2 of Phase 0, docs/phases/phase-00-scaffold.md)
Status: approved
Date: 2026-11-17

## Objective

Lay down the process layout every later phase builds on. The main process starts a separate agent process (an Electron `utilityProcess` stub) and talks to it over a typed message channel whose types live in `src/shared`. Every tool call request from the agent passes through a main-process policy gate that denies everything by default and returns the denial to the agent as an error it can read. Nothing is executed in this subtask. This sets up the boundary that D1, D3, D4 and the PRD's "Agent isolation" requirement depend on.

## Scope

- **In:**
  - agent process entry (`src/agent/index.ts`) built by electron-vite;
  - spawn and lifecycle in main;
  - typed message protocol in `src/shared` (ready, ping/pong, tool call request, tool call result);
  - hand-written message guards;
  - main-side message router;
  - pure policy gate that denies by default;
  - logging of rejected messages and unexpected exits;
  - env-flag self-check in the agent stub;
  - Vitest unit tests and a Playwright e2e test;
  - a new decision (D19).
- **Out:**
  - real tools, the per-job policy table, path rules and the command allowlist (Phase 2);
  - providers, the agent loop and model calls (Phase 1);
  - workflow states (Phase 3);
  - auto-restart of the agent;
  - frameless window, title bar, tokens and CI (later Phase 0 subtasks);
  - any change to the renderer bridge.

## Decisions

| Question                                   | Decision                                                                                                                                                                       | Alternatives considered                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Feature slug, repo, base branch            | `p0-process-layout`, sdd-harness, base `main`, branch `feature/p0-process-layout`                                                                                              | (fixed by the phase doc)                                                                               |
| Tracker                                    | None; spec stays in `docs/specs/`                                                                                                                                              | Ticket story                                                                                           |
| Agent process type                         | Electron `utilityProcess` (from the brief), using its built-in `parentPort` / `child.postMessage` channel                                                                      | `child_process.fork`; a separate MessageChannelMain pair                                               |
| Message validation                         | Hand-written type guards in `src/shared`, no new dependency                                                                                                                    | zod schemas                                                                                            |
| How the e2e test triggers a tool call      | Env flag `HARNESS_AGENT_SELFCHECK=1`: the stub sends one tool call request after the handshake; the test reads main's stdout log lines                                         | Env-gated test hook global in main driven by Playwright `app.evaluate`                                 |
| Unexpected agent exit                      | Log the exit code and reason; no restart                                                                                                                                       | Log and restart once with backoff                                                                      |
| Where the policy gate lives                | `src/main/policy/gate.ts`, pure (no Electron imports), so it can be unit tested                                                                                                | Inline in the router                                                                                   |
| Job ids in the protocol                    | A `JobId` union of the four PRD jobs (`planner`, `writer`, `reviewer`, `reader`) in `src/shared`; display names stay in the UI layer later                                     | Free-form string                                                                                       |
| Logging                                    | Small main-side `log` helper writing structured lines to stdout/stderr with a `[harness]` prefix; never logs tool arguments in full (only the tool name and job)               | A logging library (deferred)                                                                           |

## Approach

1. **Shared protocol** (`src/shared/agent-protocol.ts`, no Node, Electron or DOM imports):
   - message types, discriminated by `type`:
     - agent → main: `ready`, `pong`, `tool-call-request` `{ id, job, tool, args }`;
     - main → agent: `ping`, `tool-call-result` `{ id, ok: false, error: { code: 'denied', reason } }`;
     - the result type also allows `ok: true` for later phases;
   - `JobId` union, and `isAgentToMainMessage(value): value is AgentToMainMessage`, which rejects unknown `type`s, missing or ill-typed fields, extra top-level types, non-object values and oversized strings;
   - no message type for approve spec, approve result, close, change rules or edit an approved spec (D3); a comment says so.
2. **Policy gate** (`src/main/policy/gate.ts`): `checkToolCall({ job, tool, args }): { allow: true } | { allow: false; reason: string }`. In this subtask it always returns deny with a reason such as `no tools are allowed yet (policy table arrives in Phase 2)`. The shape is designed so Phase 2 can plug in a table.
3. **Router** (`src/main/agent/router.ts`, pure): `handleAgentMessage(raw, deps)` takes the gate and a logger as dependencies:
   - validates the message;
   - invalid → logs `rejected agent message` with the reason, returns nothing;
   - `tool-call-request` → calls the gate, logs a Rule-style line (`tool call denied: job=… tool=… reason=…`) and returns a denied `tool-call-result` with the same `id`;
   - `ready` and `pong` → logged.
   - It has no execute path. A comment marks where Phase 2 adds execution, behind `allow`.
4. **Host** (`src/main/agent/host.ts`): starts the agent with `utilityProcess.fork(join(__dirname, 'agent.js'), [], { serviceName: 'SDD Harness agent', stdio: 'pipe' })` after `app.whenReady`.
   - It wires `child.on('message')` to the router and posts replies back.
   - It sends a `ping` after `ready`.
   - On `exit`, it logs an unexpected exit with the code (and nothing when the exit came from our own quit).
   - It stops the child on `before-quit` / `will-quit`.
   - It passes `HARNESS_AGENT_SELFCHECK` through to the child's env only when set.
5. **Agent stub** (`src/agent/index.ts`): uses `process.parentPort`.
   - It posts `ready` on start, answers `ping` with `pong`, and validates incoming main messages with a guard.
   - With the self-check flag, it sends one `tool-call-request` (job `writer`, tool `write_file`, harmless args), then logs the result it receives to its stdout, piped through main's log.
   - It does nothing else.
6. **Build**: add `agent: src/agent/index.ts` as a second input of the electron-vite `main` build (output `out/main/agent.js`). Add `src/agent/**/*` to `tsconfig.node.json`. ESLint already covers `src/**`.
7. **Wire up** in `src/main/index.ts`: start the host after the window is created; leave the renderer bridge unchanged.
8. **Tests**:
   - `tests/unit/agent-protocol.test.ts`: valid messages pass; unknown type, missing or wrong fields, non-objects and human-only action names are rejected.
   - `tests/unit/policy-gate.test.ts`: deny by default for every job and several tool names, with a non-empty reason.
   - `tests/unit/agent-router.test.ts`: a tool call request goes through the gate exactly once and yields a denied result with the same id; an injected "executor" spy is never called; invalid messages are logged and get no reply.
   - `tests/e2e/agent-process.spec.ts`: launches the built app with `HARNESS_AGENT_SELFCHECK=1` and reads stdout. It expects the agent ready line, the gate's denied line and the agent's "received denied result" line, and checks that the agent runs in a different process from main (the pid in the ready line differs from `app.process().pid`). It closes the app and expects no "unexpected exit" line.
9. **Docs**: D19 in `docs/decisions.md` (agent process and channel: `utilityProcess` with `parentPort`, hand-written guards, default-deny gate in main, log-only on crash), then `pnpm format`.

## Verified assumptions

| Assumption                                                                  | Evidence                                                                                                           |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Main build has a single `index` input that can take a second entry          | `electron.vite.config.ts` main `rollupOptions.input: { index: … }`                                                 |
| Built main output is `out/main/`, so the agent bundle lands beside it       | `package.json` `"main": "out/main/index.js"`                                                                       |
| `tsconfig.node.json` must be extended for `src/agent`                       | Its `include` lists only `src/main`, `src/preload`, `src/shared`, tests and configs                                |
| e2e launches the built app root and can pass env                            | `tests/e2e/smoke.spec.ts` uses `electron.launch({ args: [root], cwd: root, env })`                                  |
| Electron version supports `utilityProcess` with `parentPort`                | `package.json` `electron ^45.3.4` (utilityProcess is stable since Electron 22)                                     |
| Next decision number is D19                                                 | `docs/decisions.md` ends at D18                                                                                    |
| The renderer bridge stays `['getVersion']`, so the smoke test is unchanged  | `src/shared/bridge.ts`, `tests/e2e/smoke.spec.ts`                                                                  |

## Risks

- Electron may not pipe the utilityProcess's stdout to the parent's stdout, so the e2e test can't see the agent's own log line. If that happens, `stdio: 'pipe'` with main forwarding the child's stdout through `log` handles it; the first e2e run will show it.
- The child exits during app shutdown, which could be logged as "unexpected". The host marks a deliberate stop before killing, and the e2e test asserts no unexpected-exit line on close.
- Playwright can't read stdout after the process exits. The test reads lines as they arrive (a `data` listener) before closing.

## Open questions

none
