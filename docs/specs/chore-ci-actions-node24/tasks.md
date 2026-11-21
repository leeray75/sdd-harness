# Tasks: chore-ci-actions-node24

Work in order. After each task, run its check, then tick the box.

- [x] **T1: Bump the actions.** In `.github/workflows/ci.yml`, change the five `uses:` lines from `@v4` to `@v7` (checkout ×2, setup-node ×2, upload-artifact ×1). Change nothing else (AC1). **Check:** `git diff --stat .github/workflows/ci.yml` shows 5 insertions and 5 deletions, and `grep -c '@v7' .github/workflows/ci.yml` gives 5.
- [x] **T2: Add Dependabot.** Create `.github/dependabot.yml` with `version: 2` and one `github-actions` entry, `directory: /`, weekly (AC2). **Check:** `pnpm exec prettier --check .github/dependabot.yml` passes and the file has exactly one `package-ecosystem` line.
- [x] **T3: Changelog and docs.**
  - `CHANGELOG.md`: Changed and Added entries under `[Unreleased]`;
  - `CLAUDE.md` CI section: Dependabot and the CI-green rule for its PRs;
  - `docs/phases/phase-00-progress.md`: strike the Node 20 follow-up and mark it resolved;
  - `docs/phases/phase-02-progress.md`: row 3b (pending);
  - `changes.md`: the stale-doc check table.

  Run `pnpm exec prettier --write` on the edited docs (AC3). **Check:** `git diff --stat` lists the four docs.
- [x] **T4: Full checks.** Run `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test`. **Check:** all pass (AC4; AC5 is checked on the PR).
