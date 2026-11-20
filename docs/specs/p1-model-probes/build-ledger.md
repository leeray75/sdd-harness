# Build ledger: p1-model-probes
state: done
revision: 0
resume on approve: no
current round: 1 of 3, in revision 0
phase: reviewing
Implementor: a2bf1fcd5701b906d, haiku    Reviewer: a5526339d383703f4, sonnet
Data agent: none (not needed)
Models: chosen by the user (standing choice for Phase 1: implementor Haiku, reviewer Sonnet); reused on resume, not asked again.
Respawns: none

## Revision 0, round 1  (PASS)
| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| (none) | | | | | |

Reviewer notes, covering the implementor's concerns:
- AC7 timing, abort and timeout, the AC8 leak rules and the AC9 recorder safety all match the spec.
- The dev-only resolve hook (`scripts/register-ts-resolve.mjs`, `scripts/ts-resolve-hook.mjs`) is acceptable.
- The Anthropic listing falls back to the AC2 fields whenever `max_input_tokens` is absent. That is slightly wider than AC3's conditional clause; it is harmless and not raised. D28 may state it.
- One-decimal rounding of the model speed, the `RangeError` for bad `runs`, and `tools: []` on the chat probe are consistent with the spec.
- The starter fixtures and the "in review" row are consistent with AC9.

## User-requested change round 1, after your runs  (PASS; not counted against the cap)
| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| U1: the OpenAI-format chat probe gets HTTP 400 from agentgateway (vLLM) | high | `openai.ts`, `anthropic.ts`, recorder `chatBody` | ACCEPT | The chat request sent `tools: []`; vLLM rejects an empty list | Both adapters send `tools` only when the list is non-empty; the recorder matches; request-body tests added for both adapters; the fixture fake fetch treats a missing `tools` as a chat request |
| U2: derived failure fixtures break when a token is split across deltas | medium | `tests/unit/agent-probe-fixtures.test.ts` | ACCEPT | The real anthropic stream split `ZEBRA-7341` across text deltas | `rewriteStream` joins the text and argument deltas, edits the joined string and writes it back; every derived case keeps its name and expected code |
| U3: the D28 agentgateway paragraph, the no-tools note and the speed caveat | docs | `docs/decisions.md`, phase progress | ACCEPT | From the user's recorded `anthropic/models.json` | D28 filled in; progress follow-ups updated |

Extra file: `.prettierignore` now excludes `tests/fixtures/probes/`, so recorded bodies stay byte for byte. The reviewer accepted it.

The reviewer checked:
- the loop and the tool probe still send `tools`;
- no tool field is left dangling when `tools` is omitted;
- each derived case asserts its exact failure code, so none passes vacuously;
- no recording was modified;
- D28 matches the recording.

Implementor's checks: typecheck, lint and format:check pass; `pnpm test` 477 passed, 2 skipped; `pnpm e2e` 15 passed, 2 skipped.

## Spec problems
none

## Carried findings
none
