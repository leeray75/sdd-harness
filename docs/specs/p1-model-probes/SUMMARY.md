# Summary Report: p1-model-probes
Ticket: none   Date: 2026-11-20
Outcome: Clean
Review rounds: 1 of 3 per revision, plus 1 user-requested change round (not counted); revisions: 0 of 2
Models: implementor haiku; reviewer sonnet; data agent not used (all chosen by the user); respawns: none

## What was built

`Provider` now has `listModels()`, and both adapters implement it against `/v1/models`. The context window comes from `max_model_len`, `context_length` or `context_window` for the OpenAI format, and from `max_input_tokens` for the Anthropic format (G1).

A probe module in the agent process, `src/agent/probes/`, runs two probes, each 3 times by default:
- a chat probe, which checks for the token `PROBE-OK`;
- a two-step tool-use probe: `lookup_code` called with `name: harness`, then an answer containing `ZEBRA-7341`.

Each probe reports passed, unreliable or failed, with a failure code per failed run. It also reports the median latency (time to the first streamed event) and the median speed in tokens per second. The results are plain, JSON-safe data. Per-request timeouts count as failed runs, and a caller abort is rethrown (G2).

Fixture replays through `createProvider` cover both formats, on fixtures you recorded from agentgateway, with sentinel leak checks. A dev-only recorder, `pnpm record:probes [anthropic]`, and an opt-in live suite cover the real server; both passed against agentgateway (G3). After your first runs, a change round made the adapters omit an empty `tools` list, because vLLM rejected `tools: []` with HTTP 400. D28 records the rules, and the docs match the code (G4).

## Files changed
Product files (group 1):
| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/agent/provider/types.ts | edited | `ModelInfo`, `Provider.listModels` (AC1) | T1 |
| src/agent/provider/openai.ts | edited | `listModels` through `client.models.list()`, all pages, the AC2 context-window fields, errors through `toProviderError`; `tools` sent only when non-empty (U1) | T2 |
| src/agent/provider/anthropic.ts | edited | `listModels` through `client.models.list()`, `max_input_tokens` with the AC2 fields as fallback, errors mapped; `tools` sent only when non-empty (U1) | T2 |
| src/agent/probes/types.ts | created | Plain result types (AC4) | T3 |
| src/agent/probes/stream.ts | created | One timed streamed request with its own AbortSignal (timeout, caller abort), first and last event times, usage | T3 |
| src/agent/probes/chat.ts | created | Chat probe and its constants (AC5) | T3 |
| src/agent/probes/tool-use.ts | created | Two-step tool-use probe and its constants (AC6) | T3 |
| src/agent/probes/run.ts | created | `listServerModels`, `probeModel`: status rules, timeouts, abort, medians (AC7) | T4 |
| scripts/record-probe-fixtures.ts | created | Dev-only recorder; saves bodies only; refuses if the key appears (AC9); the chat request sends no `tools` (U1) | T5 |
| scripts/register-ts-resolve.mjs | created | Dev-only `--import` registration so the recorder can load the extensionless TS probe modules | T5 |
| scripts/ts-resolve-hook.mjs | created | Dev-only resolve hook that tries `.ts` for extensionless relative imports | T5 |
| package.json | edited | `record:probes` script | T5 |
| .prettierignore | edited | Excludes `tests/fixtures/probes/` so recorded bodies stay byte for byte (change round; the reviewer accepted it; not in implementor notes) | T5 |
| tests/fixtures/probes/openai/{models.json, chat.sse, tool-turn1.sse, tool-turn2.sse} | created | Recorded by you from agentgateway (`qwen3.8-flash-next-nothink`, 21 models) | T5 |
| tests/fixtures/probes/anthropic/{models.json, chat.sse, tool-turn1.sse, tool-turn2.sse} | created | Recorded by you from agentgateway (`claude-haiku-5-5`, 21 models, OpenAI list shape) | T5 |
| tests/unit/agent-loop.test.ts | edited | `listModels` on the loop's provider fake (AC1) | T1 |
| tests/unit/agent-provider-openai.test.ts | edited | Listing tests: paths, context window, skipped entries, headers, error kinds; a request-body test for the omitted `tools` | T2 |
| tests/unit/agent-provider-anthropic.test.ts | edited | Listing tests: both base forms, Bearer, `max_input_tokens`, AC2 fallback, OpenAI-shape body, paging, errors; a request-body test for the omitted `tools` | T2 |
| tests/unit/probe-helpers.ts | created | Fake provider with scripted streams and a fake clock | T3 |
| tests/unit/agent-probe-checks.test.ts | created | Every chat and tool-use pass and failure code (AC5, AC6) | T3 |
| tests/unit/agent-probe-runner.test.ts | created | Status rules, medians, null speed, timeouts, abort, listing, JSON round trip (AC4, AC7) | T4 |
| tests/unit/agent-probe-types.test.ts | created | JSON round trip and import scan (AC4, AC8) | T4 |
| tests/unit/agent-probe-fixtures.test.ts | created | Fixture replays for both formats through `createProvider`, `unreliable` mix, derived failures (a delta-joining rewriter, U2), timeout, sentinel leak checks (AC8, AC10) | T6 |
| tests/live/probes.live.test.ts | created | Opt-in live probe suite; skips without an address (AC11) | T7 |
| docs/decisions.md | edited | D28, including what agentgateway's `/v1/models` returned, the no-empty-tools note and the speed caveat (U3) | T8 |
| CHANGELOG.md | edited | Added entries | T8 |
| CLAUDE.md | edited | `record:probes` commands, live-suite line | T8 |
| README.md | edited | `record:probes` row, live-suite row (Prettier realigned the table) | T8 |
| docs/phases/phase-01-progress.md | edited | Row 5 "in review", D28, follow-ups (Prettier realigned the table) | T8 |

Workflow files (group 2: PLAN.md, SPECS.md, SUBTASK.md, tasks.md, build-ledger.md, changes.md, this report):
| File | Action | What and why | Task |
| --- | --- | --- | --- |
| docs/specs/p1-model-probes/PLAN.md | created | Approved plan | planning |
| docs/specs/p1-model-probes/SPECS.md | created | Approved spec | planning |
| docs/specs/p1-model-probes/SUBTASK.md | created | Child-ticket draft (not published; no tracker) | planning |
| docs/specs/p1-model-probes/tasks.md | created | T1–T9 ticked | all |
| docs/specs/p1-model-probes/build-ledger.md | created | Build ledger | workflow |
| docs/specs/p1-model-probes/changes.md | created | Implementor's change notes | workflow |
| docs/specs/p1-model-probes/SUMMARY.md | created | This report | workflow |

Git and `changes.md` agree, except `.prettierignore`, which the change round added and which is listed above.

## Acceptance criteria
| AC | Status | Evidence |
| --- | --- | --- |
| AC1 | Met | `types.ts`; loop fake updated; typecheck passes |
| AC2 | Met | `openai.ts`; OpenAI listing tests; the recorded listing replays (21 models; Claude entries carry the context fields, vLLM entries none) |
| AC3 | Met (slightly wider) | `anthropic.ts`. The AC2 fields are the fallback whenever `max_input_tokens` is absent; the reviewer accepted it. agentgateway answers in the OpenAI list shape, recorded in D28 |
| AC4 | Met | `probes/types.ts`; JSON round-trip test |
| AC5 | Met | `chat.ts`; probe check tests; live chat 3/3 in both formats |
| AC6 | Met | `tool-use.ts`; probe check tests; live tool use 3/3 in both formats |
| AC7 | Met | `run.ts`, `stream.ts`; runner tests. The reviewer checked the timing math, abort and timeout |
| AC8 | Met | Import scan; sentinel leak tests in the fixture suite; the live output prints result data only |
| AC9 | Met | You recorded both formats from agentgateway; the recorder refuses with no address and never saves headers |
| AC10 | Met | `agent-probe-fixtures.test.ts` passes on your recordings (`pnpm test`: 477 passed, 2 skipped) |
| AC11 | Met | Your `pnpm test:live`: both formats list 21 models; chat and tool use passed 3/3 |
| AC12 | Met | D28 (with the agentgateway listing), CHANGELOG, CLAUDE.md, README, package.json, progress |
| AC13 | Local part met | typecheck, lint, format:check pass; `pnpm test` 477 passed, 2 skipped; `pnpm e2e` 15 passed, 2 skipped (Windows). Pending: CI on three OSes |

Your live run (`pnpm test:live`, agentgateway):
| Format | Model | Listing | Chat | Tool use | Context | Speed (model) |
| --- | --- | --- | --- | --- | --- | --- |
| openai | qwen3.8-flash-next-nothink | 62 ms, 21 models | passed 3/3, 151 ms, 31.4 tok/s | passed 3/3, 491 ms, 140.6 tok/s | null | 91.1 tok/s |
| anthropic | claude-haiku-5-5 | 8 ms, 21 models | passed 3/3, 424 ms, 46.6 tok/s | passed 3/3, 628 ms, 1899.7 tok/s | 1000000 | 747.3 tok/s |

The Anthropic tool-use speed is a burst: the short reply arrives in a few events. That is why D28 calls speed indicative.

## Needs a runtime check
- CI on all three OSes, on the PR.

## Review ledger
Covers every revision, copied from `docs/specs/p1-model-probes/build-ledger.md`.
### Revision 0, round 1  (PASS)
| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| (none) | | | | | |

### User-requested change round 1, after your runs  (PASS; not counted against the cap)
| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| U1: the OpenAI-format chat probe gets HTTP 400 from agentgateway (vLLM) | high | `openai.ts`, `anthropic.ts`, recorder `chatBody` | ACCEPT | The chat request sent `tools: []`; vLLM rejects an empty list | Both adapters send `tools` only when non-empty; the recorder matches; request-body tests added |
| U2: derived failure fixtures break when a token is split across deltas | medium | `tests/unit/agent-probe-fixtures.test.ts` | ACCEPT | The real anthropic stream split `ZEBRA-7341` across text deltas | `rewriteStream` joins the deltas, edits the joined string and writes it back; every derived case keeps its expected code |
| U3: the D28 agentgateway paragraph, the no-tools note and the speed caveat | docs | `docs/decisions.md`, phase progress | ACCEPT | From your recorded `anthropic/models.json` | D28 filled in; follow-ups updated |

## Spec revisions
none

## Rejected findings
none

## Open issues
none. Notes for your judgement:
- The Anthropic listing's context-window fallback is a little wider than AC3's wording (see AC3 above).
- Two dev-only helper scripts (the resolve hook) and the `.prettierignore` line are not named in the spec; the reviewer accepted them.
- `runs` below 1 or not an integer throws `RangeError`.

## Git state
feature/p1-model-probes; approved; committed and pushed in the commit that adds this report.

## Next steps
Approve, commit and push. CI on the PR then has to go green on all three OSes before merge. Or request changes, or not yet.
