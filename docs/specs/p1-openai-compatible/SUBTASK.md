# OpenAI-compatible adapter: presets for every server type, extra headers, one address for both formats

**Parent:** none: no parent chosen (Phase 1, subtask 4; tracker off)
**Spec:** docs/specs/p1-openai-compatible/SPECS.md
**Repo and base branch:** sdd-harness, main, feature branch feature/p1-openai-compatible

## Context

The OpenAI-compatible adapter takes only a base URL and an optional key. The PRD needs any OpenAI-compatible server and the two gateways, with presets that fill in the address format, extra headers and an optional key. D26 says the agentgateway preset offers both wire formats. This subtask adds three things:
- a shared preset table for vLLM, Ollama, LM Studio, llama.cpp, TGI/SGLang, LiteLLM, agentgateway and Other;
- validated extra headers on both adapters;
- one address that works for both formats with or without `/v1`.

A factory builds the right adapter from a server config, and the spike loop runs through it. Fixture tests and the opt-in live suite cover it, and D27 records the rules.

## Required work

- T1 Preset table.
- T2 Header parsing.
- T3 Adapters.
- T4 Factory.
- T5 Spike wiring.
- T6 Live suite.
- T7 Spike e2e.
- T8 Docs.
- T9 Full check.

## Acceptance criteria

See AC1–AC11 in docs/specs/p1-openai-compatible/SPECS.md:

- **AC1:** the preset table in `src/shared/server-presets.ts`: eight presets, default addresses, formats. It imports no SDK or process code.
- **AC2:** `parseHeaderLines` and `validateHeaders`: token names, no CR, LF or NUL in values, reserved names refused, and reasons never contain a value.
- **AC3:** the OpenAI adapter takes `headers`; an empty key sends the placeholder.
- **AC4:** the Anthropic adapter takes `headers`; `normalizeAnthropicBaseUrl` strips one `/v1`, so all four address forms post to `/v1/messages`; an empty key sends the placeholder.
- **AC5:** `createProvider(config, key)` refuses, in order: an unknown preset, a format not offered, no address, a bad address (including credentials in the URL), bad headers. Reasons never contain a key or a header value.
- **AC6:** the spike uses `HARNESS_SPIKE_PRESET` (default agentgateway), `HARNESS_SPIKE_HEADERS`, the preset's default format and the default address fallback. `host.ts` passes both new variables only with the flag.
- **AC7:** fixture replays through the factory for every preset and format, header and `/v1` checks, every refusal, and sentinel leak checks.
- **AC8:** the live suite runs through `createProvider`, once per format the preset offers; it is opt-in and never runs in CI.
- **AC9:** the spike e2e sends `X-Harness-Test: e2e` and checks it reached the server.
- **AC10:** D27, the D23 note, CHANGELOG, CLAUDE.md, README and phase progress updated.
- **AC11:** local checks pass; the user runs the live suite once; CI is green on all three OSes before merge.

## Out of scope

- Any settings UI and the "private server" flag (Phase 8).
- `/models` listing and probes (`p1-model-probes`).
- Headers in the secret store, or a key per server.
- Cloud platforms, and direct api.anthropic.com with `x-api-key`.
- New fixture recordings.
- The async `safeStorage` move and the open `p1-secrets` notes.

## Links

- Plan: docs/specs/p1-openai-compatible/PLAN.md
- Spec and tasks: docs/specs/p1-openai-compatible/SPECS.md, docs/specs/p1-openai-compatible/tasks.md
