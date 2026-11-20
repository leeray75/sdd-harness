# Plan: p2-fix-e2e-selfcheck

Ticket: none (vibe planning; Phase 2, inserted fix before subtask 4)
Status: approved
Date: 2026-11-20

## Objective

The CI `e2e` job has failed on Windows, macOS and Linux on every run since p2-policy-engine (PR #14, run #31). One test is stale: `tests/e2e/agent-process.spec.ts` still expects the reader-only gate's `tool call denied … only the reader job` line. D30 replaced that line with a Rule event, so the test times out. This fix updates the test to D30's behaviour, so the e2e job is green again. It also adds a rule so a red CI run is not merged again without anyone noticing.

## Scope

- **In:**
  - `tests/e2e/agent-process.spec.ts`:
    - Expect main's Rule line for the writer's self-check: `[harness] rule blocked: job=writer tool=write_file target=selfcheck.txt reason=not allowed: source files can be edited only after the spec is approved`.
    - Expect the agent's matching `received denied result id=selfcheck-1 reason=…` line with the same reason.
    - Replace "`selfcheck.txt` never in the output" with these checks:
      - the target appears only in its cleaned-up, relative form;
      - the absolute repo path never appears in a `rule` line;
      - `probe-body` never appears anywhere.
    - Update the test title and comments to the D30 wording.
  - A check of the other e2e specs for stale expectations. All 14 others pass locally, so no change is expected.
  - **Docs:**
    - `CHANGELOG.md`: a Fixed entry.
    - `CLAUDE.md` Conventions and step 6 of `docs/phases/phase-02-tool-policy.md`: a pull request is merged only when its CI run is green, and the result-approval and close messages name the CI state and give the compare or run link.
    - The progress file: an inserted row for this fix, and a follow-up note that CI was red from PR #14 to PR #15.
- **Out:**
  - Any product code change, since the app's behaviour is correct under D30.
  - Changes to the CI workflow itself.
  - The later phase docs (03–09): they pick the rule up from `CLAUDE.md`.
  - p2-jobs-and-prompts.

## Decisions

| Question | Decision | Alternatives considered |
| --- | --- | --- |
| Feature slug, repo, branch | `p2-fix-e2e-selfcheck`; sdd-harness; base `main`; branch `feature/p2-fix-e2e-selfcheck` | `p2-ci-e2e-fix` |
| How strict the target check is | Expect `target=selfcheck.txt`; assert that the absolute repo path and `probe-body` never appear | Expect the new line and keep only the `probe-body` check |
| Prevent a repeat | Add a CI-green rule to `CLAUDE.md` and the phase doc; approval and close messages name the CI state | Fix the test only |
| Where the fix runs | A separate small spec before p2-jobs-and-prompts | Fold it into p2-jobs-and-prompts |

## Approach

1. Edit the test's two `toMatch` patterns, its no-leak checks, title and comments. Build the absolute-path check from the test's own `root`.
2. Run `pnpm e2e` locally on Windows: all 15 runnable tests pass, and the 2 macOS-only tests skip.
3. Add the docs: the CHANGELOG, the `CLAUDE.md` convention, phase doc step 6 and the progress file note. Then run `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test`.
4. After the PR is opened, its CI run must be green on all three OSes before the merge. This is the first use of the new rule.

## Verified assumptions

| Assumption | Evidence |
| --- | --- |
| Only this test fails, and it fails the same way on each OS | Local `pnpm e2e`: 1 failed, 14 passed, 2 skipped. CI run 44817554370: the e2e step fails on all three OSes (step 8 on Linux, step 9 elsewhere, which is the same e2e step), and `check` passes |
| The app now prints the Rule line with the target and the new reason | Local run output: `[harness] rule blocked: job=writer tool=write_file target=selfcheck.txt reason=not allowed: source files can be edited only after the spec is approved` |
| The self-check sends `write_file` with path `selfcheck.txt` and body `probe-body` | `src/agent/index.ts:112-121` |
| The `tool call denied` line was replaced on purpose | `CHANGELOG.md:116` (p2-policy-engine) |
| CI has been red since PR #14 | Actions history: run #30 passed; #31–#35 failed |

## Risks

- **Not reproduced on macOS or Linux:** another failure could be hidden behind this one, because Playwright stops the test at its first failed check. The PR's CI run will show it, and the new rule blocks the merge until it is green.
- **The reason text changes again in Phase 3**, when real spec states arrive. The test would then need another update. The pattern keys on the job, tool and target, plus the full current reason, so a change is caught rather than hidden.

## Open questions

None.
