# Plan: p1-model-probes

Ticket: none (vibe planning; Phase 1, subtask 5, the last one)
Status: approved
Date: 2026-11-19

## Objective

Before the harness assigns a model to a job, it should know what the model can do. This subtask adds three things to the agent side:

- A `/models` listing for both wire formats.
- Two probes per model: chat, and tool use.
- Results as plain data that the Phase 8 "Test and assign" screen (`Models3Test.dc.html`) can show later.

Each probe reports passed, unreliable or failed, plus latency and speed. The listing reports how fast the server answered and, when the server says, each model's context window. Probes run through `createProvider` and the presets (D27), and keys still arrive only through `model-key` (D25). With this subtask, the phase's Definition of done should hold.

## Scope

- **In:**
  - `listModels(signal?)` on the neutral `Provider` interface, returning `ModelInfo { id, contextWindow: number | null }`.
    - OpenAI format: `GET {base}/v1/models` through the `openai` SDK. The context window comes from `max_model_len` (vLLM) or a similar field when present.
    - Anthropic format: `GET {base}/v1/models` through `@anthropic-ai/sdk`. The context window comes from `max_input_tokens`.
    - Failures go through `toProviderError`, as streaming does.
  - A probe module, `src/agent/probes/` (agent side, no SDK imports):
    - `listServerModels(provider, clock)` returns the models and the listing round-trip time.
    - `probeModel(provider, model, options)` runs the chat probe and the tool-use probe N times each (default 3) and returns plain result data.
    - A run that throws, times out (per-request timeout through `AbortSignal`) or returns the wrong thing counts as a failed run, with a reason code. A reason never holds a message from the server, the key, a header or the address.
  - The chat probe asks for a fixed reply word and checks it.
  - The tool-use probe has two steps, like the loop:
    - First, the model must call the given tool with valid JSON arguments and the expected values.
    - Then, given a fixed tool result, the answer must contain the result's token.
  - Status: all runs pass = passed; none pass = failed; a mix = unreliable.
  - Timing, with an injected clock so tests are deterministic:
    - Latency is the time from sending a request to its first streamed event, as the median over runs.
    - Speed is output tokens divided by the time from the first to the last event, as the median. It is null when the server sends no usage.
    - Server latency is the `/models` round trip.
  - A dev-only recorder for probe fixtures from agentgateway, for both formats: a `/models` body and the chat and tool-probe streams. It never saves headers or prints the key, and it refuses to write a file that contains the key, as `record:spike` does. The user runs it once.
  - Fixture tests in CI through an injected `fetch`:
    - listing for both formats, with and without a context window;
    - each probe passing and failing;
    - a mix of runs giving unreliable;
    - timing with a fake clock;
    - usage missing (speed null);
    - errors and timeouts;
    - sentinel leak checks for the key and header values.
  - The opt-in live suite (`pnpm test:live`) lists agentgateway's models and probes the spike's default model for each format the preset offers. It never runs in CI.
  - D28 records the probe rules: the definitions, the timing, the listing per format and the result shape. Also the CHANGELOG, CLAUDE.md and README (the recorder and live suite), and the phase progress.
  - After the build: check the phase Definition of done item by item.
- **Out:**
  - Agent-protocol messages (`run-probes` and `probe-result`), a main-side handler, and any UI. Phase 8 wires these.
  - The "Edit a file and run tests" probe (Phase 8; it needs Phase 2 tools).
  - The "Good for" column and job assignment.
  - Running probes in parallel.
  - Storing results.
  - Cloud platforms, and direct api.anthropic.com with `x-api-key` (D26).
  - The async `safeStorage` move and the open `p1-secrets` notes.

## Decisions

| Question | Decision | Alternatives considered |
| --- | --- | --- |
| Repo and base branch | sdd-harness, `main`, branch `feature/p1-model-probes` | — (standing convention) |
| How far probes are wired | Library only in the agent process (`src/agent/probes/`), with fixture tests and the live suite. Phase 8 adds messages and UI | Library plus `run-probes`/`probe-result` protocol messages and a main handler |
| Listing per format | `listModels()` on `Provider`. OpenAI: `GET /v1/models`. Anthropic: `GET /v1/models` through the Anthropic SDK (Anthropic's list shape). Both return neutral `ModelInfo` | Listing always through OpenAI `/v1/models`; no listing for the Anthropic format (manual ids) |
| Meaning of "unreliable" | Each probe runs 3 times (configurable): all pass = passed, none = failed, mix = unreliable | One run, unreliable = passed only with leniency; both rules combined |
| Tool-use probe | Two steps: a valid call with the expected arguments, then an answer that uses the returned result | One valid tool call only |
| Latency and speed | Latency = time to first streamed event (median); server latency = `/models` round trip; speed = output tokens ÷ (last − first event), null without usage; injected clock | Whole request time for both latency and speed |
| Fixtures | Record from agentgateway with a dev-only recorder, both formats; the user runs it once | Hand-written SSE and JSON fixtures |
| Context window | `contextWindow` when `/models` reports it (`max_model_len`, `max_input_tokens`), else null | Leave it out until Phase 8 |
| Decision record | New D28 for the probe rules | Fold into D27 |

## Approach

1. **Types:** `ModelInfo` and `listModels` in `src/agent/provider/types.ts`. The probe result types go in `src/agent/probes/types.ts`, plain JSON-safe data that Phase 8 can send over the protocol unchanged.
2. **Adapters:** `listModels` in `openai.ts` (`client.models.list()`) and `anthropic.ts` (`client.models.list()`). They map to `ModelInfo`, read the context window defensively (any extra numeric field the server sends), and map errors through `toProviderError`. `createProvider` is unchanged; the returned provider just has the new method.
3. **Probes:** `src/agent/probes/` with the chat probe, the tool probe (its own small tool definition and a fixed result token), and the runner. The runner takes N runs, a per-request timeout, an injected clock and an `AbortSignal`, and works out the status and medians. It runs probes in sequence. Callers build the provider with `maxRetries: 0` so retries do not skew latency; the live suite does this.
4. **Recorder:** a dev-only script, `scripts/record-probe-fixtures.ts`, run with `pnpm record:probes [anthropic]`, modelled on `record-spike-fixture.ts`. It writes to `tests/fixtures/probes/<format>/`. The implementor writes it, and the user runs it against agentgateway before result approval. Until then the tests use the files the recorder would write. The recorder run then replaces them, and the tests must still pass.
5. **Tests:** unit tests for the adapters' `listModels`, the probe logic, timing and leak checks; the live suite gains a probe test.
6. **Docs:** D28, CHANGELOG, CLAUDE.md commands and live-suite line, README, phase progress.

Files verified: `src/agent/provider/{types,factory,openai,anthropic,errors}.ts`, `src/agent/loop.ts` (pattern for tool turns), `scripts/record-spike-fixture.ts`, `tests/live/spike.live.test.ts`, `package.json` scripts.

## Verified assumptions

| Assumption | Evidence |
| --- | --- |
| `Provider` has only `stream()` today | `src/agent/provider/types.ts` (`interface Provider`) |
| The Anthropic SDK has a models list with `max_input_tokens` | `node_modules/@anthropic-ai/sdk/resources/models.d.ts:151`, `:197` |
| The openai SDK has a models resource | `node_modules/openai/resources/models.d.ts` |
| The factory already builds both adapters from presets and passes `fetch` and `maxRetries` | `src/agent/provider/factory.ts` (`createProvider`, `FactoryOptions`) |
| agentgateway answers `/models` (at the root and under `/v1`) for the OpenAI format | `docs/phases/phase-01-progress.md` line 5 |
| The screen shows Chat, Use tools, Edit, Context, Speed (tok/s) and a server "answered in N ms" | `docs/design/screens/Models3Test.dc.html` |
| Main makes no model calls; probes belong in the agent process | D25 in `docs/decisions.md` |
| The live suite reads its key from `HARNESS_SPIKE_API_KEY` (tests only, D24) | `tests/live/spike.live.test.ts`, CLAUDE.md commands |

## Risks

- **agentgateway may not answer the Anthropic-format `/v1/models`, or may answer it in the OpenAI shape.** The recorder run shows this first. If so, the Anthropic adapter's `listModels` maps whichever shape comes back, or reports a clear `bad-request`. Record the result in D28.
- **Models are non-deterministic,** so a probe that passes in the recording may not pass live. The probe checks are kept lenient on wording (contains the token, case-insensitive) and strict on structure (the tool name and argument values).
- **Thinking models may stream reasoning before the first text,** which counts toward latency. Latency is time to the first event of any kind; D28 records this.
- **Speed with very short replies is noisy.** Medians over 3 runs reduce this, and D28 says the speed is indicative.

## Open questions

none
