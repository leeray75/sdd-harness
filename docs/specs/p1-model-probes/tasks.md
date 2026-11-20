# Tasks: p1-model-probes

Work in order. After each task, run its check, then tick the box.

- [x] **T1 — Listing interface.** Add `ModelInfo` and `listModels` to `Provider` in `types.ts` (AC1). Update every existing `Provider` fake in the tests so the code typechecks. **Check:** `pnpm typecheck` and `pnpm test` pass.
- [x] **T2 — Adapter listing.**
  - Implement `listModels` in `openai.ts` (AC2) and `anthropic.ts` (AC3) with `client.models.list()`, all pages, and the context-window fields.
  - Map errors through `toProviderError`.
  - Extend `agent-provider-openai.test.ts` and `agent-provider-anthropic.test.ts` with inline `/models` bodies: the paths, the context window present and absent, and the errors.

  **Check:** `pnpm test`.
- [x] **T3 — Probe types and probes.**
  - Write `src/agent/probes/types.ts` (AC4).
  - Write `chat.ts` (AC5) and `tool-use.ts` (AC6). Export the prompts, the tool and the tokens as constants.
  - Add unit tests with a fake provider for every pass and failure code.

  **Check:** `pnpm test`.
- [x] **T4 — Runner.**
  - Write `src/agent/probes/run.ts` (`listServerModels`, `probeModel`) with the status rules, per-request timeouts, caller abort, and median latency and speed with the injected clock (AC7).
  - Add tests for the status rules, medians (odd and even counts), null speed, timeout and abort.
  - Add the import scan and JSON round-trip checks (AC4, AC8).

  **Check:** `pnpm test`.
- [x] **T5 — Recorder and fixtures.**
  - Write `scripts/record-probe-fixtures.ts` and the `record:probes` script in `package.json` (AC9).
  - Commit starter fixtures in `tests/fixtures/probes/{openai,anthropic}/`, in the recorder's output shapes.

  **Check:** `pnpm typecheck` passes. `pnpm record:probes` with `AGENTGATEWAY_BASE_URL` unset exits with a clear message and writes nothing.
- [x] **T6 — Fixture tests.** Replay the probe fixtures through `createProvider` and the injected `fetch` for both formats: listing, passing probes, mixed runs giving `unreliable`, derived failure cases, fake-clock timing, and sentinel key and header leak checks on results, errors and `console` (AC8, AC10). **Check:** `pnpm test`.
- [x] **T7 — Live suite.** Add `tests/live/probes.live.test.ts` (AC11). **Check:** `pnpm test:live` with `HARNESS_SPIKE_BASE_URL` unset and the preset having no default skips. `pnpm typecheck` passes.
- [x] **T8 — Docs.** D28, CHANGELOG, CLAUDE.md, README and the phase progress (AC12). **Check:** `pnpm format:check` passes.
- [x] **T9 — Full check.** (AC13) **Check:** `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm e2e` passes on Windows. The user runs `pnpm record:probes` and `pnpm record:probes anthropic`, then `pnpm test:live`, before result approval. CI is green on all three OSes before merge.
