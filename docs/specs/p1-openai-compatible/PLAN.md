# Plan: p1-openai-compatible

Ticket: none (vibe planning; Phase 1, subtask 4)
Status: approved
Date: 2026-11-19

## Objective

Turn the minimal OpenAI-compatible adapter into the one the PRD asks for: a base URL, an optional key, extra headers, and presets for every server type in D13 (vLLM, Ollama, LM Studio, llama.cpp, TGI/SGLang, LiteLLM, agentgateway and Other). A preset fills in the address format and the wire formats a server offers. agentgateway and Other offer both the OpenAI and the Anthropic format (D26). A base URL ending in `/v1` now works for both formats, so it no longer gives `/v1/v1/messages`. The spike loop picks a preset and headers, and the same loop runs on it. Keys still arrive only through `model-key` (D25).

## Scope

- **In:**
  - Preset table as pure data in `src/shared/server-presets.ts`: id, label, default address (or none), formats offered (first is the default).
  - A server config type and a `createProvider(config, key)` factory in `src/agent/provider/` that checks the preset, format, address and headers and builds the right adapter.
  - Extra headers for both adapters (`defaultHeaders`), parsed from `Name: value` lines, validated, with reserved names refused.
  - Anthropic format: one trailing `/v1` (and trailing slashes) stripped from the base URL before the SDK adds `/v1/messages`.
  - Empty-string key treated as no key in both adapters (the `key ??` follow-up).
  - Spike: `HARNESS_SPIKE_PRESET` (default `agentgateway`) and `HARNESS_SPIKE_HEADERS`; `HARNESS_SPIKE_PROVIDER` stays the format and is refused if the preset does not offer it; `HARNESS_SPIKE_BASE_URL` falls back to the preset's default address. Host passes the two new variables only with the spike flag.
  - Unit tests with the existing recorded fixtures (injected `fetch`): headers sent, reserved headers refused, `/v1` handling, preset choice, every preset building a working adapter that replays the fixture.
  - Live suite: honours the preset and headers variables, still runs both formats against agentgateway by default.
  - D27 (presets, address rule, headers rule), CHANGELOG, CLAUDE.md and README spike sections, phase progress.
- **Out:**
  - Any settings UI and the "private server" (self-hosted only) flag (Phase 8).
  - `/models` listing and probes (`p1-model-probes`).
  - Storing headers in the secret store; a key per server (the spike key stays `agentgateway`).
  - Cloud platforms; direct api.anthropic.com with `x-api-key` (D26).
  - New fixture recordings: the existing `openai/` and `anthropic/` fixtures cover the wire shapes.
  - The async `safeStorage` move and the open `p1-secrets` notes.

## Decisions

| Question | Decision | Alternatives considered |
| --- | --- | --- |
| Feature slug, repo, base branch | `p1-openai-compatible`, sdd-harness, `main` → `feature/p1-openai-compatible` | (defaults, not asked) |
| Anthropic-format base URL ending in `/v1` | Strip one trailing `/v1` (and trailing slashes) before the SDK adds `/v1/messages`; the root and root`/v1` both work, so one address serves both formats | Refuse it with a config error; leave as is and document the root |
| Where the preset table lives | `src/shared/server-presets.ts`, pure data with no SDK imports, so the Phase 8 Add-a-server screen can read the same table; `createProvider` factory in `src/agent/provider/` | Presets next to the adapters in `src/agent/provider/` only (would move in Phase 8) |
| How strict extra headers are | `Name: value` lines; names must be HTTP tokens, values have no CR/LF; reserved names refused case-insensitively: `Authorization`, `x-api-key`, `anthropic-version`, `Content-Type`, `Content-Length`, `Host`. Values are config, not secrets; keys come only through `model-key` | Any name allowed (a key could arrive outside `model-key`); header values stored and redacted as secrets (more store and redaction work now) |
| How the spike picks a server type and headers | `HARNESS_SPIKE_PRESET` (default `agentgateway`) and `HARNESS_SPIKE_HEADERS`; `HARNESS_SPIKE_PROVIDER` is the format, refused if the preset lacks it, default the preset's first format; `HARNESS_SPIKE_BASE_URL` falls back to the preset default; key stays `agentgateway` | No spike changes (presets and headers only in library code and unit tests) |
| Preset defaults and formats | vLLM `http://localhost:8000`, Ollama `http://localhost:11434/v1`, LM Studio `http://localhost:1234`, llama.cpp `http://localhost:8080`, LiteLLM `http://localhost:4000`; TGI/SGLang, agentgateway and Other have no default (address required). agentgateway and Other offer `openai` and `anthropic` (openai first); the rest are `openai` only | TGI/SGLang default `http://localhost:8080` (wrong for SGLang's 30000); no defaults at all (presets would not fill in the address) |
| New decision | D27 records the preset table, the address rule for both formats and the headers rule | (default, not asked) |
| Fixtures and live suite | No new recordings; header and `/v1` checks use the injected `fetch` with the existing fixtures. The live suite stays opt-in and runs both formats against agentgateway by default | (default, not asked) |

## Approach

1. **Presets** (`src/shared/server-presets.ts`): `ServerPresetId` union, `SERVER_PRESETS` readonly table, `WireFormat = 'openai' | 'anthropic'`, `getPreset(id)`. No imports from `src/agent` or any SDK.
2. **Headers** (`src/agent/provider/headers.ts`): `parseHeaderLines(text)` → `{ ok, headers } | { ok: false, reason }`, `validateHeaders(record)`; reasons never echo a header value. One header per line (newline-separated), blank lines ignored, no comment syntax.
3. **Adapters:** `headers?: Record<string, string>` option on both, passed as `defaultHeaders`. Anthropic: `normalizeAnthropicBaseUrl` strips trailing slashes and one `/v1`. Both: `key || NO_KEY_PLACEHOLDER`.
4. **Factory** (`src/agent/provider/factory.ts`): `ServerConfig { preset, format?, baseURL?, headers? }` → `createProvider(config, key, options?)` returns `{ ok: true, format, provider } | { ok: false, reason }`. It checks the preset exists, the format is offered, an address is set or defaulted, the address is `http(s)://`, and the headers are valid.
5. **Spike:** `chooseSpikeProvider` reads `preset` and `headers` too and calls the factory; `src/agent/index.ts` passes the new variables and no longer needs `HARNESS_SPIKE_BASE_URL` when the preset has a default; `host.ts` adds the two variables to `SPIKE_VARS`.
6. **Tests:** new `server-presets`, `agent-provider-headers`, `agent-provider-factory` tests; add header and `/v1` cases to both adapter tests; extend `agent-spike-provider` and `agent-env` tests; a fixture replay for each preset through the factory; key-leak checks on refusal reasons.
7. **Live suite:** reads `HARNESS_SPIKE_PRESET` and `HARNESS_SPIKE_HEADERS`, runs each format the preset offers.
8. **Docs:** D27; D23 note (headers); CHANGELOG; CLAUDE.md and README spike sections; phase progress follow-ups (closes the `/v1`, preset and empty-key follow-ups).
9. **Full check** on Windows; CI green on all three OSes before merge.

## Verified assumptions

| Assumption | Evidence |
| --- | --- |
| The OpenAI adapter already appends `/v1` only when missing | `src/agent/provider/openai.ts` `normalizeOpenAIBaseUrl` |
| The Anthropic adapter passes the base URL unchanged, so `/v1` gives `/v1/v1/messages` | `src/agent/provider/anthropic.ts` header comment and `baseURL: options.baseURL`; phase progress follow-up |
| Both adapters use `key ?? 'no-key-set'` | `openai.ts` `createOpenAIProvider`; `anthropic.ts` `createAnthropicProvider` |
| `src/shared/` exists and holds pure shared modules | `src/shared/agent-protocol.ts`, `bridge.ts`, `tokens.ts` |
| Host passes spike variables from a fixed list only with the flag | `src/main/agent/host.ts:37` `SPIKE_VARS` |
| The spike picks the format from `HARNESS_SPIKE_PROVIDER` in a pure function | `src/agent/spike-provider.ts` `chooseSpikeProvider` |
| Design: preset cards with ports, optional key, extra headers in `X-Team: platform` form, Other offers either format | `docs/design/screens/Models2Add.dc.html`; `docs/design-notes.md:234` |
| The live suite reads the key from `HARNESS_SPIKE_API_KEY` and runs both formats | `tests/live/spike.live.test.ts` |

## Risks

- `defaultHeaders` behaviour in the two SDKs (casing, a header the SDK also sets). The adapter tests that read the request headers from the injected `fetch` will show it.
- A reserved-name list that misses a header some gateway uses for auth (for example `api-key` on Azure-style proxies). Cloud platforms are out of scope; the list can grow in a later decision.
- Spike variable changes could break the spike e2e. It keeps using the default preset (agentgateway) with an explicit base URL, so it should not change; T-checks run it on Windows and CI runs it on all OSes.

## Open questions

none
