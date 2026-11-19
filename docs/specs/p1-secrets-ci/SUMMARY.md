# Summary Report: p1-secrets-ci
Ticket: none   Date: 2026-11-19
Outcome: Clean
Review rounds: 1 of 3 per revision (in revision 1); revisions: 1 of 2
Models: implementor haiku; reviewer sonnet; data agent not used (all chosen by the user); respawns: none

## What was built

The spike e2e now explains its own failures without printing the sentinel (G1). Each failure message carries the run's output, which is withheld if the sentinel is in it, and the `Authorization` headers are reported only as `missing`, `placeholder`, `sentinel` or `other`. On Linux, the test-only override `HARNESS_ALLOW_WEAK_SECRETS=1` now turns on Electron's plain-text encryption, once per process, before the store's first use, so saving works without a keyring (G2). A CI checkpoint on draft PR #9 showed the remaining failure on Linux and macOS: Playwright launches the app run with `--use-mock-keychain` and `--password-store=basic`, but the seed run was spawned without them, so the two runs encrypted with different keys. The seed run now passes the same switches (G3). The docs match the code (G4); green CI on all three OSes is checked after the commit.

## Files changed
Product files (group 1):
| File | Action | What and why | Task |
| --- | --- | --- | --- |
| tests/e2e/spike-agent.spec.ts | edited | Failure messages carry the run output (withheld when the sentinel is in it); headers reduced to classes; the seed run passes `PLAYWRIGHT_KEYCHAIN_SWITCHES` (`--use-mock-keychain`, `--password-store=basic`) | T1, T5 |
| src/main/secrets/plain-text.ts | created | Pure `shouldUsePlainTextEncryption(platform, overrideValue)`: true only on `linux` with `'1'` | T2 |
| src/main/secrets/electron.ts | edited | `createElectronSecretStore` calls `safeStorage.setUsePlainTextEncryption(true)` once per process when the function says so | T2 |
| tests/unit/secret-plain-text.test.ts | created | linux, darwin, win32 with the override on and off, plus `''` and `'0'` | T2 |
| CHANGELOG.md | edited | `[Unreleased]` Fixed: Linux plain-text switch, spike e2e diagnostics, seed switches | T3, T6 |
| docs/decisions.md | edited | D25: on Linux the override also turns on plain-text encryption, once per process | T3 |
| docs/phases/phase-01-progress.md | edited | Follow-ups: the two fixes; the e2e uses Playwright's mock keychain, so the real macOS keychain is a runtime check | T6 |

Workflow files (group 2: PLAN.md, SPECS.md, SUBTASK.md, tasks.md, build-ledger.md, changes.md, this report):
| File | Action | What and why | Task |
| --- | --- | --- | --- |
| docs/specs/p1-secrets-ci/PLAN.md | created | Approved plan | planning |
| docs/specs/p1-secrets-ci/SPECS.md | created | Approved spec, revised once (AC5, revision 1) | planning, revision 1 |
| docs/specs/p1-secrets-ci/SUBTASK.md | created | Child-ticket draft (not published; tracker none) | planning |
| docs/specs/p1-secrets-ci/tasks.md | created | T1–T7 ticked (T5 revised in revision 1; T7's CI half checked after the commit) | all |
| docs/specs/p1-secrets-ci/build-ledger.md | created | Build ledger | workflow |
| docs/specs/p1-secrets-ci/changes.md | created | Implementor's change notes | workflow |
| docs/specs/p1-secrets-ci/SUMMARY.md | created | This report | workflow |

The T1–T4 work is in the checkpoint commit `a180aca` (pushed, draft PR #9); the rest is uncommitted.

## Acceptance criteria
| AC | Status | Evidence |
| --- | --- | --- |
| AC1 | Met | `outputReport` withholds output containing the sentinel; T1 temporary-failure check showed output and classes, no sentinel |
| AC2 | Met | `classifyAuthorization`; CI run 44468929994 printed `[placeholder, placeholder]` with no values |
| AC3 | Met | `plain-text.ts`, `electron.ts`; unit test; Linux seed succeeded in CI run 44468929994 |
| AC4 | Met | Checkpoint commit `a180aca`, draft PR #9, CI run 44468929994 |
| AC5 | Met locally (revision 1) | `PLAYWRIGHT_KEYCHAIN_SWITCHES`; e2e passes on Windows; macOS and Linux confirmed by CI after the commit |
| AC6 | Met | CHANGELOG, D25, phase follow-ups; README and CLAUDE.md never mention the override (reviewer confirmed) |
| AC7 | Local part met | typecheck, lint, format:check pass; `pnpm test` 246 passed, 2 skipped; `pnpm e2e` 15 passed on Windows. CI on all three OSes is pending the commit |

## Needs a runtime check
- Linux and macOS CI after this commit: the app run must decrypt the seeded key (every header `sentinel`).
- The real macOS keychain is not exercised by the e2e (Playwright's mock keychain is used in both runs).
- `setUsePlainTextEncryption` in the secrets mode runs after app ready; the earlier Linux CI seed already succeeded with it.

## Review ledger
Covers every revision, copied from `docs/specs/p1-secrets-ci/build-ledger.md`.
### Revision 1, round 1  (PASS)
| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| (none) | | | | | |

No review ran in revision 0; the build paused at the planned CI checkpoint before review.

## Spec revisions
- Revision 1: the planned CI checkpoint (AC4) ran on draft PR #9 (run 44468929994). The Linux seed succeeded, but on Linux and macOS the app run could not read the key, because Playwright adds `--use-mock-keychain` and `--password-store=basic` only to the app it launches. The user chose **Revise the spec**: the seed run passes the same switches (AC5, T5). Not chosen: seeding through Playwright's `electron.launch`; stopping the build. Re-approved by the user.

## Rejected findings
none

## Open issues
none. Notes for your judgement:
- Electron prints a deprecation warning for the sync `safeStorage.decryptString`; the async move stays a follow-up.
- `main` stays red until this PR merges with green CI.

## Git state
feature/p1-secrets-ci; approved; committed and pushed in the commit that adds this report (on top of the checkpoint `a180aca`).

## Next steps
Approve, commit and push (CI on PR #9 then has to go green on all three OSes); or request changes; or not yet.
