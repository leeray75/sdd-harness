# Build ledger: p0-design-tokens
state: done
revision: 1
resume on approve: no
current round: 1 of 3, in revision 1
phase: reviewing
Implementor: a8cbfdfda807f7022, haiku    Reviewer: abd54076f49c75e94, sonnet
Data agent: none yet
Models: chosen by the user at the start of the build; reused on resume, not asked again.
Respawns: none

## Implementation (Mode 1)
T1–T7 done and ticked. T8 and T9 unticked: `pnpm e2e` has 1 failure of 15 (the font resource-timing assertion). typecheck, lint, format:check, test (80) and build pass.

## Spec problems
- Revision 0 pause (from the Mode 1 implementation report): AC11 Fonts: "At least one Inter and one JetBrains Mono woff2 resource were loaded from the app's own origin (`performance.getEntriesByType('resource')`)." The built app loads from file://, and Chromium records no resource-timing entries for file:// fonts, so the check cannot pass. Candidate resolutions: (1) Playwright `requestfinished` events filtered to woff2 under out/renderer; (2) CSSOM @font-face src URLs plus `document.fonts` status; (3) a custom app:// scheme (new decision); (4) drop the origin check. User chose: Revise the spec (revision 1): Playwright `requestfinished` check; also AC4 clarified (caret + lockfile, keep .woff fallbacks).

## Carried findings
none (no review has run yet)

## Implementor notes for the user
- D21 was appended with a Bash heredoc; formatter runs used Bash.
- @fontsource CSS also references .woff fallbacks, so out/renderer has .woff files too (~230 KB).
- package.json uses caret ranges (`^5.x`); AC4 says "pinned", and the lockfile pins exact versions.
- No CHANGELOG entry (added after merge, per the project's habit).

## Implementation (Mode 3, revision 1)
T8 and T9 done; all of T1–T9 ticked. typecheck, lint, format:check, test (80), e2e (14 passed, 1 macOS skip) and build pass. One-off: the first e2e run had the untouched smoke test crash at launch (worker exit code 3221226505); the rerun passed, and no code changed for it.

## Revision 1, round 1  (PASS)
| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| (none) | | | | | |

Reviewer: AC1–AC13 traced to the code. The 87 tokens match on both sides, and the parity test asserts the count. The hex scan covers all of src/renderer except styles/tokens.css, and all of src/main. The gallery flag has only the dev and HARNESS_GALLERY=1 triggers, and the guards ignore the fragment. The title bar has no local variables. index.html and the CSP are unchanged.

Needs a runtime check: the Chip button's 28px height and the font origins are covered by the implementor's e2e run; the reviewer did not re-run it.

Loop ended: clean after round 1 of revision 1.
