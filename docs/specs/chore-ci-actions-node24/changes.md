# Changes: chore-ci-actions-node24

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| `.github/workflows/ci.yml` | edited | Five `uses:` lines moved from `@v4` to `@v7` (checkout x2, setup-node x2, upload-artifact x1) for the Node 24 runtime. Nothing else changed. | T1 |
| `.github/dependabot.yml` | created | Dependabot config: `version: 2`, one `github-actions` entry, `directory: /`, weekly schedule, with a short leading comment. | T2 |
| `CHANGELOG.md` | edited | Added a Dependabot entry under `[Unreleased]` Added, and a Changed entry for the three actions moving from v4 to v7. | T3 |
| `CLAUDE.md` | edited | CI section: one sentence that Dependabot checks the GitHub Actions weekly and its PRs follow the CI-green merge rule. | T3 |
| `docs/phases/phase-00-progress.md` | edited | Node 20 actions follow-up (line 36) struck through and marked resolved by `chore-ci-actions-node24`. Round 1 (R1-1, round 1): removed "the Node 20 action warning" from the "Carried into later phases" list (line 58), which contradicted the strike. | T3, R1-1 round 1 |
| `docs/phases/phase-02-progress.md` | edited | Inserted row 3b (`chore-ci-actions-node24`, pending) after row 3a. Prettier realigned the table columns. | T3 |
| `docs/specs/chore-ci-actions-node24/tasks.md` | edited | Ticked T1, T2, T3 and T4 after their checks passed. | T1, T2, T3, T4 |
| `docs/specs/chore-ci-actions-node24/changes.md` | created | This record of the changes and the stale-doc check. | T3 |

## Stale-doc check

| Doc | Result | Reason |
| --- | --- | --- |
| `README.md` | no change needed | Line 11 says Node 24 (`.nvmrc`), which is still true. No action versions or Node 20 mention. |
| `docs/PRD.md` | no change needed | No mention of the CI actions or of Node versions. |
| `docs/workflow.md` | no change needed | No mention of the CI actions or of Node versions. |
| `docs/decisions.md` D18 | no change needed | D18 records the app's Node 24 LTS choice, which this change does not alter (the spec's non-goal). D22 (CI) names no action versions, so it is still accurate. |
| `docs/phases/phase-00-progress.md` "Carried into later phases" (line 58) | changed (round 1, R1-1) | The list named "the Node 20 action warning", which contradicted the strike on line 36. The item was removed. |
