---
status: approved
ticket:
---

# p2-fix-e2e-selfcheck

## Problem

Since p2-policy-engine (PR #14), the CI `e2e` job has failed on Windows, macOS and Linux. `tests/e2e/agent-process.spec.ts` still waits for the reader-only gate's line, `tool call denied: … only the reader job`. D30 replaced that line with a Rule event, `rule blocked: … target=selfcheck.txt reason=…`, so the test times out. The app behaves as D30 says, and only the test is stale. Nobody noticed for two pull requests, because the green unit tests were taken as a passing build.

## Goals

- **G1 (test):** the self-check e2e test checks D30's behaviour. Main logs a `rule blocked` event for the writer's `write_file` call, with the cleaned-up relative target and the fixed reason. The agent receives the denied result with the same reason. The file body and the absolute repo path never reach the log.
- **G2 (green CI):** with this change, `pnpm e2e` passes on Windows, macOS and Linux in CI.
- **G3 (no repeat):** the project's rules say that a pull request is merged only when its CI run is green. The result-approval and close messages name the CI state.

## Non-goals

- Any change to product code under `src/`.
- Any change to `.github/workflows/ci.yml`.
- Edits to the later phase docs (03–09); they follow `CLAUDE.md`.
- Job prompts and advertised tools (`p2-jobs-and-prompts`).

## Acceptance criteria

- **AC1 (Rule line):** the test waits, within its existing 20-second polls, for a line matching `[harness] rule blocked: job=writer tool=write_file target=selfcheck.txt reason=not allowed: source files can be edited only after the spec is approved`. It no longer expects `tool call denied` or `only the reader job`.
- **AC2 (agent result):** the test waits for `[agent] received denied result id=selfcheck-1 reason=not allowed: source files can be edited only after the spec is approved`.
- **AC3 (no leak):**
  - `probe-body` never appears in the output.
  - The absolute repo root, built from the test's `root`, never appears in any `rule` line.
  - The check that `selfcheck.txt` never appears is removed, because D30 logs the target on purpose.
- **AC4 (wording):** the test title and comments describe the D30 Rule event, not the reader-only gate. The existing checks stay unchanged: the agent's ready pid differs from main's, and the app closes without "agent exited unexpectedly".
- **AC5 (other specs):** the other e2e specs were checked for stale expectations, and the result is recorded in `changes.md`. With no product change, `pnpm e2e` passes locally on Windows: 15 passed, 2 skipped (macOS only).
- **AC6 (docs):**
  - `CHANGELOG.md` gets a Fixed entry under `[Unreleased]`.
  - `CLAUDE.md` Conventions and step 6 of `docs/phases/phase-02-tool-policy.md` say that a pull request is merged only when its CI run is green on every job. They also say that the result-approval and close messages state the CI state and link the run or the compare page.
  - `docs/phases/phase-02-progress.md` gets an inserted row for this fix. Its follow-ups record that CI was red from PR #14 through PR #15, and that this fix restores it. The status and commit for this fix are filled in after the merge.
  - The stale-doc check (`README.md`, `docs/PRD.md`, `docs/workflow.md`) is recorded in `changes.md`.
- **AC7 (checks):** `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test` pass. The pull request's CI run is green on all three OSes before the merge.

## Open questions

- none
