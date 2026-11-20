# Changes: p1-openai-compatible

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| `src/shared/server-presets.ts` | created | Preset table as pure data (`WireFormat`, `ServerPresetId`, `SERVER_PRESETS`, `getServerPreset`), with no imports, per AC1. | T1 |
| `tests/unit/server-presets.test.ts` | created | Checks the table rows, `getServerPreset`, non-empty formats (openai first) and that the file imports nothing (the import check reads `from '...'` specifiers). | T1 |
| `src/agent/provider/headers.ts` | created | `parseHeaderLines` and `validateHeaders` with the name, reserved-name, value and duplicate rules; reasons name the line or header, never a value (AC2). | T2 |
| `tests/unit/agent-provider-headers.test.ts` | created | Parsing, validation, every reserved name, NUL and CR refusals, and sentinel leak checks on the reasons. | T2 |
| `src/agent/provider/openai.ts` | edited | Adds the `headers` option passed as `defaultHeaders`, and `key \|\|` so an empty key sends the placeholder (AC3). | T3 |
| `src/agent/provider/anthropic.ts` | edited | Adds the `headers` option (`defaultHeaders`), the exported `normalizeAnthropicBaseUrl` (strip slashes, one `/v1`, slashes) used for the client, and `key \|\|` (AC4). | T3 |
| `tests/unit/agent-provider-openai.test.ts` | edited | Headers on every request, empty-key placeholder, and `/v1` not doubled, through the injected `fetch`. | T3 |
| `tests/unit/agent-provider-anthropic.test.ts` | edited | `normalizeAnthropicBaseUrl` cases, the four `/v1` forms posting to `/v1/messages`, headers on every request, and the empty-key placeholder. The old "passes the base URL unchanged" test is renamed to match its case. | T3 |
| `src/agent/provider/factory.ts` | created | `ServerConfig`, `FactoryOptions`, `createProvider` with the refusals in the AC5 order and the default address and format rules. A reason never holds the key, a header value or the address. | T4 |
| `tests/unit/agent-provider-factory.test.ts` | created | Every refusal, the default address and format, headers on both formats, the four `/v1` forms, a fixture loop replay for every preset and format it offers, and sentinel leak checks on refusals, provider errors and network errors. | T4 |
| `src/agent/spike-provider.ts` | edited | `chooseSpikeProvider` takes `preset` and `headers` and builds through the factory; the `HARNESS_SPIKE_PROVIDER` refusal text is replaced by the factory's; `SPIKE_PROVIDER_REFUSAL` is removed (AC6). | T5 |
| `src/agent/index.ts` | edited | Passes the five spike variables to the choice; reports `spike skipped: <reason>`; start line is `spike started preset=<id> provider=<format> model=<model>`. No longer refuses a missing base URL itself. | T5 |
| `src/main/agent/host.ts` | edited | Adds `HARNESS_SPIKE_PRESET` and `HARNESS_SPIKE_HEADERS` to `SPIKE_VARS`, passed only with the spike flag (AC6). | T5 |
| `tests/unit/agent-spike-provider.test.ts` | edited | Rewritten for the preset, the default preset and address, the factory's format refusals, the headers cases (valid, empty, parse failure, reserved name) and key leak checks. | T5 |
| `tests/unit/agent-env.test.ts` | edited | A test that the two new spike variables pass only with `HARNESS_AGENT_SPIKE=1`. | T5 |
| `tests/live/spike.live.test.ts` | edited | Builds providers with `createProvider` from `HARNESS_SPIKE_PRESET`, the address (or preset default) and `HARNESS_SPIKE_HEADERS`; one run per format the preset offers; skips when no address results (AC8). The key is still read only from `HARNESS_SPIKE_API_KEY`. | T6 |
| `tests/e2e/spike-agent.spec.ts` | edited | Sets `HARNESS_SPIKE_PRESET=agentgateway` and `HARNESS_SPIKE_HEADERS=X-Harness-Test: e2e`; the fake server records `x-harness-test` and the test checks every chat request carried `e2e`. Other checks kept (AC9). | T7 |
| `tests/e2e/spike-agent.spec.ts` | edited | Type fix: `req.headers['x-harness-test']` can be an array, so it is joined before it is stored. Found by `pnpm typecheck` in the T9 run; no change in behaviour for a single header. | T9 |
| `docs/decisions.md` | edited | Adds D27 (preset table and location, address rule for both formats, headers rule and reserved names, header values are configuration, keys only via `model-key`) and a D23 note on `defaultHeaders` (AC10). | T8 |
| `CHANGELOG.md` | edited | Unreleased Added entries (presets, factory, headers, spike settings) and Changed entries (adapter options, `/v1` strip, empty key, spike base URL fallback and start line) (AC10). | T8 |
| `CLAUDE.md` | edited | Spike section lists `HARNESS_SPIKE_PRESET`, `HARNESS_SPIKE_HEADERS` and the base URL fallback; the live-suite command line says an address is needed (AC10). | T8 |
| `README.md` | edited | Spike table adds `HARNESS_SPIKE_PRESET` and `HARNESS_SPIKE_HEADERS`, and the base URL fallback and provider default; live-suite row and spike intro updated. Prettier reflowed the table (AC10). | T8 |
| `docs/phases/phase-01-progress.md` | edited | Follow-ups for the `/v1` item, the agentgateway preset item and the empty-key item are struck through with a note that `p1-openai-compatible` closed them (AC10). | T8 |
| `docs/specs/p1-openai-compatible/tasks.md` | edited | Ticked T1 to T9 after each check passed. | T1, T2, T3, T4, T5, T6, T7, T8, T9 |
| `docs/specs/p1-openai-compatible/changes.md` | created | This record of the files touched. | T1-T9 |
