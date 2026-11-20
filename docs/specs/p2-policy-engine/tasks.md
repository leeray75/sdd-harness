# Tasks: p2-policy-engine

Work in order. After each task, run its check, then tick the box.

- [x] **T1 — Policy table and context.**
  - Write `src/main/policy/policy-table.ts` (`BASE_TOOLS`) and `src/main/policy/context.ts` (`SpecState`, `PolicyContext`, `CommandCheck`, `denyAllCommands`, `DEFAULT_POLICY_CONTEXT`, and the feature-slug rule).
  - Add `tests/unit/policy-table.test.ts` for the table (AC1, its table part).

  **Check:** `pnpm typecheck` and `pnpm test` pass.
- [x] **T2 — Path areas.**
  - Write `src/main/policy/path-areas.ts` (`classifyPath`, `PathArea`).
  - Add `tests/unit/policy-paths.test.ts` with the AC2 table (at least 25 cases).

  **Check:** `pnpm test`.
- [x] **T3 — Tightening.**
  - Write `src/main/policy/tightening.ts` (`Tightening`, `parseTightening`, `effectiveTools`).
  - Add `tests/unit/policy-tightening.test.ts` (AC6), including the every-job, every-tool "never adds" test.

  **Check:** `pnpm test`.
- [x] **T4 — Rule events.**
  - Write `src/main/policy/rule-event.ts` (`RuleEvent`, target extraction and sanitizing, `formatRuleEvent`, `logRuleEvent`).
  - Add `tests/unit/policy-rule-events.test.ts` (AC7, the event and sink parts).

  **Check:** `pnpm test`.
- [x] **T5 — Gate.**
  - Rewrite `src/main/policy/gate.ts`: `checkToolCall(request, context)` returns a `PolicyDecision` with the ordered checks and fixed reasons from the spec.
  - Rewrite `tests/unit/policy-gate.test.ts`: AC1, AC3, AC4 and AC5, and the deny reasons containing no argument value.

  **Check:** `pnpm test`.
- [x] **T6 — Router and host.**
  - Change `src/main/agent/router.ts` to `PolicyDecision` and `onRuleEvent`: one event per validated tool call; the denial log line replaced.
  - Change `src/main/agent/host.ts` to `DEFAULT_POLICY_CONTEXT` and `logRuleEvent(log)`.
  - Update `tests/unit/agent-router.test.ts` (AC7, router part; AC8) and `tests/unit/tool-reachability.test.ts` (AC12).

  **Check:** `pnpm typecheck` and `pnpm test`.
- [x] **T7 — Tool-layer checks.**
  - Add the symlink re-check to `write-file.ts` and `edit-file.ts` (AC9).
  - Add `hasNodeModulesSegment` to `src/main/tools/paths.ts` and the refusal to `list-files.ts` and `search-text.ts` (AC10).
  - Extend `tests/unit/tool-write.test.ts` and `tests/unit/tool-files.test.ts`.

  **Check:** `pnpm test`.
- [x] **T8 — Acceptance test.**
  - Add `tests/unit/policy-acceptance.test.ts` (AC11, and the F1 criteria as named tests): the router with the real gate and a real runner on a temporary root.

  **Check:** `pnpm test`.
- [x] **T9 — Full checks.** Run the full checks (AC13). **Check:** `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` all pass.
