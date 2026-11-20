# Summary Report: p1-openai-compatible
Ticket: none   Date: 2026-11-19
Outcome: Clean
Review rounds: 1 of 3 per revision; revisions: 0 of 2
Models: implementor haiku; reviewer sonnet; data agent not used (all chosen by the user); respawns: none

## What was built

One preset table, `src/shared/server-presets.ts`, covers vLLM, Ollama, LM Studio, llama.cpp, TGI/SGLang, LiteLLM, agentgateway and Other. It is pure data, so the Phase 8 screen can share it. agentgateway and Other offer both wire formats (G1).

Both adapters now take validated extra headers: reserved names such as `Authorization` and `x-api-key` are refused, so keys still arrive only through `model-key`. One address now works for both formats: the Anthropic format strips one trailing `/v1` (G2).

`createProvider` builds the adapter from a preset, format, address and headers, and refuses bad input without echoing the key, a header value or the address. The spike runs through it with `HARNESS_SPIKE_PRESET` and `HARNESS_SPIKE_HEADERS` (G3).

Fixture replays run through the factory for every preset and format, with sentinel leak checks. The spike e2e checks that a header reaches the server (G4). D27 and the docs record the rules (G5).

## Files changed
Product files (group 1):
| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/shared/server-presets.ts | created | Preset table as pure data (`WireFormat`, `ServerPresetId`, `SERVER_PRESETS`, `getServerPreset`), no imports | T1 |
| src/agent/provider/headers.ts | created | `parseHeaderLines`, `validateHeaders`: token names, no CR/LF/NUL, reserved names, duplicates; reasons never hold a value | T2 |
| src/agent/provider/openai.ts | edited | `headers` as `defaultHeaders`; `key \|\|` so an empty key sends the placeholder | T3 |
| src/agent/provider/anthropic.ts | edited | `headers` as `defaultHeaders`; exported `normalizeAnthropicBaseUrl` (one `/v1` stripped); `key \|\|` | T3 |
| src/agent/provider/factory.ts | created | `ServerConfig`, `createProvider` with refusals in the AC5 order, default address and format | T4 |
| src/agent/spike-provider.ts | edited | Preset and headers through the factory; `SPIKE_PROVIDER_REFUSAL` removed | T5 |
| src/agent/index.ts | edited | Passes the spike variables to the choice; `spike skipped: <reason>`; start line with the preset | T5 |
| src/main/agent/host.ts | edited | `HARNESS_SPIKE_PRESET`, `HARNESS_SPIKE_HEADERS` in `SPIKE_VARS` (flag only) | T5 |
| tests/unit/server-presets.test.ts | created | Table rows, lookup, formats, no imports | T1 |
| tests/unit/agent-provider-headers.test.ts | created | Parsing, validation, reserved names, sentinel leak checks | T2 |
| tests/unit/agent-provider-openai.test.ts | edited | Headers on every request, empty-key placeholder, `/v1` not doubled | T3 |
| tests/unit/agent-provider-anthropic.test.ts | edited | `normalizeAnthropicBaseUrl`, four `/v1` forms, headers, empty key | T3 |
| tests/unit/agent-provider-factory.test.ts | created | Every refusal, defaults, fixture loop replay per preset and format, leak checks | T4 |
| tests/unit/agent-spike-provider.test.ts | edited | Preset, default address, format refusals, headers cases, key leak checks | T5 |
| tests/unit/agent-env.test.ts | edited | New spike variables pass only with the flag | T5 |
| tests/live/spike.live.test.ts | edited | Providers through `createProvider`, one run per offered format; key only from `HARNESS_SPIKE_API_KEY` | T6 |
| tests/e2e/spike-agent.spec.ts | edited | Preset and `X-Harness-Test: e2e` set; fake server checks the header; type fix for array headers | T7, T9 |
| docs/decisions.md | edited | D27; D23 note on `defaultHeaders` | T8 |
| CHANGELOG.md | edited | Added and Changed entries | T8 |
| CLAUDE.md | edited | Spike section and live-suite line | T8 |
| README.md | edited | Spike table and live-suite row (Prettier reflowed the table) | T8 |
| docs/phases/phase-01-progress.md | edited | `/v1`, preset and empty-key follow-ups marked done | T8 |

Workflow files (group 2: PLAN.md, SPECS.md, SUBTASK.md, tasks.md, build-ledger.md, changes.md, this report):
| File | Action | What and why | Task |
| --- | --- | --- | --- |
| docs/specs/p1-openai-compatible/PLAN.md | created | Approved plan | planning |
| docs/specs/p1-openai-compatible/SPECS.md | created | Approved spec | planning |
| docs/specs/p1-openai-compatible/SUBTASK.md | created | Child-ticket draft (not published; no tracker) | planning |
| docs/specs/p1-openai-compatible/tasks.md | created | T1–T9 ticked | all |
| docs/specs/p1-openai-compatible/build-ledger.md | created | Build ledger | workflow |
| docs/specs/p1-openai-compatible/changes.md | created | Implementor's change notes | workflow |
| docs/specs/p1-openai-compatible/SUMMARY.md | created | This report | workflow |

## Acceptance criteria
| AC | Status | Evidence |
| --- | --- | --- |
| AC1 | Met | `server-presets.ts`; `server-presets.test.ts` |
| AC2 | Met | `headers.ts`; headers tests with sentinel reasons. A name that fails the token rule is not echoed (it could be a pasted value); the reviewer accepted this |
| AC3 | Met | `openai.ts`; openai adapter tests |
| AC4 | Met | `anthropic.ts` `normalizeAnthropicBaseUrl`; four `/v1` forms tested |
| AC5 | Met | `factory.ts`; factory tests for each refusal and leak checks |
| AC6 | Met | `spike-provider.ts`, `index.ts`, `host.ts`; spike-provider and env tests |
| AC7 | Met | Factory loop replay per preset and format; header, `/v1`, refusal and leak tests (from `changes.md`; the reviewer did not open the tests) |
| AC8 | Met (code) | Live suite through `createProvider`; skips with no address. The user approved the result; the orchestrator saw no `pnpm test:live` run of this build in the Terminal panel (the latest there predates it) |
| AC9 | Met | Spike e2e passes on Windows with the header check |
| AC10 | Met | D27, D23 note, CHANGELOG, CLAUDE.md, README, phase progress |
| AC11 | Local part met | typecheck, lint, format:check pass; `pnpm test` 394 passed, 2 skipped; `pnpm e2e` 15 passed, 2 skipped (Windows). CI on three OSes is pending the push; the live run is as noted under AC8 |

## Needs a runtime check
- `pnpm test:live` against agentgateway for both formats, ideally with a base URL ending in `/v1` to exercise the new rule (not seen in the Terminal panel for this build).
- CI on all three OSes, especially the spike e2e header check on Linux and macOS.
- The reviewer did not read the test files, the e2e, the live suite or the docs other than `decisions.md`; AC7 to AC9 rest on `changes.md` and the reported runs.

## Review ledger
Covers every revision, copied from `docs/specs/p1-openai-compatible/build-ledger.md`.
### Revision 0, round 1  (PASS)
| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| (none) | | | | | |

## Spec revisions
none

## Rejected findings
none

## Open issues
none. Notes for your judgement:
- D27 was appended to `docs/decisions.md` with a shell heredoc instead of the edit tools; the reviewer and I checked that the block is intact.
- `HARNESS_SPIKE_HEADERS` takes one `Name: value` per line; in PowerShell, separate headers with `` `n ``.
- Phase progress row 4 stays `pending` until the close step.

## Git state
feature/p1-openai-compatible; approved; committed and pushed in the commit that adds this report.

## Next steps
Run `pnpm test:live` against agentgateway once. Then approve, commit and push (CI on the PR then has to go green on all three OSes); or request changes; or not yet.
