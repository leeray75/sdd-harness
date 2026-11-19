---
status: done
ticket:
---

# p1-spike-agent-loop

## Problem

The agent process is a stub: it never calls a model, and main refuses every tool call, even one the gate would allow, because no tool runs anywhere. Before the provider layer is designed, the harness needs proof that the whole loop works: a model streams a reply, asks for a tool, main checks the call and runs it, and the model finishes with the result. The agent also still gets a full copy of the app's environment (a Phase 0 follow-up), which must end before it receives a real key.

## Goals

- **G1:** A minimal agent loop in the agent process that streams a chat completion from an OpenAI-compatible server through the `openai` SDK (D23), with base URL, optional key and model from `HARNESS_SPIKE_BASE_URL`, `HARNESS_SPIKE_API_KEY` and `HARNESS_SPIKE_MODEL`, and stops after at most 4 model turns.
- **G2:** One read-only tool, `read_file {path}`, for the `reader` job only. The gate allows that and nothing else; main runs it inside one root (`HARNESS_SPIKE_ROOT`) and returns its text over the typed channel.
- **G3:** An allowlisted agent environment, with the `HARNESS_SPIKE_*` variables passed only when `HARNESS_AGENT_SPIKE=1`.
- **G4:** Proof without keys or network (D24): a fixture recorded from the user's agentgateway, replayed in `pnpm test`, plus an opt-in live suite.
- **G5:** Documentation that matches the code when the work lands.

## Non-goals

- The Anthropic adapter, `@anthropic-ai/sdk`, and the check that the same loop runs on both providers (moved to `p1-provider-interface`).
- The provider interface, retries, token usage accounting and error classes (`p1-provider-interface`).
- Keychain storage and redaction (`p1-secrets`); the spike reads its key from the environment, in dev only.
- Write tools, command running and the per-job policy table (Phase 2).
- Escaping control characters in agent-supplied strings in logs (Phase 2 follow-up).
- Any UI, and any change to the renderer bridge.
- Running the live suite in CI.

## Acceptance criteria

- **AC1:** `package.json` lists `openai` under `dependencies` (not `devDependencies`), and `pnpm build` bundles the agent with it external.
- **AC2:** `src/shared/agent-protocol.ts` adds a success `tool-call-result` with `output: string` (at most 65,536 characters) and a `failed` error code alongside `denied`. Both guards accept the new forms and reject malformed ones (missing or non-string `output`, oversized `output`, unknown error code), with unit tests. Main logs a rejected agent message and does not reply (D19).
- **AC3:** `checkToolCall` allows only job `reader` with tool `read_file` and `args` exactly `{ path: string }`. Every other job, tool or args shape is denied with a non-empty reason. Unit tests cover the allow case and the denials, including `read_file` for the other three jobs and `read_file` with extra or missing args.
- **AC4:** A denied call never reaches the tool runner (a unit test with a spy runner proves it). An allowed call goes to the injected runner, and its output or failure returns to the agent as `tool-call-result` with the request's id. The router logs job, tool and outcome only, never args or output.
- **AC5:** Main's `read_file` reads only regular files inside `HARNESS_SPIKE_ROOT` after resolving real paths. It returns a `failed` result for: no root configured, absolute paths, `..` escapes, a symlink that resolves outside the root, a directory, a missing file, and a file over 64 KiB (the error states the cap and does not return a partial file). Unit tests use a temp dir and cover each case; the symlink test is skipped where the OS refuses to create symlinks.
- **AC6:** The agent loop (`src/agent/loop.ts`) is a pure function of an OpenAI client, model, prompt, a `callTool` function and a text callback. With the recorded fixture replayed through an injected `fetch`, a unit test sees streamed text chunks, then exactly one `read_file` call passed to `callTool`, then a second request whose messages include the tool result, then the final text. The loop stops at 4 turns, and a tool call with unparseable arguments is sent back to the model as a tool error rather than throwing; both have unit tests.
- **AC7:** With `HARNESS_AGENT_SPIKE=1`, the agent runs the loop once after the ping/pong handshake, sends the tool call to main as a `tool-call-request` with job `reader`, waits for the matching result (30 s timeout, reported as a tool error), and writes the streamed text to its stdout. Without the flag the agent behaves as today, and the self-check is unchanged.
- **AC8:** `agentEnv` passes only `PATH`, `Path`, `SystemRoot`, `WINDIR`, `TEMP`, `TMP`, `HOME`, `USERPROFILE`, `LANG`, `HARNESS_AGENT_SELFCHECK` and `HARNESS_AGENT_SPIKE`, plus `HARNESS_SPIKE_BASE_URL`, `HARNESS_SPIKE_API_KEY` and `HARNESS_SPIKE_MODEL` only when `HARNESS_AGENT_SPIKE=1`. On Windows (`process.platform === 'win32'`) names match the allowlist case-insensitively (so `SYSTEMROOT`, `Path` and `windir` pass) and keep the parent's spelling; on other platforms they match case-sensitively. `agentEnv` takes the platform as a parameter so both rules are unit tested on any OS. Unit tests show other variables (for example `ANTHROPIC_API_KEY`, `AGENTGATEWAY_API_KEY`, `HARNESS_SPIKE_ROOT`, `COMSPEC`) are dropped, that upper-case `SYSTEMROOT` passes on win32 and not on linux, and that the spike variables are dropped when the flag is off. An e2e test (`tests/e2e`) starts the built app with `HARNESS_AGENT_SPIKE=1`, `HARNESS_SPIKE_BASE_URL` pointing at a local server in the test that replays the recorded fixtures, and `HARNESS_SPIKE_ROOT` at a temp dir with the requested file; it asserts from main's log that the `read_file` call ran and the spike finished, so the allowlisted agent is shown to open a socket on all three CI OSes.
- **AC9:** `scripts/record-spike-fixture.ts` reads `AGENTGATEWAY_BASE_URL`, `AGENTGATEWAY_API_KEY` and an optional model (default `qwen3.8-flash-next-nothink`). It first calls `GET {base}/models` and stops with a message that suggests adding or removing `/v1` on a 404. It then records the two streaming response bodies of one `read_file` round trip into `tests/fixtures/spike/`. It saves response bodies only, never request headers, and refuses to write if the key string appears in any body. The committed fixture comes from the user's run during the build.
- **AC10:** No key appears in logs, errors or test output. The fixture unit test runs with a sentinel key and asserts that the sentinel is absent from everything the loop, router and logger write, and that the fixture files contain neither `Authorization` nor the sentinel.
- **AC11:** `pnpm test:live` runs `tests/live/**/*.live.test.ts` (not included in `pnpm test`). The live test completes the same loop against `HARNESS_SPIKE_BASE_URL` when it is set and is skipped otherwise. CI does not run it.
- **AC12:** Documentation matches the code: a `CHANGELOG.md` `[Unreleased]` entry; `pnpm test:live`, the record script and the spike variables in `README.md` and `CLAUDE.md`; D17 and D19 amended in `docs/decisions.md` in the existing "Amended:" style; the Phase 0 agent-env follow-up struck as done. A grep of `docs/`, `README.md`, `CLAUDE.md` and source comments finds no statement the change made false ("no tools are allowed yet", "tool execution is not available yet", "full copy of the app's environment").
- **AC13:** `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test` pass; existing unit tests still pass (changed only where this spec changes behaviour).

## Open questions

- 2026-11-18, revision 1: With the AC8 allowlist the agent could not open sockets in Electron on Windows (`connect UNKNOWN`), because the parent environment spells the variable `SYSTEMROOT` and the allowlist matched `SystemRoot` case-sensitively. Decided: match names case-insensitively on win32 only, keeping the parent's spelling (case-sensitive elsewhere); add `WINDIR` to the allowlist; do not add `COMSPEC` (the agent never spawns shells); require an e2e test proving the allowlisted agent completes the spike against a local fixture server on all CI OSes. Not chosen: adding neither or both of `WINDIR`/`COMSPEC`; unit-test-only proof.
