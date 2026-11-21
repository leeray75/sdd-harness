# Summary Report: chore-ci-actions-node24

Ticket: none Date: 2026-11-21
Outcome: Clean
Review rounds: 2 of 3 per revision; revisions: 0 of 2
Models: implementor haiku; reviewer sonnet; data agent not used (all chosen by the user); respawns: none

## What was built

- **G1 (bumps):** `.github/workflows/ci.yml` now uses `actions/checkout@v7`, `actions/setup-node@v7` and `actions/upload-artifact@v7`, which run on the Node 24 Actions runtime. Only the five `uses:` lines changed; every `with:` input is unchanged.
- **G2 (Dependabot):** a new `.github/dependabot.yml` checks the GitHub Actions weekly and opens a pull request for each update.
- **G3 (docs):**
  - CHANGELOG Added and Changed entries;
  - the `CLAUDE.md` CI section mentions Dependabot and the CI-green rule for its PRs;
  - the Phase 0 Node 20 follow-up is resolved, and the stale "Carried into later phases" mention is removed;
  - row 3b is in the Phase 2 progress file.

## Files changed

Product files (group 1):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| .github/workflows/ci.yml | edited | Five `uses:` lines from `@v4` to `@v7` (checkout ×2, setup-node ×2, upload-artifact ×1); nothing else (AC1) | T1 |
| .github/dependabot.yml | created | `version: 2`, one `github-actions` entry, `directory: /`, weekly (AC2) | T2 |
| CHANGELOG.md | edited | Added entry (Dependabot) and Changed entry (actions v4 → v7, Node 24) under `[Unreleased]` (AC3) | T3 |
| CLAUDE.md | edited | CI section: Dependabot checks weekly; its PRs follow the CI-green merge rule (AC3) | T3 |
| docs/phases/phase-00-progress.md | edited | Node 20 follow-up struck and marked resolved; the "Carried into later phases" mention removed (AC3, R1-1) | T3, R1-1 |
| docs/phases/phase-02-progress.md | edited | Row 3b (pending) after 3a; Prettier realigned the table (AC3) | T3 |

`README.md`, `docs/PRD.md`, `docs/workflow.md` and `docs/decisions.md` (D18, D22) were checked and left unchanged. The reasons are in `changes.md`.

Workflow files (group 2):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| docs/specs/chore-ci-actions-node24/PLAN.md | created | Approved plan | planning |
| docs/specs/chore-ci-actions-node24/SPECS.md | created | Approved spec | planning |
| docs/specs/chore-ci-actions-node24/SUBTASK.md | created | Child-ticket draft, not published (no tracker) | planning |
| docs/specs/chore-ci-actions-node24/tasks.md | created | T1–T4, all ticked | T1–T4 |
| docs/specs/chore-ci-actions-node24/build-ledger.md | created | Build ledger | build |
| docs/specs/chore-ci-actions-node24/changes.md | created | Change rows and the stale-doc table | build |
| docs/specs/chore-ci-actions-node24/SUMMARY.md | created | This report | build |

## Acceptance criteria

| AC | Status | Evidence |
| --- | --- | --- |
| AC1 bumps | Met | `git diff` of `ci.yml`: exactly 5 lines changed, all `@v4` → `@v7`; no `with:` input touched (reviewer confirmed in both rounds) |
| AC2 Dependabot | Met | `.github/dependabot.yml`: `version: 2`, one `package-ecosystem: github-actions`, `directory: /`, `interval: weekly` |
| AC3 docs | Met | CHANGELOG, `CLAUDE.md`, phase-00 follow-up and carried list, row 3b, stale-doc table in `changes.md` |
| AC4 local checks | Met | typecheck, lint, format:check and test pass (46 files; 1030 passed, 12 skipped); format:check rerun after round 1 |
| AC5 CI | Pending (PR) | Needs the PR's CI run: green on `check` and `e2e` on all three OSes, and no Node.js 20 deprecation annotation |

## Needs a runtime check

- **AC5 on the PR:** CI green on every job and no Node 20 annotation. This also confirms the v7 majors behave the same with the unchanged inputs (for example the pnpm cache). The upload step runs only on failure, so a green run doesn't exercise it.
- **After the merge,** Dependabot may open PRs right away if a newer action version exists. Each goes through CI and the green-merge rule.

## Review ledger

### Revision 0, round 1 (ISSUES)

| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| R1-1: the "Carried into later phases" line still listed "the Node 20 action warning" as open, which contradicted the struck line 36 | minor | docs/phases/phase-00-progress.md:58 | ACCEPT | CLAUDE.md requires the progress file's follow-ups to be updated in the same change; AC3 doesn't forbid it | Removed the item from line 58; updated the changes.md rows |

### Revision 0, round 2 (PASS)

| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| (none) | | | | | |

## Spec revisions

none

## Rejected findings

none

## Open issues

none

## Git state

feature/chore-ci-actions-node24; approved; committed and pushed in the commit that adds this report

## Next steps

Approve, then commit and push, open the PR, and check that its CI is green with no Node 20 annotation before you merge. Or request changes, or say not yet.
