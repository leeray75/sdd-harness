---
status: done
ticket:
---

# chore-ci-actions-node24

## Problem

Every job in the CI workflow shows a Node.js 20 deprecation annotation. `.github/workflows/ci.yml` uses `actions/checkout@v4`, `actions/setup-node@v4` and `actions/upload-artifact@v4`, which run on the deprecated Node 20 Actions runtime. Nothing fails yet, but the warning has been on every run since Phase 0 (recorded as a follow-up in `docs/phases/phase-00-progress.md`). Nothing tells the project when an action has a newer version.

## Goals

- **G1 (bumps):** the workflow uses the current major version of each action (`@v7`), all of which run on Node 24. The workflow otherwise behaves exactly as before.
- **G2 (Dependabot):** GitHub Actions versions are checked weekly, and updates arrive as pull requests.
- **G3 (docs):** the changelog, `CLAUDE.md`'s CI section and the progress files describe the change.

## Non-goals

- Changing the project's Node version (`.nvmrc`, `engines`, D18) or Electron. The project stays on Node 24, which Electron 45 ships.
- Dependabot for npm or any other ecosystem.
- Any other change to the workflow: jobs, matrix, steps, step names, inputs, concurrency or permissions.
- Pinning actions to commit SHAs.
- Product code under `src/`, and p2-jobs-and-prompts.

## Acceptance criteria

- **AC1 (bumps):** in `.github/workflows/ci.yml`:
  - both `actions/checkout@v4` lines read `actions/checkout@v7`;
  - both `actions/setup-node@v4` lines read `actions/setup-node@v7`;
  - the `actions/upload-artifact@v4` line reads `actions/upload-artifact@v7`.

  `git diff` of the file shows only those five lines changed. `with:` inputs (`node-version-file: .nvmrc`, `cache: pnpm`, the upload `name`, `path` and `if-no-files-found`) are unchanged.
- **AC2 (Dependabot):** a new `.github/dependabot.yml` has `version: 2` and exactly one update entry: `package-ecosystem: github-actions`, `directory: /`, `schedule.interval: weekly`.
- **AC3 (docs):**
  - `CHANGELOG.md` under `[Unreleased]`: a Changed entry naming the three actions moved from v4 to v7 (Node 24 runtime), and an Added entry for Dependabot.
  - `CLAUDE.md` CI section: says that Dependabot checks the GitHub Actions weekly, and that its pull requests follow the same CI-green merge rule.
  - `docs/phases/phase-00-progress.md`: the Node 20 actions follow-up is struck through and marked resolved by `chore-ci-actions-node24`.
  - `docs/phases/phase-02-progress.md`: row 3b for `chore-ci-actions-node24`, status pending, inserted after row 3a. The status and commit are filled in after the merge.
  - The stale-doc check (`README.md`, `docs/PRD.md`, `docs/workflow.md`, `docs/decisions.md` D18) is recorded in `changes.md`.
- **AC4 (local checks):** `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test` pass.
- **AC5 (CI):** the pull request's CI run is green on every job (`check`, and `e2e` on Windows, macOS and Linux), and its jobs show no Node.js 20 deprecation annotation. This is checked on the PR before the merge.

## Open questions

- none
