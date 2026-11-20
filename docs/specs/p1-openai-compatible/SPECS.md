---
status: approved
ticket:
---

# p1-openai-compatible

## Problem

The OpenAI-compatible adapter (`src/agent/provider/openai.ts`) takes only a base URL and an optional key. The PRD (F6, D13) needs any OpenAI-compatible server and the two gateways, with presets that fill in the address format, extra headers, and an optional key. D26 says the agentgateway preset offers both wire formats. Today an Anthropic-format base URL ending in `/v1` gives `/v1/v1/messages`, an empty-string key sends an empty token, and the spike can reach only one server shape.

## Goals

- **G1:** One preset table, as pure data the agent and a later settings screen can share, covers vLLM, Ollama, LM Studio, llama.cpp, TGI/SGLang, LiteLLM, agentgateway and Other: default address (or none) and the wire formats each offers.
- **G2:** Both adapters accept extra headers, validated so that no key can arrive through them, and one base URL works for both formats with or without a trailing `/v1`.
- **G3:** A factory builds the right adapter from a server config (preset, format, address, headers) and a key, and the spike loop runs through it, picking the preset and headers from its variables.
- **G4:** Fixture tests in CI show the same loop runs through every preset, headers are sent, and no key or header value appears in a refusal, error, event or log; the opt-in live suite runs against agentgateway.
- **G5:** D27 records the presets, the address rule and the headers rule, and the docs match the code.

## Non-goals

- Any settings UI, and the "private server" (self-hosted only) flag (Phase 8).
- `/models` listing and the chat and tool-use probes (`p1-model-probes`).
- Storing headers in the secret store, or a key per server: the spike key stays `agentgateway`.
- Cloud platforms (Bedrock, Azure, Vertex), and direct api.anthropic.com with `x-api-key` (D26).
- New fixture recordings: the existing `tests/fixtures/spike/openai/` and `anthropic/` fixtures are reused.
- The async `safeStorage` move and the open `p1-secrets` notes.

## Acceptance criteria

- **AC1 (preset table):** `src/shared/server-presets.ts` exports `WireFormat = 'openai' | 'anthropic'`, a `ServerPresetId` union, a readonly `SERVER_PRESETS` table and `getServerPreset(id: string)` (returns the preset or `undefined`). It imports nothing from `src/agent`, `src/main`, `openai` or `@anthropic-ai/sdk` (test-checked). Each preset has `id`, `label`, `defaultBaseURL` (string or `null`) and `formats` (non-empty, the first is the default). The table is exactly:

  | id | label | defaultBaseURL | formats |
  | --- | --- | --- | --- |
  | `vllm` | vLLM | `http://localhost:8000` | openai |
  | `ollama` | Ollama | `http://localhost:11434/v1` | openai |
  | `lm-studio` | LM Studio | `http://localhost:1234` | openai |
  | `llama-cpp` | llama.cpp server | `http://localhost:8080` | openai |
  | `tgi-sglang` | TGI / SGLang | `null` | openai |
  | `litellm` | LiteLLM | `http://localhost:4000` | openai |
  | `agentgateway` | agentgateway | `null` | openai, anthropic |
  | `other` | Other | `null` | openai, anthropic |

- **AC2 (extra headers):** `src/agent/provider/headers.ts` exports `parseHeaderLines(text: string)` and `validateHeaders(headers: Record<string, string>)`, each returning `{ ok: true, headers } | { ok: false, reason }`.
  - `parseHeaderLines` splits on newlines (`\n` or `\r\n`), ignores blank or whitespace-only lines, and splits each line at its first `:`. Name and value are trimmed. A line with no `:` or an empty name is refused. A repeated name (case-insensitive) is refused.
  - A valid name is an HTTP token (`^[!#$%&'*+.^_`|~0-9A-Za-z-]+$`). A value must not contain CR, LF or NUL.
  - These names are refused, case-insensitively: `authorization`, `x-api-key`, `anthropic-version`, `content-type`, `content-length`, `host`.
  - A refusal reason names the line number (for `parseHeaderLines`) or the header name and the rule broken, and never contains a header value.
  - Empty text gives `{ ok: true, headers: {} }`.

- **AC3 (OpenAI-compatible adapter):** `createOpenAIProvider` takes `{ baseURL, key, headers?, maxRetries?, fetch? }`. `headers` is passed to the SDK as `defaultHeaders`, and every request carries them (test reads the request headers from the injected `fetch`). `/v1` handling is unchanged (`normalizeOpenAIBaseUrl`). A `key` of `null` or `''` sends the `no-key-set` placeholder. Everything else in the adapter behaves as before (existing tests still pass).

- **AC4 (Anthropic adapter and the `/v1` rule):** `createAnthropicProvider` takes `{ baseURL, key, headers?, maxRetries?, maxTokens?, fetch? }`. A new exported `normalizeAnthropicBaseUrl` strips trailing slashes, then one trailing `/v1`, then trailing slashes again. The client gets the normalized URL, so `http://h:4100`, `http://h:4100/`, `http://h:4100/v1` and `http://h:4100/v1/` all post to `http://h:4100/v1/messages` (test-checked through the injected `fetch`). `headers` is passed as `defaultHeaders` and every request carries them. A `key` of `null` or `''` sends the placeholder as the Bearer token. Bearer auth and the SDK's `anthropic-version` are unchanged (D26).

- **AC5 (factory):** `src/agent/provider/factory.ts` exports `ServerConfig { preset: string; format?: string; baseURL?: string; headers?: Record<string, string> }` and `createProvider(config, key, options?: { maxRetries?; fetch? })` returning `{ ok: true; preset: ServerPresetId; format: WireFormat; baseURL: string; provider: Provider } | { ok: false; reason: string }`. It refuses, in this order:
  - an unknown preset (reason lists the preset ids);
  - a format the preset does not offer (reason names the preset and the formats it offers); an unset or empty format means the preset's first format;
  - no address: `baseURL` unset or empty and the preset has no default (reason names the preset);
  - an address that does not parse as a URL, is not `http:` or `https:`, or has a user name or password in it (reason names the rule, not the address);
  - headers that fail `validateHeaders` (the same reason).

  An unset or empty `baseURL` uses the preset's default. Otherwise it builds the adapter for the format with the address, the key and the headers. A refusal reason never contains the key or a header value (test-checked with sentinel values).

- **AC6 (spike):** `chooseSpikeProvider` takes `{ preset, provider, model, baseURL, headers }` (each the raw variable or `undefined`) and the key, and uses the factory.
  - `HARNESS_SPIKE_PRESET` unset or empty means `agentgateway`.
  - `HARNESS_SPIKE_PROVIDER` is the format, with the preset's first format as the default. The old refusal text is replaced by the factory's.
  - `HARNESS_SPIKE_HEADERS` is parsed with `parseHeaderLines`. A parse failure gives `{ ok: false, reason }` and nothing runs.
  - `HARNESS_SPIKE_BASE_URL` may be unset when the preset has a default address.
  - The default model per format is unchanged (`SPIKE_DEFAULT_MODELS`).
  - `src/agent/index.ts` no longer refuses on a missing `HARNESS_SPIKE_BASE_URL` itself: it reports `spike skipped: <reason>` from the choice. Its start line becomes `spike started preset=<id> provider=<format> model=<model>`.
  - `src/main/agent/host.ts` adds `HARNESS_SPIKE_PRESET` and `HARNESS_SPIKE_HEADERS` to `SPIKE_VARS`, which are passed only when the spike flag is `1` (test-checked).

- **AC7 (fixture tests):** Unit tests replay the existing recorded fixtures through the injected `fetch`:
  - for every preset and every format it offers, a `createProvider` build (with an explicit address for presets without a default) runs `runAgentLoop` to completion on that format's fixtures;
  - headers reach the request for both formats;
  - the four `/v1` forms for the Anthropic format;
  - each refusal in AC2 and AC5;
  - the spike choice cases in AC6.

  The leak checks put a sentinel key and a sentinel header value through refusals and failures. They check that neither appears in a reason, an error message, a stream event or `describeError`.

- **AC8 (live suite):** `tests/live/spike.live.test.ts` builds its providers with `createProvider` from `HARNESS_SPIKE_PRESET` (default `agentgateway`), `HARNESS_SPIKE_BASE_URL` and `HARNESS_SPIKE_HEADERS`. It runs once per format the preset offers. It still reads the key only from `HARNESS_SPIKE_API_KEY` and never prints it. It skips when no address results, and never runs in CI.

- **AC9 (spike e2e):** `tests/e2e/spike-agent.spec.ts` also sets `HARNESS_SPIKE_PRESET=agentgateway` and `HARNESS_SPIKE_HEADERS=X-Harness-Test: e2e`. Its fake server checks that the chat request carried `x-harness-test: e2e`. Every existing check is kept.

- **AC10 (docs):** D27 is added to `docs/decisions.md`, covering:
  - the preset table and where it lives;
  - one address for both formats (`/v1` added for openai and stripped for anthropic);
  - the headers rule and reserved names;
  - that header values are configuration, not secrets;
  - that keys arrive only through `model-key` (D25).

  Also:
  - the D23 note mentions extra headers through `defaultHeaders`;
  - CHANGELOG gets Added and Changed entries;
  - the CLAUDE.md and README spike sections list `HARNESS_SPIKE_PRESET` and `HARNESS_SPIKE_HEADERS` and the base URL fallback;
  - `docs/phases/phase-01-progress.md` follow-ups close the `/v1`, preset and empty-key items.

- **AC11 (full check):** `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm e2e` passes on Windows. The user runs `pnpm test:live` once against agentgateway before the result approval. CI is green on all three OSes before merge.

## Open questions

- none
