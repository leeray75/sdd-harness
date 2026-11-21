# Bump the CI actions to v7 (Node 24) and add Dependabot (chore-ci-actions-node24)

**Parent:** none (no parent chosen)
**Spec:** docs/specs/chore-ci-actions-node24/SPECS.md
**Repo and base branch:** sdd-harness, `main`, feature branch `feature/chore-ci-actions-node24`

## Context

Every CI job shows a Node.js 20 deprecation annotation, because the workflow uses `actions/checkout`, `actions/setup-node` and `actions/upload-artifact` at `@v4`. Their v7 releases run on Node 24. Dependabot is added so later action updates arrive as pull requests. The project's Node stays on 24, which Electron 45 ships.

## Required work

- T1 Bump the actions
- T2 Add Dependabot
- T3 Changelog and docs
- T4 Full checks

## Acceptance criteria

The full wording of each criterion is in the spec.

- AC1: the five `uses:` lines read `@v7`; nothing else in `ci.yml` changes.
- AC2: `.github/dependabot.yml` checks `github-actions` weekly, one entry.
- AC3: CHANGELOG entries, `CLAUDE.md` CI section, the Phase 0 follow-up resolved, row 3b, the stale-doc check.
- AC4: typecheck, lint, format:check and test pass.
- AC5: the PR's CI is green on every job, with no Node 20 deprecation annotation.

## Out of scope

- The project's Node version, Electron, D18.
- Dependabot for npm.
- Other workflow changes; SHA pinning.
- Product code; p2-jobs-and-prompts.

## Links

- Plan: docs/specs/chore-ci-actions-node24/PLAN.md
- Spec and tasks: docs/specs/chore-ci-actions-node24/SPECS.md, docs/specs/chore-ci-actions-node24/tasks.md
