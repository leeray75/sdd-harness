# Summary Report: p2-human-only-channel

Ticket: none Date: 2026-11-21
Outcome: Clean
Review rounds: 1 of 3 per revision; revisions: 1 of 2
Models: implementor haiku; reviewer sonnet; data agent not used (all chosen by the user); respawns: none

## What was built

- **G1 (contract):** `src/shared/human-actions.ts` holds:
  - the five action ids;
  - the `{ action, feature }` request;
  - a result with four refusal codes;
  - a guard that checks exact keys and the slug rules, and never echoes a value in its reasons.
- **G2 (gesture):** a pure tracker in `src/main/human/gesture.ts` is fed by the main window's own `input-event`.
  - A left mouse press, or Enter or Space that isn't an auto-repeat, counts as a gesture for 1000 ms.
  - Each gesture is used once.
- **G3 (channel):** `src/main/human/channel.ts` serves `harness:human-action`.
  - It checks the sender, then the request, then the gesture.
  - It dispatches to a handler registry. No handlers are registered yet, so an accepted call returns `not-available` until Phase 3.
  - It logs each decision.
- **G4 (bridge):** the preload exposes `harness.humanAction(request)`.
- **G5 (proof):** unit tests show:
  - the agent protocol refuses human-action messages;
  - no tool names a human action;
  - no file under `src/agent/` can reach the channel;
  - "approve the spec" or "git push" in a file or ticket leads only to refused, Rule-logged tool calls.

  An e2e spec shows, in the built app, that a scripted call is refused and that a call right after a real click or Enter is accepted.
- **G6 (docs):** D33, the new `docs/human-actions.md`, CHANGELOG entries, and the PRD, README, phase doc and progress file updated.

## Files changed

Product files (group 1):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/shared/human-actions.ts | created | Action ids, request and result types, `parseHumanActionRequest` | T1 |
| tests/unit/human-actions.test.ts | created | AC1 guard tests | T1 |
| src/main/human/gesture.ts | created | Pure gesture tracker, `GESTURE_WINDOW_MS = 1000`, consume-once | T2 |
| tests/unit/human-gesture.test.ts | created | AC2 tracker tests | T2 |
| src/main/human/channel.ts | created | Ordered checks, registry, handler errors, decision log line | T3 |
| tests/unit/human-channel.test.ts | created | AC3 channel tests | T3 |
| src/shared/bridge.ts | edited | `IPC_CHANNELS.humanAction` and `HarnessBridge.humanAction` | T4 |
| src/preload/index.ts | edited | `humanAction` through `ipcRenderer.invoke` | T4 |
| src/main/index.ts | edited | Tracker on the main window's `input-event`; channel with `isTrustedSender` and `log`; IPC handler; no action handlers | T4 |
| tests/unit/bridge.test.ts | edited | Channel name, member type, preload exposure test | T4 |
| tests/e2e/smoke.spec.ts | edited | Expected `window.harness` keys include `humanAction` (direct effect of AC4) | T4 |
| tests/unit/human-agent-boundary.test.ts | created | AC5: protocol guard, tool names, `src/agent/` source scan | T5 |
| tests/unit/human-text-acceptance.test.ts | created | AC6: file and ticket text, three denied calls with Rule events (`run_command` named, `-` for the others), no handler called, no extra log line | T5, revision 1 |
| tests/e2e/human-action.spec.ts | created | AC7 cases (a)–(f) | T6 |
| docs/decisions.md | edited | D33 | T7 |
| docs/human-actions.md | created | Reference for the channel | T7 |
| CHANGELOG.md | edited | Added entries under `[Unreleased]` | T7 |
| docs/phases/phase-02-progress.md | edited | Open question settled by D33; D33 listed; row 5 stays pending | T7 |
| docs/phases/phase-02-tool-policy.md | edited | Open question struck through and settled by D33 | T7 |
| docs/PRD.md | edited | D3 row and Human-only NFR row: "user gesture (a click, or an Enter or Space press)", citing D33 | T7 |
| README.md | edited | Decisions row count was stale (D1–D20); now D1–D33 | T7 |

Workflow files (group 2):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| docs/specs/p2-human-only-channel/PLAN.md | created | Approved plan | planning |
| docs/specs/p2-human-only-channel/SPECS.md | created | Approved spec (revision 1 amends AC6) | planning, revision 1 |
| docs/specs/p2-human-only-channel/SUBTASK.md | created | Child-ticket draft, not published (no tracker) | planning |
| docs/specs/p2-human-only-channel/tasks.md | created | T1–T8 ticked; T5 unticked by revision 1 and ticked again | T1–T8 |
| docs/specs/p2-human-only-channel/build-ledger.md | created | Build ledger | build |
| docs/specs/p2-human-only-channel/changes.md | created | Change rows, stale-doc table, checks run | build |
| docs/specs/p2-human-only-channel/SUMMARY.md | created | This report | build |

`CLAUDE.md` and `docs/workflow.md` were checked and left unchanged. The reasons are in `changes.md`.

## Acceptance criteria

| AC | Status | Evidence |
| --- | --- | --- |
| AC1 contract | Met | `src/shared/human-actions.ts`; `human-actions.test.ts` (27 tests) |
| AC2 gesture tracker | Met | `src/main/human/gesture.ts`; `human-gesture.test.ts` (29 tests) |
| AC3 channel | Met, with one point for you | `src/main/human/channel.ts`; `human-channel.test.ts` (24 tests). A throwing handler logs two lines (see Open issues) |
| AC4 bridge and wiring | Met | `bridge.ts`, preload, `src/main/index.ts`; `bridge.test.ts`; smoke e2e key list |
| AC5 agent can't reach it | Met | `human-agent-boundary.test.ts` |
| AC6 file or ticket text | Met (revision 1) | `human-text-acceptance.test.ts` |
| AC7 e2e | Met on Windows; macOS and Linux in CI | `tests/e2e/human-action.spec.ts`; `pnpm e2e` 21 passed, 2 skipped (macOS-only cases) on Windows |
| AC8 docs | Met | D33, `docs/human-actions.md`, CHANGELOG, PRD, README, phase doc, progress file, stale-doc table |
| AC9 checks | Local met; CI pending | Rerun by the orchestrator: typecheck, lint and format:check pass; test passes (54 files; 1173 passed, 12 skipped). CI is checked on the PR |

## Needs a runtime check

- **AC7 on macOS and Linux (CI):** that `input-event` fills in `button`, `key` and `isAutoRepeat`, so cases (c) and (e) return `not-available`. Electron's typings declare only `type` and `modifiers`, though Windows does fill them.
- **Linux timing:** that case (f)'s wait stays longer than the 1000 ms window under xvfb.
- **Accessibility (Phase 5 UI):** that a screen reader's default action arrives as a mouse press, or as Enter or Space.

## Review ledger

### Revision 0

Implementation only. The build paused for the AC6 spec problem before any review ran.

### Revision 1, round 1 (PASS)

| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| R1-1: a throwing handler writes two log lines, where AC3 says one line per call | minor (optional) | src/main/human/channel.ts:121 | not sent (PASS ends the loop) | The reviewer marked it optional, because AC3 also asks that the error be logged | none; left for you to decide |

## Spec revisions

- **Revision 1 (AC6):** AC6 said every refused call's Rule event names the tool. For `approve_spec` and `git_push`, which are not registry tools, D30's `makeRuleEvent` records `-`.
  - You chose to revise the spec and keep `-`.
  - The decision is recorded under the spec's Open questions.

## Rejected findings

none

## Open issues

None blocking. Points for you to check:

- **R1-1, AC3's throw path:** a throwing handler logs a diagnostic line, `human action <id>: handler threw (<error name>)`, and then the decision line. That is two lines where AC3 says "exactly one".
  - Request changes to fold the error name into the single decision line, or accept it as it is.
  - No handler exists yet, so this path can't run in the app until Phase 3.
- **Review depth:** the reviewer read the AC5–AC7 test files through `changes.md` and the implementation report, not line by line. Those tests pass locally, and CI runs the e2e spec on all three OSes.
- **Log levels (the implementor's choice):** an accepted call logs at info, and a refused call at error.

## Git state

feature/p2-human-only-channel; approved; committed and pushed in the commit that adds this report

## Next steps

Approve, then commit and push, open the PR, and check that its CI is green on every job before the merge. Or request changes (for example R1-1), or say not yet.
