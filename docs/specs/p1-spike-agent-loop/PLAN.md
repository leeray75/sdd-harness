# Plan: p1-spike-agent-loop

Ticket: (none, vibe planning; Phase 1 subtask 1)
Status: approved
Date: 2026-11-18

## Objective

Prove the agent loop end to end before the provider layer is designed. The agent process sends one prompt to a model over an OpenAI-compatible API and streams the reply; the model asks for one read-only tool (`read_file`); the call travels to main, passes the policy gate, main runs it, and the result goes back to the model, which finishes its answer. The loop may be rewritten in `p1-provider-interface`, but it stays tested.

## Scope

- **In:**
  - A minimal loop in `src/agent`: one model, streamed text, one read-only tool round trip, stop after a fixed number of model turns (4).
  - Transport through the `openai` SDK (D23) with base URL, optional key and model from `HARNESS_SPIKE_BASE_URL`, `HARNESS_SPIKE_API_KEY`, `HARNESS_SPIKE_MODEL`, and an injected `fetch` for tests.
  - Protocol: `tool-call-result` gains a success form that carries the tool's text output; guards on both sides check it.
  - Gate: allows exactly job `reader` + tool `read_file` with args `{ path: string }`; everything else still denied by default.
  - Router: an allowed call goes to an injected tool runner; only `read_file` exists. Main's `read_file` reads only inside one root (`HARNESS_SPIKE_ROOT`), refuses paths outside it (`..`, absolute paths, symlinks that resolve outside), refuses non-files, caps output at 64 KiB.
  - `agentEnv` becomes an allowlist (Phase 0 follow-up).
  - Dev-only trigger `HARNESS_AGENT_SPIKE=1`, like the existing self-check. No UI.
  - A recorded streaming fixture from the user's agentgateway, replayed in unit tests (D24), and a record script that makes it.
  - An optional live suite (`pnpm test:live`), never in CI.
- **Out:** Anthropic transport and the "same loop on both providers" check (moved to `p1-provider-interface`); the provider interface, retries and usage accounting; keychain storage and redaction (`p1-secrets`); write tools, command running and the per-job policy table (Phase 2); any UI.

## Decisions

| Question | Decision | Alternatives considered |
| --- | --- | --- |
| Feature slug, repo, base branch | `p1-spike-agent-loop` in `sdd-harness`, branch `feature/p1-spike-agent-loop` from `main` | (conventional; not asked) |
| Read-only tool | `read_file {path}` for job `reader` only, under one root from `HARNESS_SPIKE_ROOT` (temp dir in tests); real-path containment; 64 KiB cap | `list_dir` under a root; a pure tool with no files (`get_time`) |
| Provider for the spike | The user's agentgateway (OpenAI-compatible) through the `openai` SDK only; Anthropic moves to `p1-provider-interface` | Anthropic via `@anthropic-ai/sdk` (original brief); both providers in the spike |
| Model and endpoint | `qwen3.8-flash-next-nothink` at `http://spark-8013.taileaa4a8.ts.net:4100`, all three settable via `HARNESS_SPIKE_BASE_URL`, `HARNESS_SPIKE_API_KEY`, `HARNESS_SPIKE_MODEL`; whether the base needs `/v1` is checked by the record script | `claude-opus-5-5`, `claude-haiku-5-5`, `claude-sonnet-5-5` on Anthropic |
| Fixture source | Recorded from agentgateway by a dev script (`AGENTGATEWAY_BASE_URL`, `AGENTGATEWAY_API_KEY`); it saves only response bodies, never request headers, and checks the key is absent before writing; the user runs it once during the build | Hand-built fixture plus a record script; hand-built only |
| Live test | `tests/live`, excluded from `pnpm test`; `pnpm test:live` runs it; skips unless `HARNESS_SPIKE_BASE_URL` is set; CI never runs it | `describe.skipIf` inside `pnpm test` |
| Spike variables reaching the agent | `agentEnv` allowlists OS basics (`PATH`, `SystemRoot`, `TEMP`, `TMP`, `HOME`, `USERPROFILE`, `LANG`) and the flags; `HARNESS_SPIKE_*` pass only when `HARNESS_AGENT_SPIKE=1` | Always pass the spike variables when set |

## Approach

1. **Dependency.** Add `openai` as a runtime dependency (the agent bundle externalizes deps, so it must be in `dependencies` for packaging).
2. **Protocol** (`src/shared/agent-protocol.ts`): add `{ type: 'tool-call-result'; id; ok: true; output: string }` (output bounded; the existing 4096-char string limit is raised for this field to the 64 KiB tool cap) and keep the denied form. Add an error code for a tool that was allowed but failed (`failed`). Guards and tests on both sides.
3. **Gate** (`src/main/policy/gate.ts`): allow `reader` + `read_file` when `args` is exactly `{ path: string }`; deny the rest with the current reason. Update `tests/unit/policy-gate.test.ts`.
4. **Tool runner** (`src/main/tools/read-file.ts`, pure apart from `fs`): resolve against the root with `realpath`, refuse escapes, non-files and missing root; read up to 64 KiB. Unit tests with a temp dir, including a symlink escape.
5. **Router** (`src/main/agent/router.ts`): on allow, call an injected `runTool` and reply with output or a `failed` error; on deny, unchanged. Log job, tool and outcome only, never args or output. The handler becomes async; `host.ts` awaits it.
6. **Agent loop** (`src/agent/loop.ts`): pure function taking an OpenAI client, model, prompt and a `callTool(name, args) => Promise<result>`; streams chat completions with one tool definition, accumulates tool-call deltas, sends the call to main, appends the `tool` message, continues until `finish_reason` is `stop` or 4 turns. Emits text chunks through a callback. `src/agent/index.ts` wires it to `parentPort` when `HARNESS_AGENT_SPIKE=1`, matching results to requests by id (with a timeout).
7. **Env** (`src/main/agent/host.ts`): allowlisted `agentEnv`, tests that other variables (including a fake key when the flag is off) are dropped.
8. **Fixture and tests**: `scripts/record-spike-fixture.ts` records the two streaming responses (tool call, then final answer) into `tests/fixtures/spike/*.sse`; a unit test replays them through an injected `fetch` and asserts the full loop, the gate check, and that a sentinel key never appears in captured output. `tests/live/spike.live.test.ts` and `pnpm test:live`.

9. **Documentation, so nothing drifts.** In the same commit as the code:
   - `CHANGELOG.md`, `[Unreleased]` → Added: the agent loop spike, the `read_file` tool and its root, the allowlisted agent env, `pnpm test:live`.
   - `README.md` commands table and `CLAUDE.md` Commands: add `pnpm test:live` (opt-in, needs `HARNESS_SPIKE_BASE_URL`, never in CI) and the record script; a short "Run the spike" note listing `HARNESS_AGENT_SPIKE`, `HARNESS_SPIKE_BASE_URL`, `HARNESS_SPIKE_API_KEY`, `HARNESS_SPIKE_MODEL`, `HARNESS_SPIKE_ROOT`.
   - `docs/decisions.md`: amend D17 (the live suite in `tests/live`, outside `pnpm test`) and D19 (an allowed call now runs in main and its output returns in `tool-call-result`; the gate still denies by default), in the existing "Amended:" style; no settled outcome is rewritten.
   - `docs/phases/phase-00-progress.md`: strike the "allowlisted agent env" follow-up as done.
   - Before the spec is approved (now, outside the build): `docs/phases/phase-01-progress.md` notes that subtask 1 runs on agentgateway and that the Anthropic adapter and the two-provider check move to `p1-provider-interface`.
   - A final task greps the docs for stale statements (for example "no tools are allowed yet", "full copy of the app's environment", "tool execution is not available yet") and fixes any that the change made false.

## Verified assumptions

| Assumption | Evidence |
| --- | --- |
| The gate denies everything today and is pure | `src/main/policy/gate.ts` returns deny with `NO_TOOLS_REASON` |
| The router refuses an allow and has no execute path | `src/main/agent/router.ts` `NOT_EXECUTABLE_REASON` branch |
| `tool-call-result` success carries no payload today | `src/shared/agent-protocol.ts` `MainToAgentMessage` |
| `agentEnv` copies the whole app environment | `src/main/agent/host.ts` `agentEnv` |
| Unit tests include only `tests/unit/**/*.test.ts` | `vitest.config.ts` `include` |
| The existing gate test expects `reader`/`read_file` to be denied and must change | `tests/unit/policy-gate.test.ts` `TOOLS` list |
| `openai` is not installed yet | `node_modules/openai` absent |
| agentgateway is reachable from this machine and needs a key | `GET /v1/models` and `GET /models` both return 401 "authentication failed" |

## Risks

- **Base path unknown** (`/v1` or not): both paths return 401 without a key. The record script calls `GET {base}/models` first and stops with a hint on 404.
- **Open-weight tool calls stream differently** (arguments split across deltas, missing `index`, or a tool call in plain text): the recorded fixture shows the real shape; the loop treats unparseable arguments as a tool error sent back to the model, not a crash.
- **Async router** changes how `host.ts` handles replies; existing router tests reveal any break.
- **Fixture leaks**: the record script saves bodies only and refuses to write if the key string appears; a unit test greps the fixture files for `Authorization` and the sentinel key.

## Open questions

- (none)
