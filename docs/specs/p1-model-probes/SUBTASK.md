# Model listing and probes: list a server's models, test chat and tool use, report latency and speed

**Parent:** none: no parent chosen (Phase 1, subtask 5; tracker off)
**Spec:** docs/specs/p1-model-probes/SPECS.md
**Repo and base branch:** sdd-harness, main, feature branch feature/p1-model-probes

## Context

The provider layer can stream a reply, but it cannot list a server's models or say what a model can do. F6 needs tests per model, because a model that fails tool use cannot write or review code. The Phase 8 "Test and assign" screen shows per model: Chat, Use tools, Context and Speed in tok/s. It also shows how fast the server answered.

This subtask adds:
- `listModels()` to both adapters;
- a probe module in the agent process: a chat probe and a two-step tool-use probe, each run 3 times. All passes is passed, none is failed, a mix is unreliable;
- results as plain data, with latency (the time to the first streamed event) and speed (tokens per second while streaming).

Recorded fixtures cover it in CI, the opt-in live suite runs it against agentgateway, and D28 records the rules. It is the last Phase 1 subtask.

## Required work

- T1 Listing interface.
- T2 Adapter listing.
- T3 Probe types and probes.
- T4 Runner.
- T5 Recorder and fixtures.
- T6 Fixture tests.
- T7 Live suite.
- T8 Docs.
- T9 Full check.

## Acceptance criteria

See AC1–AC13 in docs/specs/p1-model-probes/SPECS.md:

- **AC1:** `ModelInfo` and `Provider.listModels()`. No SDK type crosses the interface.
- **AC2:** OpenAI-format listing via `/v1/models`. The context window comes from `max_model_len`, `context_length` or `context_window`.
- **AC3:** Anthropic-format listing via `/v1/models`. The context window comes from `max_input_tokens`. What agentgateway returns is recorded in D28.
- **AC4:** Plain, JSON-safe result types: status, runs, passes, latency, speed, and failure codes.
- **AC5:** The chat probe, with the fixed token `PROBE-OK`.
- **AC6:** The two-step tool-use probe: `lookup_code` with `name: harness`, then the answer contains `ZEBRA-7341`.
- **AC7:** The runner: 3 runs, per-request timeout, caller abort, the status rules, and median latency and speed with an injected clock.
- **AC8:** Leak rules: no key, header value, address or server text in results, errors or logs. The probe module imports no SDK.
- **AC9:** The `pnpm record:probes [anthropic]` recorder, and fixtures in `tests/fixtures/probes/<format>/`.
- **AC10:** Fixture tests through `createProvider` for both formats.
- **AC11:** The opt-in live probe suite against agentgateway.
- **AC12:** D28, the CHANGELOG, CLAUDE.md, the README, package.json and the phase progress.
- **AC13:** Local checks pass. The user records the fixtures and runs the live suite. CI is green on all three OSes before merge.

## Out of scope

- Protocol messages, a main handler and any UI (Phase 8).
- The edit-and-run probe, the "Good for" column and job assignment.
- Parallel probes, and storing results.
- Cloud platforms, and direct api.anthropic.com with `x-api-key`.
- The async `safeStorage` move, and the open `p1-secrets` notes.

## Links

- Plan: docs/specs/p1-model-probes/PLAN.md
- Spec and tasks: docs/specs/p1-model-probes/SPECS.md, docs/specs/p1-model-probes/tasks.md
