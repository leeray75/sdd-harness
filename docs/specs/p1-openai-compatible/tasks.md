# Tasks: p1-openai-compatible

Work in order. After each task, run its check, then tick the box.

- [x] **T1 — Preset table.** Write `src/shared/server-presets.ts` exactly as AC1 says. Add `tests/unit/server-presets.test.ts`: it checks the table rows, `getServerPreset`, non-empty formats, and that the file imports nothing from `src/agent`, `src/main` or either SDK. **Check:** `pnpm typecheck` and `pnpm test` pass.
- [x] **T2 — Header parsing.** Write `src/agent/provider/headers.ts` (`parseHeaderLines`, `validateHeaders`) as AC2 says. Add `tests/unit/agent-provider-headers.test.ts`, including a refusal-reason check with a sentinel value. **Check:** `pnpm test`.
- [x] **T3 — Adapters.**
  - Add the `headers` option to both adapters (as `defaultHeaders`).
  - Add `normalizeAnthropicBaseUrl` and use it.
  - Change `key ??` to `key ||` in both adapters.
  - Extend `agent-provider-openai.test.ts` and `agent-provider-anthropic.test.ts`: headers on the request, the four `/v1` forms, and the empty-key placeholder (AC3, AC4).

  **Check:** `pnpm test`.
- [x] **T4 — Factory.** Write `src/agent/provider/factory.ts` (`ServerConfig`, `createProvider`) with the refusals in order (AC5). Add `tests/unit/agent-provider-factory.test.ts`: every refusal, the default address, the default format, a fixture loop replay for every preset and format it offers, and sentinel leak checks (AC7). **Check:** `pnpm test`.
- [x] **T5 — Spike wiring.**
  - Make `chooseSpikeProvider` take `preset` and `headers` and call the factory.
  - In `src/agent/index.ts`, report the choice's skip reason and use the new start line.
  - Add `HARNESS_SPIKE_PRESET` and `HARNESS_SPIKE_HEADERS` to `SPIKE_VARS` in `host.ts`.
  - Update `agent-spike-provider.test.ts` and `agent-env.test.ts` (AC6).

  **Check:** `pnpm test` and `pnpm typecheck`.
- [x] **T6 — Live suite.** Build the live providers with `createProvider` from the preset, address and headers variables, once per format the preset offers (AC8). **Check:** `pnpm test:live` with `HARNESS_SPIKE_BASE_URL` unset skips; `pnpm typecheck` passes.
- [x] **T7 — Spike e2e.** Set `HARNESS_SPIKE_PRESET` and `HARNESS_SPIKE_HEADERS` in the spike e2e. The fake server checks for `x-harness-test: e2e`. Keep every other check (AC9). **Check:** `pnpm e2e tests/e2e/spike-agent.spec.ts` passes on Windows.
- [x] **T8 — Docs.** D27; the D23 note; CHANGELOG; the CLAUDE.md and README spike sections; the phase progress follow-ups (AC10). **Check:** `pnpm format:check` passes.
- [x] **T9 — Full check.** (AC11) **Check:** `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm e2e` passes on Windows. The user runs `pnpm test:live` once against agentgateway before the result approval. CI is green on all three OSes before merge.
