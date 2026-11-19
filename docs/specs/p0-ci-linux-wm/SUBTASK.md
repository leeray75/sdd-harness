# p0-ci-linux-wm: run a window manager in Linux CI so the Maximize test passes

**Parent:** none: no parent chosen (tracker not set)
**Spec:** docs/specs/p0-ci-linux-wm/SPECS.md
**Repo and base branch:** leeray75/sdd-harness, main; existing branch feature/p0-ci (PR #5)

## Context

The Ubuntu e2e job on PR #5 fails: `xvfb-run` has no window manager, so `BrowserWindow.maximize()` does nothing on X11 and the Maximize test times out; the package step never runs. This work installs fluxbox in the Linux e2e job and starts it under `xvfb-run` with a readiness wait before `pnpm e2e`. The test, the app and the Windows and macOS jobs stay unchanged. CLAUDE.md and D22 are updated.

## Required work

- T1 Workflow.
- T2 Docs.
- T3 Repo checks.

## Acceptance criteria

- **AC1 — Window manager installed (Linux only):** a Linux-only step before the tests runs `sudo apt-get update` and `sudo apt-get install -y --no-install-recommends fluxbox x11-utils`.
- **AC2 — Tests run under fluxbox:** the Linux test step keeps `xvfb-run -a`, starts fluxbox in the background, waits at most about 10 s for `xprop -root _NET_SUPPORTING_WM_CHECK` (fails clearly on timeout), then runs `pnpm e2e` and exits with its status.
- **AC3 — Everything else unchanged:** the AppArmor step, no `--no-sandbox`, the Windows and macOS steps, the package step, the failure upload, the `check` job, triggers, permissions and concurrency.
- **AC4 — Docs:** the CLAUDE.md CI subsection and its Linux local reproduction describe fluxbox; D22 is amended with fluxbox, the reason, the alternatives not taken and a dated amendment line.
- **AC5 — Local checks:** typecheck, lint, format:check, test and e2e pass on Windows; `ci.yml` parses; `bash -n` and `actionlint` if available.
- **AC6 — Green on PR #5 (after result approval):** every job is green, including the Ubuntu Maximize test and the Ubuntu package step.

## Out of scope

- Changing the test, the app, or the Windows and macOS jobs; skipping the test on Linux.
- A separate wrapper script.
- Pushing during the build.

## Links

- Plan: docs/specs/p0-ci-linux-wm/PLAN.md
- Spec and tasks: docs/specs/p0-ci-linux-wm/SPECS.md, docs/specs/p0-ci-linux-wm/tasks.md
- PR: https://github.com/leeray75/sdd-harness/pull/5
