# Summary Report: p0-ci-linux-wm
Ticket: none   Date: 2026-11-18
Outcome: Clean
Review rounds: 1 of 3 per revision; revisions: 0 of 2
Models: implementor haiku; reviewer sonnet; data agent not used (all chosen by the user); respawns: none

## What was built
The Linux e2e job now installs fluxbox and `x11-utils`, and runs the tests inside `xvfb-run -a` through a shell that starts fluxbox, waits up to about 10 s for `xprop -root _NET_SUPPORTING_WM_CHECK` to show a running window manager (failing with a message naming fluxbox otherwise), then runs `pnpm e2e` and exits with its status (G1). The AppArmor step, the Windows and macOS steps, the package step, the failure upload and the rest of the workflow are unchanged, and the app keeps its sandbox (G2). The CLAUDE.md CI subsection and its Linux reproduction describe fluxbox, and D22 is amended with the reason, the alternatives not taken and a dated note (G3).

## Files changed
Product files (group 1):
| File | Action | What and why | Task |
| --- | --- | --- | --- |
| .github/workflows/ci.yml | edited | Linux-only apt step for fluxbox and x11-utils (AC1); Linux test step starts fluxbox under `xvfb-run -a`, waits for it with `xprop`, then runs `pnpm e2e` (AC2); nothing else changed (AC3) | T1 |
| CLAUDE.md | edited | CI subsection: the Linux job runs fluxbox under `xvfb-run`; local Linux reproduction shows the apt install and the fluxbox-first command (AC4) | T2 |
| docs/decisions.md | edited | D22 amended: fluxbox in the Outcome, the window-manager reason and five alternatives in Why, amendment line dated 2026-11-18 naming p0-ci-linux-wm (AC4) | T2 |

Workflow files (group 2):
| File | Action | What and why | Task |
| --- | --- | --- | --- |
| docs/specs/p0-ci-linux-wm/PLAN.md | created | Approved plan | plan |
| docs/specs/p0-ci-linux-wm/SPECS.md | created | Approved spec (sha256 3ca98be4…) | plan |
| docs/specs/p0-ci-linux-wm/SUBTASK.md | created | Child-ticket draft (no tracker) | plan |
| docs/specs/p0-ci-linux-wm/tasks.md | created | T1–T3, all ticked | T1–T3 |
| docs/specs/p0-ci-linux-wm/build-ledger.md | created | Build ledger | build |
| docs/specs/p0-ci-linux-wm/changes.md | created | Implementor's change notes | build |
| docs/specs/p0-ci-linux-wm/SUMMARY.md | created | This report | build |

Git and `changes.md` agree: every file git shows is listed, and every listed file appears in git.

## Acceptance criteria
| AC | Status | Evidence |
| --- | --- | --- |
| AC1 | Met | Linux-only step "Install fluxbox window manager and xprop (Linux)" runs `apt-get update` and `apt-get install -y --no-install-recommends fluxbox x11-utils`, before the Linux test step |
| AC2 | Met | `xvfb-run -a bash -c '…'`: fluxbox backgrounded with output to /dev/null; 20 × 0.5 s poll for `window id #` from `xprop`; on timeout a stderr message naming fluxbox and `exit 1`; `pnpm e2e` last, so its status is the step's |
| AC3 | Met | `git diff` of ci.yml shows only the replaced Linux test step and the new apt step (reviewer confirmed) |
| AC4 | Met | CLAUDE.md CI subsection and Linux reproduction; D22 Outcome, Why (skip, no WM, openbox, xfwm4, fixed sleep) and amendment line |
| AC5 | Met | typecheck, lint, format:check pass; test 80 passed; e2e 14 passed, 2 skipped; ci.yml Prettier check passes; `bash -n` on the inline script passes; actionlint not installed, skipped |
| AC6 | Pending | Checked after approval, from PR #5's checks |

## Needs a runtime check
- Whether fluxbox under Xvfb on the Ubuntu runner makes `BrowserWindow.maximize()` work. Only the PR #5 run (AC6) can confirm it; the planned fallback is openbox in a change round.
- The CLAUDE.md local Linux one-liner does not exit on a timeout; it is a local convenience and the spec allows an equivalent form.
- The test results are the implementor's Windows run; the reviewer did not re-run them.

## Review ledger
### Revision 0, round 1  (PASS)
| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| (none) | | | | | |

## Spec revisions
none

## Rejected findings
none

## Open issues
- AC6 is not yet verified; it needs the push to `feature/p0-ci` and PR #5's run. A red job gets a change round before merge.
- `actionlint` was not available, so the workflow had no lint beyond Prettier's YAML parse, `bash -n` and the reviewer's read.

## Git state
Branch `feature/p0-ci`; approved; committed and pushed in the commit that adds this report.

## Next steps
Approve, commit and push; then check AC6 from PR #5's checks. Or request changes; or not yet.
