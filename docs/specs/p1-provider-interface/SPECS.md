---
status: approved
ticket:
---

# p1-provider-interface

## Problem

The spike's agent loop (`src/agent/loop.ts`) talks to the `openai` SDK directly. So it runs only on OpenAI-compatible servers, and SDK types leak into the loop, against D23. Phase 1's definition of done needs the same loop to run against Anthropic and an OpenAI-compatible server, with fixture tests in CI. There is no shared shape for messages, tool calls, streaming, token usage, errors or retries that later adapters, probes and the cost display can build on. In development and the pilot, every model is reached through agentgateway, which serves both wire formats with one gateway key.

## Goals

- **G1:** A provider interface in the agent process covers messages, tool calls, streaming, token usage, errors and retries, with no SDK type crossing it.
- **G2:** An Anthropic Messages adapter and a minimal OpenAI-compatible adapter implement it.
- **G3:** The spike loop runs on the interface, against either wire format through agentgateway, with one stored gateway key.
- **G4:** Both adapters are tested with fixtures recorded through agentgateway (CI) and with the opt-in live suite, and no key appears in any error, event, log or test output.
- **G5:** The decision to reach every model through agentgateway in development and the pilot is recorded (D26), and the docs match the code.

## Non-goals

- OpenAI-compatible presets and custom headers (`p1-openai-compatible`).
- `/models` listing and the chat and tool-use probes (`p1-model-probes`).
- Any settings UI (Phase 8).
- Cloud platforms (Bedrock, Azure, Vertex).
- The async `safeStorage` move, and the open `p1-secrets` notes.
- Running the spike e2e on the Anthropic format: CI covers that format with unit fixture tests.
- Reading the old `spike` store entry.

## Acceptance criteria

- **AC1 (neutral interface):** `src/agent/provider/types.ts` defines the provider-neutral types. It imports nothing from `openai` or `@anthropic-ai/sdk`.
  - Messages: a user message (text); an assistant message (text plus zero or more tool calls, each with id, name and arguments as a JSON string); a tool result (tool call id and content).
  - A tool definition: name, description and a JSON schema.
  - Stream events: `text` (a delta); `tool-call` (one complete call: id, name, arguments string); `usage`; `done` (stop reason `end` | `tool-use` | `max-tokens` | `other`).
  - `ProviderError`, from AC4.
  - `Provider` with `stream(request, signal?)`, which returns an async iterable of those events. The request holds model, messages, tools and, optionally, `maxTokens`.

  `src/agent/loop.ts` and `src/agent/provider/types.ts` import neither SDK. A unit test checks this by reading the two files' import statements.
- **AC2 (OpenAI-compatible adapter):** `src/agent/provider/openai.ts` exports a factory taking `{ baseURL, key, maxRetries?, fetch? }`. Its `baseURL` handling:
  - trailing slashes are stripped;
  - `/v1` is appended unless the URL already ends in `/v1`.

  It streams chat completions with the tools and with `stream_options: { include_usage: true }`. Text deltas become `text` events, in order. Tool-call deltas are merged, with the merge rules of today's `mergeToolCallDelta`: index or id slots, a name in one chunk and arguments in later ones, chunks with no choices, extra fields. Each call becomes one `tool-call` event when the reply ends; a missing id becomes `call_<n>`. The final usage chunk becomes a `usage` event. A `null` key sends the placeholder `no-key-set`.
- **AC3 (Anthropic adapter):** `src/agent/provider/anthropic.ts` exports a factory taking `{ baseURL, key, maxRetries?, maxTokens?, fetch? }`. It passes `baseURL` unchanged. _Revised in revision 1._
  - **Auth:** Bearer only (D26). It sets `authToken = key` and `apiKey = null`, so the request carries `Authorization: Bearer <key>`. `baseURL`, `apiKey` and `authToken` are always passed explicitly, so no `ANTHROPIC_*` variable is read. A `null` key sends the placeholder `no-key-set` as the Bearer token. There is no `x-api-key` mode: `@anthropic-ai/sdk` 1.10.0 sends `Authorization: Bearer` for `apiKey` too.
  - **Version:** the adapter sends the SDK's default `anthropic-version` and does not override it. If the gateway or Anthropic rejects that version during the re-recording (AC8) or the live run (AC13), the adapter pins `2023-06-01` through `defaultHeaders` instead, and the reason is recorded in `changes.md` and the ledger.
  - **Streaming:** it streams `POST /v1/messages` with the tools (neutral schema → `input_schema`). `max_tokens` is the request's `maxTokens`, else the factory's, else 1024.
  - **Events:** `text_delta` becomes `text`. A `tool_use` block, with its `input_json_delta` pieces joined, becomes one `tool-call` when the block stops; an empty input becomes `{}`. The usage from `message_start` and `message_delta` becomes one `usage` event. `stop_reason` maps to the `done` stop reason.
  - **History:** assistant tool calls become `tool_use` blocks, and tool results become `tool_result` blocks in a user message.
- **AC4 (errors and retries):** Both adapters use their SDK's built-in retries, with `maxRetries` (default 2) passed to the client, and both pass the signal through. Every failure is thrown as a `ProviderError` with:
  - `kind`: `auth` (401, 403), `rate-limit` (429), `bad-request` (other 4xx), `server` (5xx), `network` (connection or timeout), `aborted` or `unknown`;
  - `status`, when there is one;
  - `retryable`: true for `rate-limit`, `server` and `network`.

  Its message is built only from the kind and status. It never holds the SDK's message, a header, a URL query or the key. `src/agent/errors.ts`'s `describeError` returns the same safe text for a `ProviderError`. Unit tests cover 401, 429, 500, a network failure and an abort, for each adapter through an injected `fetch`. They also check that a 500 with `maxRetries: 1` makes 2 requests, with the SDK's backoff sped up or the test waiting for it.
- **AC5 (token usage):** A `usage` event holds `inputTokens` and `outputTokens`, plus `cacheReadTokens` and `cacheWriteTokens` when the provider sends them. `LoopResult` gains `usage`: the per-turn usage (or `null` for a turn that sent none) and the run totals (or `null` when no turn sent usage). The spike's finished line adds `input=<n> output=<n>`, or `usage=none`.
- **AC6 (loop on the interface):** `runAgentLoop` takes a `Provider` instead of an `OpenAI` client. It keeps its behaviour:
  - `MAX_TURNS`;
  - tool calls run in order through `callTool`;
  - unparseable arguments, non-object arguments and a throwing `callTool` go back to the model as `tool error: …` text;
  - text streams to `onText`;
  - `stopped` is `answered` or `turn-limit`.

  `READ_FILE_TOOL` becomes a neutral tool definition. The existing loop unit tests pass against a fake `Provider`, and a fixture replay per format passes too (AC9).
- **AC7 (spike wiring):**
  - **Provider choice:** `src/agent/index.ts` builds the adapter from `HARNESS_SPIKE_PROVIDER`. Unset or `openai` gives the OpenAI-compatible adapter. `anthropic` gives the Anthropic adapter (Bearer auth, D26). Any other value logs `spike skipped: HARNESS_SPIKE_PROVIDER must be openai or anthropic` and runs nothing.
  - **Model:** the default is `qwen3.8-flash-next-nothink` for `openai` and `claude-haiku-5-5` for `anthropic`; `HARNESS_SPIKE_MODEL` overrides it.
  - **Agent environment:** `src/main/agent/host.ts` passes `HARNESS_SPIKE_PROVIDER` to the agent only with the spike flag, like the other spike variables.
  - **Key name:** `SPIKE_KEY_NAME` in `src/main/agent/model-key.ts` is `agentgateway`. The `model-key` delivery is otherwise unchanged (D25).
  - **Tests:** the unit tests for the agent env, `model-key` and the provider choice are updated or added.
- **AC8 (recorder and fixtures):** `scripts/record-spike-fixture.ts` takes a format argument, `openai` (default) or `anthropic`; `pnpm record:spike` and `pnpm record:spike anthropic` both work.
  - **Base URL and paths:** it reads `AGENTGATEWAY_BASE_URL` without `/v1`. The `openai` format posts to `{base}/v1/chat/completions` with `include_usage`. The `anthropic` format posts to `{base}/v1/messages` with `Authorization: Bearer <key>`, model `claude-haiku-5-5` (overridable with `AGENTGATEWAY_MODEL`) and a small `max_tokens`. It sends `anthropic-version` from a named constant that equals the version the installed SDK sends (or `2023-06-01` if AC3's fallback applies). An adapter unit test checks that the SDK's request header equals that constant, so an SDK update that changes the version fails the test. _Revised in revision 1._
  - **What it writes:** two turns per format (tool call, then the final answer after a fixed tool result), saved to `tests/fixtures/spike/<format>/turn1-tool-call.sse` and `turn2-final.sse`. Only the response bodies are saved. It never prints the key, and it refuses to write if the key appears in a body.
  - **Recording checkpoint:** after the recorder change, the implementor stops with `NEEDS-SPEC-CHANGE: recording checkpoint`. The user runs both formats in their own shell with their gateway key, and the key never goes in chat. The build then resumes as a documented deviation (no spec change), with the new fixtures committed into the working tree. The old `tests/fixtures/spike/*.sse` files are removed.
  - **Anthropic re-recording checkpoint:** _Added in revision 1._ After the recorder sends the SDK's version, the implementor stops with `NEEDS-SPEC-CHANGE: anthropic re-record checkpoint`. The user re-records only the `anthropic` format, the same way. The build resumes as a documented deviation, with the re-recorded files in the working tree. If the re-recording is rejected because of the version, AC3's fallback applies.
- **AC9 (fixture tests on both formats):** Unit tests replay each format's fixtures through an injected `fetch`, with `maxRetries: 0`:
  - **Adapter level:** the expected text, one `read_file` tool call with valid JSON arguments, a `usage` event and the `done` reasons.
  - **Loop level:** `runAgentLoop` on each adapter finishes `answered` after one `read_file` call, with usage totals.
  - **Requests:** each test checks what the adapter sends: the path, the auth header *kind*, and no key in the body. The value is checked only as equal to a test sentinel; it is never printed.
  - **Key leaks:** a test checks that no thrown `ProviderError`, event or `describeError` text contains the sentinel key.
- **AC10 (live suite on both formats):** `tests/live/spike.live.test.ts` runs the loop once per format against `HARNESS_SPIKE_BASE_URL` (without `/v1`), with the key from `HARNESS_SPIKE_API_KEY`. It skips when the base URL is unset, and never runs in CI. Each format's default model is used unless `HARNESS_SPIKE_MODEL` is set. The key is never printed.
- **AC11 (spike e2e):** `tests/e2e/spike-agent.spec.ts` keeps the OpenAI format against its local fixture server.
  - **Fixtures and base URL:** the server serves the `openai/` fixtures at `/v1/chat/completions`, and the app gets a base URL without `/v1`.
  - **Key name:** the seed run stores the sentinel under `agentgateway`.
  - **Close check:** it waits for the app's close event (or the process exit) after `app.close()`, with a timeout, instead of checking for no "agent exited unexpectedly" line.
  - **Unchanged checks:** every existing check stays: the sentinel in every request header, no sentinel in any output or in `secrets.json`, the AC1 and AC2 diagnostics from `p1-secrets-ci`.
- **AC12 (dependency and docs):**
  - `@anthropic-ai/sdk` is added to `dependencies` with pnpm, and the lockfile is updated.
  - `docs/decisions.md` gains D26: in development and the pilot, every model is reached through agentgateway; Anthropic-format calls use Bearer auth (`authToken`), not `x-api-key`; OpenAI-format calls use the base URL plus `/v1`; the agentgateway preset (in `p1-openai-compatible`) offers both formats. It lists the alternatives not chosen.
  - D23 notes that the interface lives in `src/agent/provider/`, and D25 that the spike's entry is `agentgateway`.
  - `CHANGELOG.md` `[Unreleased]` has Added and Changed entries.
  - `CLAUDE.md` and `README.md` (where they describe the spike) give `pnpm secrets:set agentgateway`, `HARNESS_SPIKE_PROVIDER`, the base URL without `/v1` (`http://spark-8013.taileaa4a8.ts.net:4100`) and `pnpm record:spike [anthropic]`.
  - `docs/phases/phase-01-progress.md` gets the follow-ups.
- **AC13 (full check):** `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test` pass, and `pnpm e2e` passes locally on Windows. The PR's CI passes on all three OSes before merge. The user runs `pnpm test:live` once for both formats before the result approval, and it passes; its outcome is recorded in the summary report. It is not a CI gate. _Revised in revision 1._

## Open questions

- 2026-11-19, revision 1: the build stopped at T5 because `@anthropic-ai/sdk` 1.10.0 sends `Authorization: Bearer` for both `apiKey` and `authToken` and never sends `x-api-key` (`client.js` 450–462), so AC3's `x-api-key` mode could not be met. Decided: the adapter is Bearer only (AC3). Not chosen: sending `x-api-key` through `defaultHeaders`; pinning an older SDK; keeping the mode and documenting that it sends Bearer.
- 2026-11-19, revision 1: the SDK sends `anthropic-version: 2026-10-21` by default (`client.js` 979), while the fixtures were recorded with `2023-06-01`. Decided: use the SDK default, have the recorder send the same version, re-record the Anthropic fixtures through agentgateway (AC8), and have the user run `pnpm test:live` once before the result approval (AC13). If the gateway or Anthropic rejects the new version, pin `2023-06-01` through `defaultHeaders` and record why (AC3). Not chosen: pinning `2023-06-01` from the start.
