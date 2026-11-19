# Tasks: p0-ci-linux-wm

Work in order. After each task, run its check, then tick the box. Run `pnpm` only from Windows (Git Bash or PowerShell), never from WSL. Make no git commits or pushes. Stay on `feature/p0-ci`.

- [x] **T1 — Workflow.** In `.github/workflows/ci.yml`, add the Linux-only apt step for `fluxbox` and `x11-utils` (AC1), and change the Linux test step to start fluxbox under `xvfb-run -a`, wait for it with `xprop`, then run `pnpm e2e` (AC2). Change nothing else (AC3). **Check:** `pnpm exec prettier --check .github/workflows/ci.yml` passes; the inline script passes `bash -n` if available; `actionlint` if available, else note it was skipped; `git diff .github/workflows/ci.yml` touches only the Linux steps.
- [x] **T2 — Docs.** Update the CLAUDE.md CI subsection and amend D22 (AC4), then run `pnpm format`. **Check:** `pnpm format:check` passes.
- [x] **T3 — Repo checks.** Run every local check (AC5). **Check:** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` and `pnpm e2e` pass on Windows.

AC6 is checked after result approval, from PR #5's checks; it is not a build task.
