# Summary Report: p0-ci
Ticket: none   Date: 2026-11-18
Outcome: Clean
Review rounds: 1 of 3 per revision; revisions: 0 of 2
Models: implementor haiku; reviewer sonnet; data agent not used (all chosen by the user); respawns: none

## What was built
A GitHub Actions workflow, `.github/workflows/ci.yml`, runs on push to `main`, on pull requests and by hand (G1).
- A `check` job on Ubuntu runs typecheck, lint, format:check and the unit tests.
- An `e2e` job on a Windows, macOS and Linux matrix runs `pnpm e2e`, then an unsigned `electron-builder --dir`.
- On Linux the e2e job relaxes the AppArmor setting and runs the tests under xvfb, and the app keeps its sandbox.

Each job takes Node from `.nvmrc` and pnpm from Corepack, installs from the frozen lockfile and caches the pnpm store (G2). A new macOS-only e2e test checks the traffic-light position and the 78px title-bar padding (G3). Playwright retries twice only in CI, with traces and an HTML report, and a failed e2e job uploads them (G4). CLAUDE.md has a CI subsection, the README suggests `SDD_TEST_CMD="pnpm test"`, and D22 records the choices (G5).

## Files changed
Product files (group 1):
| File | Action | What and why | Task |
| --- | --- | --- | --- |
| .github/workflows/ci.yml | created | `check` job (Linux) and `e2e` job (Windows, macOS, Linux) with toolchain setup, e2e, unsigned `electron-builder --dir`, failure-only report upload (AC1–AC5) | T3 |
| playwright.config.ts | edited | In CI only: `retries: 2`, `trace: 'on-first-retry'`, list plus HTML reporter; local behaviour unchanged (AC6) | T1 |
| tests/e2e/window-chrome.spec.ts | edited | macOS-only test for `getWindowButtonPosition()` = `{ x: 14, y: 13 }` and title-bar `padding-left` = `78px`; `paddingLeft` added to `DomLike`; frameless test's skip reason reworded (AC7) | T2 |
| CLAUDE.md | edited | "CI" subsection under Commands: jobs, local reproduction, Windows-not-WSL note, `SDD_TEST_CMD="pnpm test"` (AC8) | T4 |
| README.md | edited | Line 84 suggests `SDD_TEST_CMD="pnpm test"`, matching CLAUDE.md (AC9) | T4 |
| docs/decisions.md | edited | D22 "Continuous integration", with the alternatives not taken (AC10) | T4 |

Workflow files (group 2):
| File | Action | What and why | Task |
| --- | --- | --- | --- |
| docs/specs/p0-ci/PLAN.md | created | Approved plan | plan |
| docs/specs/p0-ci/SPECS.md | created | Approved spec (sha256 a635edec…) | plan |
| docs/specs/p0-ci/SUBTASK.md | created | Child-ticket draft (no tracker) | plan |
| docs/specs/p0-ci/tasks.md | created | T1–T5, all ticked | T1–T5 |
| docs/specs/p0-ci/build-ledger.md | created | Build ledger | build |
| docs/specs/p0-ci/changes.md | created | Implementor's change notes | build |
| docs/specs/p0-ci/SUMMARY.md | created | This report | build |

Git and `changes.md` agree: every file git shows is listed, and every listed file appears in git. The local `electron-builder --dir` run wrote `release/`, which git ignores.

## Acceptance criteria
| AC | Status | Evidence |
| --- | --- | --- |
| AC1 | Met | Three triggers, `contents: read`, `ci-${{ github.ref }}` with `cancel-in-progress` only for pull requests, actions pinned @v4 (reviewer) |
| AC2 | Met | checkout → `corepack enable` → setup-node (`.nvmrc`, `cache: pnpm`) → `pnpm install --frozen-lockfile` in both jobs |
| AC3 | Met | `check` on ubuntu-latest with four named steps |
| AC4 | Met | `fail-fast: false` matrix; Linux-only sysctl and `xvfb-run -a pnpm e2e`; package step with `CSC_IDENTITY_AUTO_DISCOVERY: 'false'`; no build artifact uploaded |
| AC5 | Met | `if: failure()`, per-OS name, both paths, `if-no-files-found: ignore` |
| AC6 | Met | CI and non-CI branches as specified; `pnpm e2e` without CI used `list`, no retries |
| AC7 | Met | darwin-only test with `getWindowButtonPosition()` and computed `padding-left`; skipped on Windows |
| AC8 | Met | CLAUDE.md CI subsection |
| AC9 | Met | README.md:84 |
| AC10 | Met | D22 in docs/decisions.md |
| AC11 | Met | typecheck, lint, format:check pass; test 80 passed; e2e 14 passed, 2 skipped; ci.yml parses (Prettier, PyYAML); actionlint not installed, skipped |
| AC12 | Pending | Checked after approval, from the pull request's checks |

## Needs a runtime check
These are all answered by the first PR run (AC12):
- Corepack with the `pnpm@12.21.0` pin, and setup-node's `cache: pnpm` after `corepack enable`, on all three runners.
- Whether Ubuntu 24.04 needs more than the AppArmor sysctl for Electron under xvfb.
- Whether `getWindowButtonPosition()` returns exactly `{ x: 14, y: 13 }` on the macOS runner.
- Whether `electron-builder --dir` completes on macOS and Linux without extra config (icons, Linux maintainer/author metadata).
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
- AC12 is not yet verified; it needs the pushed branch and a PR. A red job gets a change round before merge.
- `actionlint` was not available, so the workflow had no lint beyond the YAML parse and the reviewer's read.
- CHANGELOG.md is updated after the merge, not in this commit.

## Git state
Branch `feature/p0-ci`; approved; committed and pushed in the commit that adds this report.

## Next steps
Approve, commit and push; then open the PR and check AC12 from its checks. Or request changes; or not yet.
