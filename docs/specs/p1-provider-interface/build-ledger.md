# Build ledger: p1-provider-interface
state: done
revision: 1
resume on approve: no
current round: 1 of 3, in revision 1
phase: reviewing
Implementor: a3f50740975cd8fe6, haiku    Reviewer: a9c7334fab21d8431, sonnet
Data agent: none yet
Models: chosen by the user (standing choice for Phase 1: implementor Haiku, reviewer Sonnet); reused on resume, not asked again.
Respawns: none

## Revision 0, implementation (paused at the planned recording checkpoint, before review)
T1 done: recorder takes `openai` (default) or `anthropic`; typecheck passes; no-env runs print the missing-variable message, exit 1, no key, no network; a bogus format is refused. Notes: the openai models check now hits `{base}/v1/models`; the 404 hint says the base URL must not include /v1; the anthropic format skips the models check; old fixtures untouched (T6 removes them).

## Revision 0, implementation resumed (paused again at T5, before review)
T2–T4 done; T5 stopped. typecheck passes; pnpm test 303 passed, 3 failed (all in agent-provider-anthropic.test.ts, kept on purpose: x-api-key header, placeholder in x-api-key header, anthropic-version 2023-06-01). Implementor notes: the openai adapter sends `max_tokens` when the request sets `maxTokens` (not specified by AC2; for the reviewer).

## Spec problems
- Revision 0 pause (from the implementation step, T1): AC8 "after the recorder change, the implementor stops with `NEEDS-SPEC-CHANGE: recording checkpoint`. The user runs both formats in their own shell with their gateway key". Planned checkpoint, not a spec defect. User recorded both formats in the Terminal panel (openai via qwen3.8-flash-next-nothink, anthropic via claude-haiku-5-5; 2 files each; no auth strings in any file). User chose: continue as a documented deviation (no spec change); review counter not reset.
- Revision 0 pause (from the implementation step, T5): AC3 "`x-api-key` sets `apiKey = key` and `authToken = null`" and "A `null` key sends the placeholder `no-key-set` in the chosen header." `@anthropic-ai/sdk` 1.10.0 sends `Authorization: Bearer` for both `apiKey` and `authToken` (client.js 450-462, verified by the orchestrator); it never sends `x-api-key`. Related: the SDK's default `anthropic-version` is `2026-10-21` (client.js 979); the recorder used `2023-06-01`. Candidates: (a) bearer-only adapter, amend AC3; (b) send `x-api-key` through `defaultHeaders` with apiKey and authToken null; (c) pin an older SDK; (d) keep the mode, document that it sends Bearer. User chose: Revise the spec (revision 1): Bearer-only adapter; SDK default anthropic-version, recorder sends the same, Anthropic fixtures re-recorded, user runs pnpm test:live before approval; fallback pin 2023-06-01 if rejected. AC3, AC7 wording, AC8, AC13 revised; T5a added, T5 and T11 revised.

## Carried findings
none

## Revision 1, implementation (Mode 3)
Resumed after re-approval (spec sha256 7e5362b8). Implementor continued with T5a.
T5a done: recorder sends ANTHROPIC_VERSION = 2026-10-21 (SDK 1.10.0 default); typecheck and prettier pass; no-env run prints the missing-variable message, no key. Paused at the planned anthropic re-record checkpoint (AC8, revision 1); user re-records the anthropic format.
User re-recorded the anthropic format with anthropic-version 2026-10-21 (accepted; no fallback); files rewritten, no auth strings. Continued as a documented deviation (no spec change); review counter not reset. Implementor resumed at T5.
T5–T10 done; T11 local checks pass (CI pending). typecheck, lint, format:check pass; pnpm test 320 passed, 2 skipped; pnpm e2e (Windows) 15 passed, 2 skipped; test:live unset skips both. Notes: recorder version read by regex in the anthropic test; old fixtures deleted; e2e answer literal now "The file notes.txt contains"; openai adapter sends max_tokens when set; a base URL ending in /v1 breaks the anthropic format (docs say root).

## Revision 1, round 1  (PASS)
| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| (none) | | | | | |

Reviewer accepted deviations: recorder version read by regex; openai max_tokens only when set; e2e answer literal follows the new fixture. Reviewer did not read the new unit test files (AC4, AC9 coverage rests on changes.md and the reported runs). Runtime notes (not defects): key ?? placeholder (was ||) sends an empty token for an empty-string key, likely unreachable; AC13 CI on three OSes and the user live run pending (the live run confirms the gateway accepts anthropic-version 2026-10-21).

User live run: pnpm test:live 2 of 2 passed (openai, anthropic). User approved the result; committed and pushed.
