# Plan: p0-ci-linux-wm

Ticket: (none; vibe planning from the p0-ci-linux-wm brief)
Status: approved
Date: 2026-11-18

## Objective

Make the Ubuntu e2e job on PR #5 pass. `xvfb-run` starts a bare X server with no window manager, and on X11 the window manager carries out maximize, so `BrowserWindow.maximize()` does nothing there. The test "Minimize, Maximize, Restore and Close drive the window" (`tests/e2e/window-chrome.spec.ts:181`) times out waiting for `maximized = true`, and the package step never runs. Running a small window manager under the virtual display gives the Linux job the same window behaviour a Linux desktop has, without changing the test or the app.

## Scope

- **In:**
  - `.github/workflows/ci.yml`, Linux e2e only: install fluxbox (and `x11-utils` for `xprop`) with apt, and run the tests inside `xvfb-run -a` through a shell that starts fluxbox and waits until it is running;
  - the CLAUDE.md CI subsection: what the Linux job runs and how to reproduce it locally;
  - an amendment to D22 in `docs/decisions.md`.
- **Out:**
  - changes to the test, the app, or the Windows and macOS steps;
  - skipping the Maximize test on Linux;
  - the AppArmor step and the no-`--no-sandbox` rule stay as they are.

## Decisions

| Question                    | Decision                                                                                                                                                          | Alternatives considered                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Feature slug and branch     | `p0-ci-linux-wm`, on the existing `feature/p0-ci` (PR #5); no new branch                                                                                          | a new branch and PR (rejected in the brief)                                                  |
| Fix                         | Run a window manager in Linux CI; the test stays unchanged                                                                                                        | skip the test on Linux; poll differently in the test                                         |
| Window manager              | fluxbox                                                                                                                                                           | openbox; xfwm4 (heavier, pulls in Xfce libraries)                                            |
| Startup                     | Keep `xvfb-run -a`; inside it, a shell starts fluxbox in the background, waits up to about 10 s until `xprop -root _NET_SUPPORTING_WM_CHECK` shows a WM, then runs `pnpm e2e` | an explicit `Xvfb :99` with `DISPLAY=:99`; a fixed `sleep 2` (can race on a slow runner)       |
| D22                         | Amend D22: the window manager in the Outcome's Linux sentence, the alternatives in Why, and a dated amendment note                                                | a new D23                                                                                    |
| Where the wrapper lives     | Inline in the `ci.yml` step (default; the brief limits the change to `ci.yml`), with the same command shown in CLAUDE.md                                           | a script under `scripts/`                                                                     |

## Approach

1. In `ci.yml`, add a Linux-only step before the tests: `sudo apt-get update` and `sudo apt-get install -y --no-install-recommends fluxbox x11-utils`.
2. Replace the Linux test command `xvfb-run -a pnpm e2e` with `xvfb-run -a bash -c '…'`, where the script starts `fluxbox` in the background (output discarded), polls `xprop -root _NET_SUPPORTING_WM_CHECK` until it reports a window id or about 10 s pass (then fails with a clear message), and runs `pnpm e2e`. Keep the step name saying it runs under a virtual display with a window manager. The AppArmor step stays first.
3. Leave the Windows and macOS steps, the package step and the failure upload unchanged.
4. Update the CLAUDE.md CI subsection: the Linux job installs fluxbox and runs it under `xvfb-run`; the local reproduction line for Linux becomes the same command (with the apt install noted).
5. Amend D22: Outcome names fluxbox under `xvfb-run`; Why gives the reason (maximize needs a window manager on X11) and the alternatives not taken (skipping the test on Linux, no window manager, openbox, xfwm4); add an amendment line dated 2026-11-18.
6. Run the local checks on Windows, run `pnpm format`, and check that `ci.yml` parses.

## Verified assumptions

| Assumption                                                         | Evidence                                                                                          |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Linux e2e runs `xvfb-run -a pnpm e2e` after the AppArmor step      | `.github/workflows/ci.yml`, steps "Allow unprivileged user namespaces…" and "E2E tests (Linux…)"  |
| Windows and macOS use a separate `pnpm e2e` step                   | `.github/workflows/ci.yml`, step "E2E tests" with `if: runner.os != 'Linux'`                      |
| The failing assertion waits for `maximized` to be true             | `tests/e2e/window-chrome.spec.ts:181`                                                             |
| The failure is Linux-only; Windows and macOS e2e passed on PR #5   | PR #5 checks after commit `818fb29`                                                               |
| D22 describes the Linux step as the AppArmor sysctl plus `xvfb-run` | `docs/decisions.md:131`                                                                           |
| The branch is clean and up to date                                  | `git status` clean; `git pull --ff-only` "Already up to date"                                     |

## Risks

- fluxbox may not report `_NET_SUPPORTING_WM_CHECK` quickly, or at all: the wait would time out with a clear message on the first PR run, and the fix is a longer wait or another readiness check.
- Electron on X11 may still not report maximized under fluxbox if the window lacks a maximize hint (frameless window): the first PR run shows it; the fallback is openbox, chosen in a change round.
- Minimize under fluxbox may behave differently from xvfb alone (it worked without a WM because the test's later steps never ran); the PR run covers it.
- `apt-get update` adds time and can fail on a mirror outage; it reruns cleanly.

## Open questions

none
