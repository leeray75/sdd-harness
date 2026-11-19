# Summary Report: p1-provider-interface
Ticket: none   Date: 2026-11-19
Outcome: Clean
Review rounds: 1 of 3 per revision (in revision 1); revisions: 1 of 2
Models: implementor haiku; reviewer sonnet; data agent not used (all chosen by the user); respawns: none

## What was built

The agent now has a provider interface in `src/agent/provider/` that covers messages, tool calls, streaming, token usage, errors and retries, and no SDK type crosses it (G1). Two adapters implement it (G2):
- an Anthropic Messages adapter on `@anthropic-ai/sdk` 1.10.0, Bearer only, sending the SDK's `anthropic-version` (2026-10-21);
- a minimal OpenAI-compatible adapter (base URL plus `/v1`, optional key).

The spike loop runs on the interface and picks the wire format with `HARNESS_SPIKE_PROVIDER`. One stored key, `agentgateway`, is used for both formats (G3). Both formats were recorded through agentgateway and are replayed in unit tests at adapter and loop level. The opt-in live suite passed for both formats on the user's run. Leak tests check that the key never appears in errors, events or `describeError` (G4). D26 records that development and pilot model calls go through agentgateway, and the docs match the code (G5).

## Files changed
Product files (group 1):
| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/agent/provider/types.ts | created | Neutral messages, tools, stream events, usage, `Provider`, `ProviderError`; no SDK imports | T2 |
| src/agent/provider/errors.ts | created | Maps both SDKs' errors to `ProviderError` by kind and status only | T3 |
| src/agent/provider/openai.ts | created | OpenAI-compatible adapter: `/v1` handling, delta merging (moved from the loop), usage, placeholder key | T4 |
| src/agent/provider/anthropic.ts | created | Anthropic adapter: Bearer only, SDK version, block-to-event mapping, usage, history mapping | T5, revision 1 |
| src/agent/spike-provider.ts | created | Pure provider choice from `HARNESS_SPIKE_PROVIDER`, default model per format | T7 |
| src/agent/errors.ts | edited | `describeError` returns the safe `ProviderError` text; handles both SDKs | T3 |
| src/agent/loop.ts | edited | `runAgentLoop` takes a `Provider`; `LoopResult.usage` per turn and total | T6 |
| src/agent/index.ts | edited | Spike builds the chosen adapter; usage in the finished line | T6, T7 |
| src/main/agent/host.ts | edited | Passes `HARNESS_SPIKE_PROVIDER` only with the spike flag | T7 |
| src/main/agent/model-key.ts | edited | `SPIKE_KEY_NAME = 'agentgateway'` | T7 |
| scripts/record-spike-fixture.ts | edited | Format argument; `include_usage`; Anthropic route with Bearer and `ANTHROPIC_VERSION = '2026-10-21'` | T1, T5a |
| package.json, pnpm-lock.yaml | edited | `@anthropic-ai/sdk` 1.10.0 | T2 |
| tests/fixtures/spike/openai/turn1-tool-call.sse, turn2-final.sse | created | Recorded by the user through agentgateway (not in implementor notes: written by the user at the checkpoint) | T1 checkpoint |
| tests/fixtures/spike/anthropic/turn1-tool-call.sse, turn2-final.sse | created | Recorded by the user, then re-recorded with version 2026-10-21 | T1, T5a checkpoints |
| tests/fixtures/spike/turn1-tool-call.sse, turn2-final.sse | deleted | Old fixtures, replaced by the per-format folders | T6 |
| tests/unit/agent-provider-types.test.ts | created | No SDK imports in `types.ts` and `loop.ts`; `ProviderError` | T2, T6 |
| tests/unit/agent-provider-errors.test.ts | created | Error mapping for both SDKs; no sentinel in messages | T3 |
| tests/unit/agent-provider-openai.test.ts | created | Requests, fixtures, merge rules, usage, 401/429/500 with retry, network, abort | T4 |
| tests/unit/agent-provider-anthropic.test.ts | created | Requests, version equals the recorder constant, fixtures, mapping, errors, retry, abort | T5 |
| tests/unit/agent-spike-provider.test.ts | created | Provider choice, refusal text, model override | T7 |
| tests/unit/agent-loop.test.ts | edited | Fake `Provider`; usage; a fixture replay per format; key only in the Bearer header | T6 |
| tests/unit/model-key.test.ts, agent-env.test.ts | edited | `agentgateway` name; `HARNESS_SPIKE_PROVIDER` only with the flag | T7 |
| tests/live/spike.live.test.ts | edited | One live run per format against the root base URL | T8 |
| tests/e2e/spike-agent.spec.ts | edited | `openai/` fixtures at `/v1`; seed under `agentgateway`; close check waits on the close event or exit (15 s); other checks kept | T9 |
| docs/decisions.md | edited | D26 added; D23 and D25 notes | T10 |
| CHANGELOG.md, CLAUDE.md, README.md | edited | Added and Changed entries; spike settings and commands | T10 |
| docs/phases/phase-01-progress.md | edited | Follow-ups for this subtask | T10 |

Workflow files (group 2: PLAN.md, SPECS.md, SUBTASK.md, tasks.md, build-ledger.md, changes.md, this report):
| File | Action | What and why | Task |
| --- | --- | --- | --- |
| docs/specs/p1-provider-interface/PLAN.md | created | Approved plan | planning |
| docs/specs/p1-provider-interface/SPECS.md | created | Approved spec, revised once (AC3, AC7, AC8, AC13 in revision 1) | planning, revision 1 |
| docs/specs/p1-provider-interface/SUBTASK.md | created | Child-ticket draft (not published; no tracker) | planning |
| docs/specs/p1-provider-interface/tasks.md | created | T1–T10 and T5a ticked; T11's CI half is checked after the commit | all |
| docs/specs/p1-provider-interface/build-ledger.md | created | Build ledger | workflow |
| docs/specs/p1-provider-interface/changes.md | created | Implementor's change notes | workflow |
| docs/specs/p1-provider-interface/SUMMARY.md | created | This report | workflow |

## Acceptance criteria
| AC | Status | Evidence |
| --- | --- | --- |
| AC1 | Met | `types.ts`; import check on `types.ts` and `loop.ts` |
| AC2 | Met | `openai.ts`; openai adapter tests and fixture replay |
| AC3 | Met (revision 1) | `anthropic.ts` Bearer only, SDK version; adapter tests; live run passed |
| AC4 | Met | `errors.ts`; 401, 429, 500 with one retry, network and abort per adapter; no-sentinel tests |
| AC5 | Met | `LoopResult.usage`; finished line `input=<n> output=<n>` |
| AC6 | Met | Loop tests on a fake `Provider`; replay totals openai 715/46, anthropic 963/71 |
| AC7 | Met | `spike-provider.ts`, `host.ts`, `model-key.ts`; unit tests |
| AC8 | Met | Recorder for both formats; both checkpoints; re-recorded with 2026-10-21 |
| AC9 | Met | Adapter and loop replays per format; request and leak checks |
| AC10 | Met | Live suite per format; skips when unset |
| AC11 | Met | Spike e2e passes on Windows with the close-event check |
| AC12 | Met | D26, D23 and D25 notes, CHANGELOG, CLAUDE.md, README, progress |
| AC13 | Local part met | typecheck, lint, format:check pass; `pnpm test` 320 passed, 2 skipped; `pnpm e2e` 15 passed, 2 skipped (Windows); the user's `pnpm test:live` passed 2 of 2 (openai 1.1 s, anthropic 1.0 s) on 2026-11-19. CI on all three OSes is pending the commit |

## Needs a runtime check
- CI on all three OSes after the push, especially the spike e2e's new close check on Linux and macOS.
- The adapters use `key ?? 'no-key-set'` (the old code had `||`), so an empty-string key would send an empty token. This is probably unreachable, because the store returns null or a non-empty value.
- The reviewer did not read the new unit test files; AC4 and AC9 coverage rests on `changes.md` and the reported runs.

## Review ledger
Covers every revision, copied from `docs/specs/p1-provider-interface/build-ledger.md`.
### Revision 1, round 1  (PASS)
| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| (none) | | | | | |

No review ran in revision 0; the build paused at the planned recording checkpoint and then at the T5 spec problem.

## Spec revisions
- Revision 0, the recording checkpoint (AC8, planned): the user recorded both formats; continued as a documented deviation.
- Revision 1: the build stopped at T5. `@anthropic-ai/sdk` 1.10.0 sends `Authorization: Bearer` for `apiKey` too and never sends `x-api-key`, and its default `anthropic-version` is 2026-10-21, while the fixtures had 2023-06-01. The user chose **Revise the spec**:
  - the adapter is Bearer only (not chosen: `x-api-key` through headers; pinning an older SDK);
  - the SDK's default version is used, the recorder sends the same version, and the Anthropic fixtures are re-recorded;
  - the user runs `pnpm test:live` before approval;
  - fallback if the version is rejected: pin 2023-06-01. It was not needed.

  Re-approved by the user. The Anthropic re-record checkpoint then continued as a documented deviation.

## Rejected findings
none

## Open issues
none. Notes for your judgement:
- The OpenAI adapter sends `max_tokens` when a request sets `maxTokens`; AC2 doesn't say either way, and the spike never sets it.
- A `HARNESS_SPIKE_BASE_URL` ending in `/v1` gives `/v1/v1/messages` for the Anthropic format. The docs say to use the root; `p1-openai-compatible` presets can settle it.
- The spike e2e's expected answer text is now "The file notes.txt contains", the wording of the new fixture.
- Your old `spike` store entry is no longer read; run `pnpm secrets:set agentgateway` before using the spike in the app.

## Git state
feature/p1-provider-interface; approved; committed and pushed in the commit that adds this report.

## Next steps
Approve, commit and push (CI on the PR then has to go green on all three OSes); or request changes; or not yet.
