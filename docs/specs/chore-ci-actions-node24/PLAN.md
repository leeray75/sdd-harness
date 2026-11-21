# Plan: chore-ci-actions-node24

Ticket: none (vibe planning; inserted chore during Phase 2, before subtask 4)
Status: approved
Date: 2026-11-21

## Objective

Every CI job shows a Node.js 20 deprecation annotation, because `.github/workflows/ci.yml` still uses `actions/checkout@v4`, `actions/setup-node@v4` and `actions/upload-artifact@v4`, which run on the Node 20 Actions runtime. This chore moves the three actions to their current major versions, all of which run on Node 24. It also adds Dependabot for GitHub Actions, so later bumps arrive as pull requests instead of sitting as a warning. The project's own Node stays on 24, the version Electron 45 ships, so `.nvmrc`, `engines` and D18 don't change.

## Scope

- **In:**
  - `.github/workflows/ci.yml`:
    - `actions/checkout@v4` → `@v7`, in both jobs;
    - `actions/setup-node@v4` → `@v7`, in both jobs, keeping `node-version-file: .nvmrc` and `cache: pnpm`;
    - `actions/upload-artifact@v4` → `@v7`, with the same inputs.
  - A new `.github/dependabot.yml` for the `github-actions` ecosystem only, checked weekly.
  - **Docs:**
    - `CHANGELOG.md`: a Changed entry for the bumps and an Added entry for Dependabot.
    - `CLAUDE.md` CI section: mention Dependabot, and that its pull requests follow the same CI-green merge rule.
    - `docs/phases/phase-00-progress.md`: mark the Node 20 actions follow-up resolved, pointing to this spec.
    - `docs/phases/phase-02-progress.md`: insert row 3b (pending) for this chore.
    - Check `README.md`, `docs/PRD.md` and `docs/workflow.md` for stale mentions, and record the result in `changes.md`.
- **Out:**
  - The project's Node version (`.nvmrc`, `engines`, D18) and Electron.
  - Dependabot for npm or any other ecosystem.
  - Any other workflow change: jobs, matrix, steps, concurrency, permissions.
  - Product code under `src/`, and p2-jobs-and-prompts.

## Decisions

| Question | Decision | Alternatives considered |
| --- | --- | --- |
| Feature slug, repo, branch | `chore-ci-actions-node24`; sdd-harness; base `main`; branch `feature/chore-ci-actions-node24` | `p2-ci-actions-node24` |
| How to reference the actions | Major tags (`@v7`), the same style as today | Full commit SHAs with a version comment |
| Dependabot | Add `.github/dependabot.yml` for `github-actions` only, weekly | Bump only, no Dependabot |
| Tracking | Row 3b in `phase-02-progress.md`, and the Phase 0 follow-up marked resolved | The Phase 0 follow-up only |
| Project Node version | Stay on Node 24 (Electron 45 ships Node 24.22.3); D18 unchanged | Move tools to Node 26 LTS (would test on a Node the app doesn't ship) |

## Approach

1. Edit the five `uses:` lines in `ci.yml`. Change nothing else in the file.
2. Add `.github/dependabot.yml`: `version: 2`, one `package-ecosystem: github-actions` entry, `directory: /`, `schedule.interval: weekly`.
3. Update the docs listed above.
4. Run the local checks (`pnpm typecheck && pnpm lint && pnpm format:check && pnpm test`) so formatting of the new YAML and docs passes. The real check is the pull request's CI run: all four jobs green, and no Node 20 deprecation annotation.

## Verified assumptions

| Assumption | Evidence |
| --- | --- |
| The workflow uses the three actions at `@v4`, five `uses:` lines | `ci.yml`: checkout and setup-node in `check` and `e2e`, upload-artifact in `e2e` |
| The current majors are checkout v7 (v7.0.1), setup-node v7 (v7.1.0), upload-artifact v7 (v7.0.2) | GitHub releases pages, read 2026-11-21 |
| All three run on Node 24 | checkout moved at v5, setup-node at v5, upload-artifact at v6 (release notes) |
| `cache: pnpm` still works in setup-node v7 | v5 added automatic caching from `packageManager`; v6 limited *automatic* caching to npm. An explicit `cache: pnpm` input is unaffected |
| setup-node v6.3's `devEngines.runtime` change doesn't apply | It only applies when `node-version-file` is `package.json`; ours is `.nvmrc` |
| checkout v7's fork block doesn't apply | It affects `pull_request_target` and `workflow_run`; ours uses `push`, `pull_request` and `workflow_dispatch` |
| upload-artifact v7's direct upload is opt-in | Only with `archive: false`; we keep the default zip |
| GitHub-hosted runners meet the v6+ minimum runner version (2.327.1) | GitHub-hosted runners are kept current |
| Electron 45 ships Node 24.22.3 | `ELECTRON_RUN_AS_NODE=1 electron -e process.versions` → `24.22.3 45.3.4` |
| Docs that name the actions | `CLAUDE.md:77` (names `actions/setup-node`, no version); `phase-00-progress.md:36` (the follow-up) |

## Risks

- **A major bump changes behaviour quietly**, for example the pnpm cache or the artifact upload. The PR's CI run shows the cache step, and a green run on all three OSes confirms the install works. The upload step runs only on failure, so a green run doesn't exercise it. Its inputs are unchanged and v7's change is opt-in.
- **Dependabot opens PRs right after the merge** if any action has a newer version. That's expected; each PR goes through CI and the green-merge rule.

## Open questions

- none
