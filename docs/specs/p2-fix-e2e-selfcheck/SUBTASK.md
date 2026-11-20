# Fix the stale self-check e2e test and add a CI-green merge rule (p2-fix-e2e-selfcheck)

**Parent:** none (no parent chosen)
**Spec:** docs/specs/p2-fix-e2e-selfcheck/SPECS.md
**Repo and base branch:** sdd-harness, `main`, feature branch `feature/p2-fix-e2e-selfcheck`

## Context

The CI `e2e` job has failed on all three OSes since PR #14. D30 replaced main's `tool call denied` log line with a `rule blocked` Rule event that carries the target and a new reason. `tests/e2e/agent-process.spec.ts` still waits for the old line. The app is correct, so only the test changes. A new rule makes merges wait for green CI.

## Required work

- T1 Update the self-check e2e test
- T2 Check the other e2e specs
- T3 Changelog and docs (CI-green rule)
- T4 Full checks

## Acceptance criteria

The full wording of each criterion is in the spec.

- AC1: the test expects the D30 `rule blocked` line with `target=selfcheck.txt` and the spec-state reason.
- AC2: the test expects the agent's denied result with the same reason.
- AC3: `probe-body` and the absolute root never appear; the `selfcheck.txt` ban is dropped.
- AC4: the title and comments use the D30 wording; the pid and clean-exit checks are kept.
- AC5: the other e2e specs are checked; `pnpm e2e` passes locally (15 passed, 2 skipped).
- AC6: a CHANGELOG Fixed entry, the CI-green rule in `CLAUDE.md` and the phase doc, and the progress row with a follow-up.
- AC7: the full checks pass, and the PR's CI is green on Windows, macOS and Linux before the merge.

## Out of scope

- Product code under `src/`.
- `.github/workflows/ci.yml`.
- Later phase docs.
- `p2-jobs-and-prompts`.

## Links

- Plan: docs/specs/p2-fix-e2e-selfcheck/PLAN.md
- Spec and tasks: docs/specs/p2-fix-e2e-selfcheck/SPECS.md, docs/specs/p2-fix-e2e-selfcheck/tasks.md
