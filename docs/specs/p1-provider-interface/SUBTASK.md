# Provider interface and Anthropic adapter; the spike loop runs on both wire formats

**Parent:** none: no parent chosen (Phase 1, subtask 3; tracker off)
**Spec:** docs/specs/p1-provider-interface/SPECS.md
**Repo and base branch:** sdd-harness, main, feature branch feature/p1-provider-interface

## Context

The spike loop talks to the `openai` SDK directly, so it runs only on OpenAI-compatible servers, and SDK types leak into it (against D23). This subtask adds a provider interface: messages, tool calls, streaming, token usage, errors and retries, with no SDK type crossing it. Behind it sit an Anthropic Messages adapter and a minimal OpenAI-compatible adapter, and the spike loop moves onto it. Both wire formats run through agentgateway with one stored gateway key. They are tested with fixtures recorded through the gateway and with the opt-in live suite. A new decision (D26) records that development and pilot model calls go through agentgateway.

## Required work

- T1 Recorder for both formats.
- T2 Dependency and neutral types.
- T3 Errors.
- T4 OpenAI-compatible adapter.
- T5 Anthropic adapter.
- T6 Loop on the interface.
- T7 Spike wiring.
- T8 Live suite for both formats.
- T9 Spike e2e.
- T10 Docs.
- T11 Full check.

## Acceptance criteria

See AC1–AC13 in docs/specs/p1-provider-interface/SPECS.md:

- **AC1:** neutral types and `Provider`. The loop and the types import no SDK (test-checked).
- **AC2:** OpenAI-compatible adapter: `/v1` handling, delta merging, usage chunk, no-key placeholder.
- **AC3:** Anthropic adapter: Bearer or `x-api-key` auth with explicit options, block-to-event mapping, `tool_result` history, `max_tokens` default 1024.
- **AC4:** SDK retries with `maxRetries` (default 2), the abort signal, `ProviderError` kinds with key-free messages; tested per adapter.
- **AC5:** per-turn and total token usage, shown in the spike's finished line.
- **AC6:** `runAgentLoop` on a `Provider`, with its behaviour kept.
- **AC7:** `HARNESS_SPIKE_PROVIDER`, the default model per format, the host variable list, and `SPIKE_KEY_NAME = 'agentgateway'`.
- **AC8:** the recorder for both formats through agentgateway, with a recording checkpoint for the user.
- **AC9:** fixture tests on both formats at adapter and loop level, with key-leak checks.
- **AC10:** the live suite runs once per format, opt-in, never in CI.
- **AC11:** the spike e2e on the new fixtures and key name, with the close check waiting on the close event.
- **AC12:** `@anthropic-ai/sdk` added; D26, the D23 and D25 notes, CHANGELOG, CLAUDE.md, README and phase progress updated.
- **AC13:** local checks pass; CI is green on all three OSes before merge.

## Out of scope

- OpenAI-compatible presets and custom headers, `/models` and probes, any settings UI, and cloud platforms.
- The async `safeStorage` move and the open `p1-secrets` notes.
- The spike e2e on the Anthropic format, and reading the old `spike` store entry.

## Links

- Plan: docs/specs/p1-provider-interface/PLAN.md
- Spec and tasks: docs/specs/p1-provider-interface/SPECS.md, docs/specs/p1-provider-interface/tasks.md
