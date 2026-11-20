---
status: done
ticket:
---

# p1-model-probes

## Problem

Before the harness assigns a model to a job, it needs to know what the model can do. F6 asks for tests per model, and a model that fails tool use cannot write or review code. Today the provider layer can only stream a reply (`Provider.stream`). It cannot list a server's models, and nothing measures whether a model chats, calls tools reliably, or how fast it answers. The Phase 8 "Test and assign" screen (`docs/design/screens/Models3Test.dc.html`) needs that data:
- per model: Chat, Use tools, Context and Speed in tok/s;
- per server: how fast it answered.

## Goals

- **G1:** Both adapters list a server's models through the neutral interface, with each model's context window when the server reports it.
- **G2:** A probe module in the agent process runs a chat probe and a two-step tool-use probe per model, several times. It reports passed, unreliable or failed, latency and speed as plain data that a later UI and protocol message can carry unchanged.
- **G3:** Fixture tests recorded from agentgateway prove the listing, the probes, the status rules, the timing and the leak rules in CI. The opt-in live suite runs the probes against agentgateway in both formats.
- **G4:** D28 records the probe rules, and the docs match the code. Afterwards, the phase's Definition of done is checked item by item.

## Non-goals

- Agent-protocol messages (`run-probes` and `probe-result`), a main-side handler, and any UI. Phase 8 does these.
- The "Edit a file and run tests" probe (Phase 8; it needs Phase 2 tools).
- The "Good for" column and job assignment.
- Running probes in parallel.
- Storing or caching results.
- Cloud platforms, and direct api.anthropic.com with `x-api-key` (D26).
- The async `safeStorage` move, and the open `p1-secrets` notes.

## Acceptance criteria

- **AC1 (listing interface):** `src/agent/provider/types.ts` adds:
  - `ModelInfo { id: string; contextWindow: number | null }`;
  - `listModels(signal?: AbortSignal): Promise<ModelInfo[]>` on `Provider`.

  Failures are thrown as `ProviderError` through `toProviderError`, as `stream` does. No SDK type crosses the interface (D23). Every existing `Provider` implementation and test double still typechecks: a test fake may implement `listModels` by throwing or returning `[]`.

- **AC2 (OpenAI-format listing):**
  - `createOpenAIProvider`'s `listModels` calls `GET {normalized base}/models` (that is, `/v1/models`) through the SDK's `client.models.list()`. It collects every page and returns each entry's `id`.
  - `contextWindow` is the first positive integer among the entry's `max_model_len`, `context_length` and `context_window` fields, else `null`.
  - Entries without a string `id` are skipped.
  - Extra headers (D27) and the key are sent as they are for chat.
  - Test-checked through the injected `fetch`: the path, a context window present and absent, and an HTTP error mapped to the right kind.

- **AC3 (Anthropic-format listing):**
  - `createAnthropicProvider`'s `listModels` calls `GET {normalized base}/v1/models` through the SDK's `client.models.list()` and collects every page.
  - `contextWindow` is `max_input_tokens` when it is a positive integer, else `null`.
  - Bearer auth, `anthropic-version` and extra headers are unchanged (D26, D27).
  - Test-checked: the path for the `/v1` and no-`/v1` base forms, a context window present and absent, and an error mapped to the right kind.
  - If the recording shows that agentgateway answers this path in the OpenAI list shape (`{ data: [{ id }] }` with no Anthropic fields), the adapter still returns the ids with `contextWindow` from the AC2 fields. Either way, D28 records what agentgateway returned.

- **AC4 (probe result types):** `src/agent/probes/types.ts` exports plain, JSON-safe types (no class instances, functions or `Date` objects; test-checked with a `JSON.parse(JSON.stringify(x))` round trip):
  - `ProbeStatus = 'passed' | 'unreliable' | 'failed'`.
  - `ProbeFailure`, one of:
    - `'missing-token'`, `'no-tool-call'`, `'wrong-tool'`, `'bad-arguments'`, `'wrong-arguments'`, `'timeout'`;
    - a `ProviderErrorKind` (`'auth'`, `'rate-limit'`, `'bad-request'`, `'server'`, `'network'`, `'aborted'`, `'unknown'`).
  - `ProbeResult { status; runs: number; passes: number; latencyMs: number | null; tokensPerSecond: number | null; failures: ProbeFailure[] }`. `failures` holds one entry per failed run, in run order.
  - `ModelProbeResult { model: string; contextWindow: number | null; chat: ProbeResult; toolUse: ProbeResult; tokensPerSecond: number | null }`.
  - `ServerListing = { ok: true; latencyMs: number; models: ModelInfo[] } | { ok: false; latencyMs: number; failure: ProviderErrorKind | 'timeout' }`.

  No field holds free text from a server, a header, the address or the key.

- **AC5 (chat probe):** `src/agent/probes/chat.ts`. One run is one `stream` request:
  - **Prompt and limits:** a fixed prompt asking for a reply that contains the fixed token `PROBE-OK`, no tools, `maxTokens` from the options.
  - **Pass:** the concatenated text contains `PROBE-OK` (case-insensitive).
  - **Fail:** without the token, `missing-token`; a thrown `ProviderError`, its kind; the request timeout, `timeout`.

- **AC6 (tool-use probe):** `src/agent/probes/tool-use.ts`. One run is up to two `stream` requests. The tool is `lookup_code`: one required string parameter `name`, `additionalProperties: false`. The prompt asks the model to look up the code for the name `harness` with the tool, then reply with the code.
  - **Step 1** passes when the reply has at least one tool call and the first is named `lookup_code`. Its arguments must parse as a JSON object whose `name`, trimmed and lowercased, is `harness`. Otherwise the run fails with:
    - `no-tool-call`: no call;
    - `wrong-tool`: another name;
    - `bad-arguments`: unparseable JSON, or not an object;
    - `wrong-arguments`: a missing or different `name`.
  - **Step 2** sends the assistant turn with that tool call and a tool message whose content is the fixed result `The code for harness is ZEBRA-7341.` It passes when the reply's text contains `ZEBRA-7341` (case-insensitive); otherwise the run fails with `missing-token`. The second request still offers the tool.
  - **Errors:** a `ProviderError` or a timeout in either step fails the run with its kind or `timeout`.

- **AC7 (runner, status and timing):** `src/agent/probes/run.ts` exports `listServerModels(provider, options)` and `probeModel(provider, model, contextWindow, options)`. The options are:
  - `runs` (default 3, at least 1);
  - `timeoutMs` per request (default 60000);
  - `maxTokens` (default 256);
  - `now: () => number` (default `performance.now`);
  - `signal?: AbortSignal`.

  **Order and timeouts:** runs go one after another: chat runs first, then tool-use runs. Each request gets its own `AbortSignal` that fires on its timeout or on the caller's signal.

  **Caller abort:** if the caller's signal aborts, the runner stops and rethrows `ProviderError('aborted')`; it does not return a partial result.

  **Status:** `passed` when every run passed, `failed` when none did, `unreliable` otherwise. `passes` counts the passing runs.

  **Latency and speed:**
  - A request's latency is `now()` at its first stream event of any kind, minus `now()` just before the request.
  - A run's latency is that of its first request.
  - `latencyMs` is the median, rounded to whole ms, over runs whose first request produced an event; else `null`.
  - A request's speed is `outputTokens / ((tLast − tFirst) / 1000)`. `tFirst` and `tLast` are the times of its first and last stream events, and `outputTokens` comes from its `usage` event.
  - A run's speed is its total output tokens over its total stream time, across its requests. It is `null` when any of its requests had no usage event or zero stream time.
  - `tokensPerSecond` is the median, rounded to one decimal, over runs with a speed; else `null`.
  - `ModelProbeResult.tokensPerSecond` is the median over the run speeds of both probes.

  **Listing:** `listServerModels` returns a `ServerListing`. `latencyMs` is the round trip of `listModels`, rounded to whole ms. A thrown `ProviderError` gives `ok: false` with its kind, and a timeout gives `ok: false` with `'timeout'`.

  **Tests:** a fake provider and a fake clock cover each status rule, the medians (odd and even counts), null speed, timeouts, caller abort, and a failure list per run.

- **AC8 (leak rules):**
  - Probe results and listing results never contain the key, a header value, the address, or text from a server error. They hold only the types in AC4, plus model ids and numbers from `/models`.
  - The probe module never logs, never reads the environment, and imports no SDK and nothing from `src/main` (test-checked by import scan).
  - Unit tests use sentinel key and header values through the factory and the injected `fetch`. They assert the sentinels appear in no result, no thrown error message, and nothing written to `console`.

- **AC9 (recorder and fixtures):**
  - **The script:** a dev-only script, `scripts/record-probe-fixtures.ts`, runs as `pnpm record:probes [openai|anthropic]` (default openai). It uses `AGENTGATEWAY_BASE_URL` (root, without `/v1`), `AGENTGATEWAY_API_KEY` and optional `AGENTGATEWAY_MODEL` (the same defaults as `record:spike`). It is modelled on `scripts/record-spike-fixture.ts`.
  - **What it writes**, to `tests/fixtures/probes/<format>/`:
    - `models.json`: the `/models` body;
    - `chat.sse`;
    - `tool-turn1.sse` and `tool-turn2.sse`.

    It uses the probe module's own prompts, tool and token constants, imported from `src/agent/probes/`, so the fixtures match the probes.
  - **Safety:** it saves response bodies only, never request headers. It never prints the key, and it refuses to write any file that contains the key string.
  - **Before the user's recording:** until the user runs it, the implementor commits fixtures in the same shapes, written to match what the recorder produces. The user runs the recorder for both formats before result approval, and the unit tests must pass on the recorded files.
  - **Failing fixtures:** fixtures for the failing cases are derived from the recorded ones in the tests (for example, a text-only reply to the tool prompt), not recorded.

- **AC10 (fixture tests):** unit tests replay the probe fixtures through `createProvider` and the injected `fetch`, for both formats. They show:
  - listing returns the recorded models;
  - the chat probe and the tool-use probe pass on the recorded streams;
  - a run of mixed fixtures gives `unreliable`;
  - the failure codes of AC5 and AC6;
  - timing with a fake clock.

  Existing tests still pass.

- **AC11 (live suite):** `tests/live/probes.live.test.ts`, opt-in like `spike.live.test.ts`:
  - **Setup:** the same variables, `createProvider` with `maxRetries: 0`, and a key only from `HARNESS_SPIKE_API_KEY`, never printed.
  - **What it checks:** for each format the preset offers, it lists the models (non-empty, `ok: true`), probes the spike's default model for that format (or `HARNESS_SPIKE_MODEL`), and asserts chat and tool use are not `failed`.
  - **Output:** it prints only the result data (status, passes, latency, speed, context window), never the key or headers.
  - **Skipping:** it skips when no address results. It never runs in CI.

- **AC12 (docs):**
  - **D28** in `docs/decisions.md`, covering:
    - listing per format and the context-window fields;
    - the two probes and their fixed checks;
    - "unreliable" as runs that disagree, with 3 runs by default;
    - the latency and speed definitions: time to the first event of any kind, which includes thinking, and a speed that is indicative;
    - the result shape kept plain for Phase 8;
    - what agentgateway's Anthropic-format `/v1/models` returned.
  - **CHANGELOG:** Added entries.
  - **CLAUDE.md:** the `record:probes` command and the live-suite line.
  - **README:** the matching rows.
  - **package.json:** the `record:probes` script.
  - **Phase progress:** row 5 and the follow-ups.

- **AC13 (full check):** `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm e2e` passes on Windows. The user runs `pnpm record:probes` for both formats, then `pnpm test:live`, before result approval. CI is green on all three OSes before merge.

## Open questions

- none
