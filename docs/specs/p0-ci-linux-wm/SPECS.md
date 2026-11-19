---
status: approved
ticket:
---

# p0-ci-linux-wm

## Problem

The Ubuntu e2e job on PR #5 fails. `xvfb-run` starts a bare X server with no window manager, and on X11 the window manager carries out maximize, so `BrowserWindow.maximize()` does nothing. The test "Minimize, Maximize, Restore and Close drive the window" (`tests/e2e/window-chrome.spec.ts:181`) times out waiting for `maximized = true` on every retry, and the package step never runs. The app is not at fault: the CI display lacks what every Linux desktop has.

## Goals

- **G1:** The Linux e2e job runs a window manager (fluxbox) under the virtual display, started reliably before the tests, so maximize, restore and minimize work as on a Linux desktop.
- **G2:** Nothing else in CI changes: the Windows and macOS steps, the AppArmor step, the package step and the failure upload stay as they are, and the app keeps its sandbox.
- **G3:** CLAUDE.md and D22 describe the window manager and how to reproduce the Linux job locally.

## Non-goals

- Changing the test, the app, or the Windows and macOS jobs.
- Skipping or weakening the Maximize test on Linux.
- A script file for the wrapper; the command stays inline in `ci.yml`.
- Pushing during the build. The first real run happens after result approval (AC6).

## Acceptance criteria

- **AC1 — Window manager installed (Linux only).** `.github/workflows/ci.yml` has a step in the `e2e` job with `if: runner.os == 'Linux'`, before the Linux test step, that runs `sudo apt-get update` and `sudo apt-get install -y --no-install-recommends fluxbox x11-utils`.
- **AC2 — Tests run under fluxbox.** The Linux test step still uses `xvfb-run -a`, and runs `bash -c` (or an equivalent single shell) that:
  - starts `fluxbox` in the background, with its output discarded or sent to a log that does not fail the step;
  - waits until `xprop -root _NET_SUPPORTING_WM_CHECK` reports a window id, polling for at most about 10 seconds; on timeout it prints a clear message naming fluxbox and exits non-zero, so the tests do not start without a window manager;
  - then runs `pnpm e2e` and exits with its status.

  The step name says the tests run under a virtual display with a window manager.
- **AC3 — Everything else unchanged.** The AppArmor sysctl step stays before the tests and unchanged. Nothing passes `--no-sandbox`. The Windows and macOS `pnpm e2e` step, the package step (with `CSC_IDENTITY_AUTO_DISCOVERY: 'false'`), the failure upload, the `check` job, the triggers, permissions and concurrency are unchanged.
- **AC4 — Docs.**
  - The CLAUDE.md CI subsection says the Linux e2e job installs fluxbox and runs it under `xvfb-run` before `pnpm e2e`, and its local reproduction for Linux shows the apt install and the same `xvfb-run -a bash -c '…'` command (or an equivalent that starts fluxbox first).
  - D22 in `docs/decisions.md` is amended: the Outcome names fluxbox under `xvfb-run` on Linux; the Why says maximize needs a window manager on X11, and gives the alternatives not taken (skipping the test on Linux, no window manager, openbox, xfwm4, a fixed sleep instead of the readiness wait); an amendment line dated 2026-11-18 names p0-ci-linux-wm.
- **AC5 — Local checks.** On Windows, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` and `pnpm e2e` pass. `ci.yml` parses as YAML (Prettier check). If `actionlint` is available it reports no errors; if not, the build notes that it was skipped. If `bash -n` is available, the inline script passes it.
- **AC6 — Green on PR #5 (checked after result approval).** After the approved work is pushed to `feature/p0-ci`, every job on PR #5 is green: `check` and `e2e` on all three OSes, including the Ubuntu Maximize test (passed) and the Ubuntu package step (completed). Any red job gets a change round before merge.

## Open questions

- none
