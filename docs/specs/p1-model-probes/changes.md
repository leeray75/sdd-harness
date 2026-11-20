# Changes: p1-model-probes

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/agent/provider/types.ts | edited | Adds `ModelInfo { id, contextWindow }` and `listModels(signal?)` to `Provider` (AC1). | T1 |
| src/agent/provider/openai.ts | edited | Implements `listModels` through `client.models.list()` over every page, reads `max_model_len`, `context_length`, `context_window`, skips entries without a string id, maps errors through `toProviderError` (AC2). | T2 |
| src/agent/provider/anthropic.ts | edited | Implements `listModels` through `client.models.list()` over every page, reads `max_input_tokens` with the AC2 fields as the fallback (the AC3 conditional), skips entries without a string id, maps errors through `toProviderError` (AC3). | T2 |
| tests/unit/agent-loop.test.ts | edited | Adds `listModels` to the loop's scripted provider fake so it typechecks (AC1). | T1 |
| tests/unit/agent-provider-openai.test.ts | edited | Adds listing tests: the path with and without `/v1`, context window present and absent, field order, skipped entries, extra headers, and error kinds without the server message or the key (AC2). | T2 |
| tests/unit/agent-provider-anthropic.test.ts | edited | Adds listing tests: the path for both base forms, Bearer and anthropic-version, `max_input_tokens` present and absent, the AC2 fallback, the OpenAI-shape body, paging with `after_id`, and error kinds (AC3). Prettier reformatted the file during the T8 format check. | T2 |
| src/agent/probes/types.ts | created | The plain, JSON-safe result types: `ProbeStatus`, `ProbeFailure`, `ProbeResult`, `ModelProbeResult`, `ServerListing` (AC4). | T3 |
| src/agent/probes/stream.ts | created | One timed streamed request with its own AbortSignal (timeout and caller abort), recording first and last event times and usage. Shared by the two probes and the runner (AC5 to AC7). | T3 |
| src/agent/probes/chat.ts | created | The chat probe: fixed prompt and token, no tools, pass on the token, `missing-token` or the error kind (AC5). Exports the constants for the recorder. | T3 |
| src/agent/probes/tool-use.ts | created | The tool-use probe: the `lookup_code` tool, the two steps, the name and argument checks, and the fixed tool result and code (AC6). Exports the constants for the recorder. | T3 |
| src/agent/probes/run.ts | created | The runner: `listServerModels` and `probeModel`, the status rules, per-request timeouts, caller abort, medians of latency and speed with the injected clock (AC7). | T4 |
| tests/unit/probe-helpers.ts | created | Fake provider with scripted streams per probe step, a fake clock that moves only with the script, and the stream and listing builders. A helper, not a test file. | T3 |
| tests/unit/agent-probe-checks.test.ts | created | Unit tests for every chat and tool-use pass and failure code, the request contents of step 2, and step errors (AC5, AC6). | T3 |
| tests/unit/agent-probe-runner.test.ts | created | Unit tests for the status rules, the failure list per run, the run order, medians (odd and even), null speed, timeouts, caller abort, the listing, and the JSON round trip (AC4, AC7). | T4 |
| tests/unit/agent-probe-types.test.ts | created | The JSON round trip of every result type and the import scan: no SDK, nothing from `src/main`, no logging, no environment reads (AC4, AC8). | T4 |
| tests/unit/agent-probe-fixtures.test.ts | created | Replays the probe fixtures for both formats through `createProvider` and an injected fetch: listing, passing probes with fake-clock timing, a mixed run giving `unreliable`, derived failure codes, a timeout, and sentinel key and header leak checks on results, errors and console (AC8, AC10). Round 2 (U2): the derived failure cases rewrite the parsed text and argument deltas instead of the raw bytes, so they do not depend on how a token was split; the fake fetch classifies a chat request by the missing `tools` field (U1). | T6, U1, U2 (user change round) |
| tests/live/probes.live.test.ts | created | Opt-in live suite: lists the models and runs both probes on the spike's model for each format the preset offers; prints result data only; skips without an address (AC11). | T7 |
| scripts/record-probe-fixtures.ts | created | Dev-only recorder for `models.json`, `chat.sse`, `tool-turn1.sse` and `tool-turn2.sse` from agentgateway, using the probe constants; checks each reply with the probe rules; saves bodies only; refuses if the key appears (AC9). Round 2 (U1): the chat request body has no `tools` field, as the adapters now send it. | T5, U1 (user change round) |
| scripts/register-ts-resolve.mjs | created | Dev-only loader registration so the recorder can import the extensionless TypeScript probe modules under native Node. | T5 |
| scripts/ts-resolve-hook.mjs | created | Dev-only resolve hook that tries `.ts` for extensionless relative imports (used by the recorder only). | T5 |
| package.json | edited | Adds the `record:probes` script (AC9). | T5 |
| tests/fixtures/probes/openai/models.json | created | Starter `/models` body in the OpenAI list shape, to be replaced by the user's recording (AC9). | T5 |
| tests/fixtures/probes/openai/chat.sse | created | Starter chat stream in the OpenAI chunk shape with the token and usage. Replaced by the user's recording. | T5 |
| tests/fixtures/probes/openai/tool-turn1.sse | created | Starter step-1 stream: a `lookup_code` call with arguments `{"name": "harness"}`. Replaced by the user's recording. | T5 |
| tests/fixtures/probes/openai/tool-turn2.sse | created | Starter step-2 stream containing `ZEBRA-7341`. Replaced by the user's recording. | T5 |
| tests/fixtures/probes/anthropic/models.json | created | Starter `/v1/models` body in the Anthropic list shape with `max_input_tokens`. Replaced by the user's recording. | T5 |
| tests/fixtures/probes/anthropic/chat.sse | created | Starter Anthropic chat stream with the token and usage. Replaced by the user's recording. | T5 |
| tests/fixtures/probes/anthropic/tool-turn1.sse | created | Starter Anthropic step-1 stream: a `tool_use` block for `lookup_code`. Replaced by the user's recording. | T5 |
| tests/fixtures/probes/anthropic/tool-turn2.sse | created | Starter Anthropic step-2 stream containing `ZEBRA-7341`. Replaced by the user's recording. | T5 |
| docs/decisions.md | edited | Adds D28: listing per format, the probes and their fixed checks, the status rules, the latency and speed definitions, the result shape and the live and recorded checks (AC12). The agentgateway Anthropic listing paragraph is pending the user's recording. | T8 |
| docs/decisions.md | edited | Round 2 (U3): fills in the agentgateway Anthropic listing paragraph from the user's recording, notes that the chat probe sends no `tools` field, and adds the speed caveat from the live run. | U3 (user change round) |
| CHANGELOG.md | edited | Adds the model listing, probes, recorder and probe tests entries under Unreleased, Added (AC12). | T8 |
| CLAUDE.md | edited | Adds the `record:probes` commands and the live-suite line for the model probes (AC12). | T8 |
| README.md | edited | Adds the `record:probes` row and updates the live-suite row. Prettier realigned the table during the format check. | T8 |
| docs/phases/phase-01-progress.md | edited | Row 5 status set to in review, D28 added to the decisions list, and the `p1-model-probes` follow-ups added. Prettier realigned the table during the format check (AC12). | T8 |
| docs/specs/p1-model-probes/tasks.md | edited | Ticks T1 to T9 after each check passed. | T1, T2, T3, T4, T5, T6, T7, T8, T9 |
| docs/specs/p1-model-probes/changes.md | created | This record of the files touched. | T9 |
| src/agent/provider/openai.ts | edited | Omits the `tools` field when the tool list is empty, because vLLM rejects an empty list with HTTP 400 (the first live run's chat probe failed on all three runs). | U1 (user change round) |
| src/agent/provider/anthropic.ts | edited | The same change in the Anthropic adapter, for consistency. | U1 (user change round) |
| tests/unit/agent-provider-openai.test.ts | edited | Adds tests through the injected fetch: no `tools` key in the request when the list is empty, and a `tools` array when it is not. | U1 (user change round) |
| tests/unit/agent-provider-anthropic.test.ts | edited | The same two request-body tests for the Anthropic adapter. Prettier reformatted the file during the format check. | U1 (user change round) |
| .prettierignore | edited | Excludes `tests/fixtures/probes/` from Prettier, so the recorded bodies stay byte for byte. The user's anthropic `models.json` recording was flagged as unformatted. | U1 (user change round, format check) |
| docs/phases/phase-01-progress.md | edited | Follow-ups updated for the U1 fix, the recorded anthropic fixtures, the pending openai re-recording, and the speed caveat. | U3 (user change round) |
