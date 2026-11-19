# Plan: p1-provider-interface

Ticket: none (vibe planning; Phase 1, subtask 3)
Status: approved
Date: 2026-11-19

## Objective

Put a provider interface between the agent loop and the model SDKs. The interface covers messages, tool calls, streaming, token usage, errors and retries. Two adapters sit behind it: an Anthropic Messages adapter (new, `@anthropic-ai/sdk`) and a minimal OpenAI-compatible adapter (today's `openai` code, moved). The spike loop runs on the interface. Both adapters are tested with fixtures recorded through agentgateway and with the opt-in live suite, which covers the phase's "same loop runs against Anthropic and an OpenAI-compatible server". In development and the pilot, every model is reached through agentgateway; that is recorded as a new decision.

## Scope

- **In:**
  - Provider-neutral types and a `Provider` interface in the agent (no SDK type crosses it, D23).
  - The loop in `src/agent/loop.ts` rewritten against the interface.
  - An Anthropic adapter and a minimal OpenAI-compatible adapter (base URL and optional key only).
  - Normalized errors and retries; token usage per turn and per run.
  - Spike provider choice by `HARNESS_SPIKE_PROVIDER`, and one store entry `agentgateway`.
  - Re-recorded fixtures for both wire formats, from agentgateway.
  - Live suite for both formats.
  - The spike e2e close check tightened.
  - D26, D25 and D23 notes, CHANGELOG, CLAUDE.md, README, phase progress.
- **Out:**
  - OpenAI-compatible presets and custom headers (`p1-openai-compatible`).
  - `/models` listing and probes (`p1-model-probes`).
  - Any settings UI (Phase 8).
  - Cloud platforms (Bedrock, Azure, Vertex).
  - The async `safeStorage` move and the open `p1-secrets` notes.
  - Running the spike e2e on the Anthropic format: CI covers that format with unit fixture tests.

## Decisions

| Question | Decision | Alternatives considered |
| --- | --- | --- |
| Feature slug, repo, base branch | `p1-provider-interface`, sdd-harness, `main` → `feature/p1-provider-interface` | (defaults, not asked) |
| Where the Anthropic fixtures come from | Recorded through agentgateway. It passes `claude-*` models to Anthropic unchanged, so the shapes are Anthropic's. `POST {base}/v1/messages` with base `http://spark-8013.taileaa4a8.ts.net:4100` (no `/v1`: the Anthropic SDK adds it), model `claude-haiku-5-5`, small `max_tokens`. Auth: the gateway key as `Authorization: Bearer` (SDK `authToken = key`, `apiKey = null`), because the gateway rejects `x-api-key` with 401. The `Authorization` header is never saved, and the recorder refuses to write if the key appears in a body. | Recorded from api.anthropic.com with the user's own Anthropic key; hand-written from the docs (drifts from the real API, against D24) |
| How the spike picks its provider and key | `HARNESS_SPIKE_PROVIDER=openai\|anthropic` (default `openai`) picks only the wire format. One store entry, `agentgateway`, holds the gateway key for both; main reads it and sends it in `model-key` (D25). One `HARNESS_SPIKE_BASE_URL` (`http://spark-8013.taileaa4a8.ts.net:4100`). The OpenAI adapter appends `/v1`; the Anthropic adapter uses the URL as is. | Two store entries (`spike`, `spike-anthropic`); one entry named `spike` |
| How much of the OpenAI path changes | Minimal adapter: today's code moves behind the interface, with base URL and optional key only | Add custom headers now (bigger subtask, smaller next one) |
| Default Anthropic spike and live model | `claude-haiku-5-5`, overridable with `HARNESS_SPIKE_MODEL`. The OpenAI default stays `qwen3.8-flash-next-nothink`. | `claude-sonnet-5-5`; `claude-opus-5-5` |
| New decision (user's instruction) | **D26:** in development and the pilot, every model is reached through agentgateway. Anthropic-format calls use Bearer auth (`authToken`), not `x-api-key`; OpenAI-format calls use the base URL plus `/v1`. The agentgateway preset (built in `p1-openai-compatible`) offers both formats. | (not asked; the user's instruction) |
| `/v1` on the base URL (default) | The OpenAI adapter strips trailing slashes and appends `/v1` unless the URL already ends in `/v1`, so an old setting with `/v1` still works | Always append (breaks a URL that already has `/v1`) |
| Anthropic auth modes (default) | The adapter takes `auth: 'bearer' \| 'x-api-key'`; the spike and the live suite use `bearer` (D26). `x-api-key` is there for direct Anthropic use later. The adapter always passes `baseURL`, `apiKey` and `authToken` explicitly, so the SDK never reads `ANTHROPIC_*` from the environment. | Bearer only (direct Anthropic would need adapter changes later) |
| Retries (default) | Use the SDKs' built-in retries (429, 5xx, connection errors, with backoff). The adapter config takes `maxRetries`: default 2, and 0 in fixture tests. The interface also takes an `AbortSignal`. Errors are normalized to `ProviderError { kind: 'auth' \| 'rate-limit' \| 'server' \| 'network' \| 'bad-request' \| 'aborted' \| 'unknown', status?, retryable }`. Its message never holds request details or the key (it replaces `describeError`'s role). | Our own retry loop around the SDK (duplicates the SDK) |
| Token usage (default) | Each turn reports `{ inputTokens, outputTokens }` (plus cache reads and writes when the provider sends them), and the run reports the totals. The OpenAI adapter asks for `stream_options: { include_usage: true }`. The spike prints the totals in its finished line. A provider that sends no usage gives `null`, not zeros. | Totals only (no per-turn data for later cost tracking) |
| Old `spike` store entry (default) | No longer read. The docs say to run `pnpm secrets:set agentgateway`. | Read `spike` as a fallback (two names to explain) |

## Approach

1. **Types and interface:** `src/agent/provider/types.ts`.
   - Neutral messages: user text; assistant text plus tool calls; tool results.
   - Tool definitions: name, description, JSON schema.
   - Stream events: text delta; tool call (id, name, arguments as a JSON string); usage; done, with a stop reason.
   - `ProviderError` and `Provider.stream(request, signal)` returning an async iterable of events.
   - No import from either SDK.
2. **OpenAI adapter:** `src/agent/provider/openai.ts`.
   - The current streaming and tool-call delta merging (`mergeToolCallDelta`), moved from `loop.ts`.
   - Neutral messages are mapped to chat messages, and the `include_usage` usage chunk becomes a usage event.
   - Takes an injected `fetch` (D24).
3. **Anthropic adapter:** `src/agent/provider/anthropic.ts`. Uses `@anthropic-ai/sdk` `messages.stream`, or `create` with `stream: true`.
   - Content blocks map to events: `text_delta` becomes text; a `tool_use` block plus its `input_json_delta` pieces becomes a tool call; `message_start` and `message_delta` usage become usage.
   - Tool results are sent as `tool_result` blocks in a user message.
   - `max_tokens` is required by the API: default 1024, configurable.
   - Bearer or `x-api-key` auth; injected `fetch`.
4. **Errors:** `src/agent/provider/errors.ts` maps each SDK's `APIError`, connection and abort errors to `ProviderError`. `src/agent/errors.ts` (`describeError`) is folded into it or delegates to it.
5. **Loop:** `src/agent/loop.ts` takes a `Provider` instead of an `OpenAI` client.
   - It keeps `MAX_TURNS`, `READ_FILE_TOOL` (now neutral), `runCall` and the tolerant argument parsing.
   - It adds per-turn and total usage to `LoopResult`.
6. **Spike wiring:**
   - `src/agent/index.ts` builds the adapter from `HARNESS_SPIKE_PROVIDER`.
   - `src/main/agent/host.ts` adds `HARNESS_SPIKE_PROVIDER` to the spike variables passed to the agent.
   - `src/main/agent/model-key.ts` sets the key name to `agentgateway`.
7. **Fixtures:**
   - `scripts/record-spike-fixture.ts` gets a format argument (`openai` or `anthropic`). It writes `tests/fixtures/spike/openai/*` and `tests/fixtures/spike/anthropic/*`.
   - The OpenAI recording is redone with `include_usage`.
   - Both formats use `AGENTGATEWAY_BASE_URL` without `/v1`, and the same key checks.
   - The user runs it by hand with their gateway key in their own shell. The key is never typed in chat.
8. **Tests:**
   - Unit tests per adapter replay the fixtures through an injected `fetch`: events, tool-call assembly, usage, error mapping (401, 429, 500, network, abort) and retry count with `maxRetries`.
   - The loop is tested against a fake `Provider`, plus one end-to-end replay per format.
   - Leak checks: no key in thrown errors or event data.
   - The live suite runs once per format when `HARNESS_SPIKE_BASE_URL` is set, with the key from `HARNESS_SPIKE_API_KEY` as today. It is still never run in CI.
9. **Spike e2e:**
   - It keeps the OpenAI format against its local fixture server, now serving the `openai/` fixtures under `/v1`.
   - The seed run stores the sentinel under `agentgateway`.
   - The close check waits on the app's close event instead of checking for no "agent exited unexpectedly" line.
10. **Docs:**
    - D26 is added. D23 gets a note that the interface now exists, D25 one that the spike entry is `agentgateway`.
    - CHANGELOG `[Unreleased]`.
    - CLAUDE.md and README: the spike section, `pnpm secrets:set agentgateway`, `HARNESS_SPIKE_PROVIDER`, the base URL without `/v1`, and the record command per format.
    - Phase progress follow-ups.

## Verified assumptions

| Assumption | Evidence |
| --- | --- |
| The loop is tied to the `openai` SDK and is the only model caller | `src/agent/loop.ts:11` imports `OpenAI` types; `src/agent/index.ts:76` builds the client |
| The key name is one constant in main | `src/main/agent/model-key.ts:10` `SPIKE_KEY_NAME = 'spike'` |
| Spike variables passed to the agent are an explicit list | `src/main/agent/host.ts:37` `SPIKE_VARS` |
| The error describer names errors without messages (pattern to keep) | `src/agent/errors.ts` |
| The recorder already reads `AGENTGATEWAY_BASE_URL` and `AGENTGATEWAY_API_KEY`, refuses on key leaks and saves only bodies | `scripts/record-spike-fixture.ts:1-10,234-235` |
| The fixtures are OpenAI-format SSE, in one folder | `tests/fixtures/spike/turn1-tool-call.sse`, `turn2-final.sse` |
| `@anthropic-ai/sdk` is not installed yet | `package.json` dependencies: only `openai` |
| The gateway's Anthropic route, Bearer auth and the 401 on `x-api-key` | Stated by the user (not run here); the recording step confirms it |
| `@anthropic-ai/sdk` accepts `apiKey: null`, `authToken`, `baseURL`, `fetch` and `maxRetries` | SDK client options; checked against the installed version in the build |
| D26 is the next free decision number | `docs/decisions.md` ends at D25 |

## Risks

- **The OpenAI usage chunk.** It arrives with an empty `choices` array; the old loop skipped such chunks. The OpenAI adapter test with the re-recorded fixture will show whether usage is read.
- **Anthropic tool-call arguments.** They stream as partial JSON; an empty `input` gives `""` and must become `{}`. The fixture replay and a unit case cover it.
- **Fixture recording needs the user's gateway key.** If the recording is blocked, the build pauses at that task; the fixtures are not hand-written.
- **Moving the fixtures** to `openai/` and `anthropic/` touches the e2e fixture server. The spike e2e on all three OSes in CI catches a wrong path.
- **Changing the e2e close check** could make it flaky on one OS. The CI matrix shows it before merge.

## Open questions

(none)
