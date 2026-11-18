# Summary Report: p0-design-tokens
Ticket: none   Date: 2026-11-17
Outcome: Clean
Review rounds: 1 of 3 per revision; revisions: 1 of 2
Models: implementor haiku; reviewer sonnet; data agent not used (all chosen by the user); respawns: none

## What was built
Every colour, type, spacing, height and radius token from design-notes §2–4 now lives in `src/shared/tokens.ts` (typed, `as const`) and `src/renderer/styles/tokens.css` (87 custom properties). A unit test keeps the two identical (G1). Inter (400–700) and JetBrains Mono (400, 500) are bundled through @fontsource. No CSP or `index.html` change was needed (G2). A global `base.css` gives the page `bg/app`, `text/primary`, Inter, no margin and one 2px `accent` focus ring, which fixes the shell's unreadable black-on-black text (G3). `Button` (primary, gate, secondary, ghost, danger; 40px and 32px; disabled) and `Chip` (five tones, span or 28px button) have hover and pressed states built with `color-mix`, and tests check their contrast against AA (G4). A gallery page shows every variant, and main opens it only under `pnpm dev` or with `HARNESS_GALLERY=1` (G5). The title bar and main's window background use the tokens, and a unit test fails on any hex colour elsewhere in `src/renderer` or `src/main` (G6). D21 records the choices.

## Files changed
Product files (group 1):
| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/shared/tokens.ts | created | Typed `as const` token module with every AC1 value; imports nothing, so main and the renderer both use it | T1 |
| src/renderer/styles/tokens.css | created | Every AC1 token as a `:root` custom property; the only renderer file with hex colours | T2 |
| docs/design-notes.md | edited | "Title bar" row group with `titlebar/close-hover` `#C42B1C` (AC3); no other value changed | T2 |
| package.json | edited | `@fontsource/inter` and `@fontsource/jetbrains-mono` (^5.3.0) as devDependencies | T3 |
| pnpm-lock.yaml | edited | Lockfile update for the two font packages | T3 |
| src/renderer/styles/base.css | created | Box-sizing; html/body margin 0, token colours, Inter; mono for code; global `:focus-visible` ring (AC5) | T3 |
| src/renderer/main.tsx | edited | Imports the font weights (Latin), then `tokens.css` and `base.css` (AC4) | T3 |
| src/renderer/components/Button.tsx | created | Real `button`, `type="button"` by default, `variant` and `size` props (AC6) | T4 |
| src/renderer/components/Button.css | created | Variants, 94% white/black hover and pressed mixes, disabled state, all from tokens (AC6) | T4 |
| src/renderer/components/Chip.tsx | created | `span` without `onClick`, `button` with it; `tone` prop (AC7) | T4 |
| src/renderer/components/Chip.css | created | Tones, pill radius, 11px text, 28px button height, hover and pressed mixes (AC7) | T4 |
| src/renderer/Gallery.tsx | created | Every Button variant, size and disabled state; every Chip tone as span and button; font samples (AC8) | T5 |
| src/renderer/Gallery.css | created | Gallery layout only, from tokens (AC8) | T5 |
| src/renderer/App.tsx | edited | Renders `TitleBar` and `Gallery` on `#gallery` (AC8) | T5 |
| src/main/index.ts | edited | Appends `#gallery` under dev or `HARNESS_GALLERY=1`; `backgroundColor` from `tokens.ts` (AC8, AC9) | T5, T6 |
| src/renderer/titlebar.css | edited | No local colour variables; uses the tokens and `height-titlebar`; keeps the caption buttons' −2px offset (AC9) | T6 |
| tests/unit/tokens.test.ts | created | AC1 values, CSS parity (87, both ways), hex scan, WCAG contrast incl. hover and pressed mixes (AC10) | T7 |
| tests/e2e/design-tokens.spec.ts | created | Shell body colours and contrast, gallery items, fonts (`document.fonts` and `requestfinished` under out/renderer), focus ring, hover (AC11) | T8, revision 1 |
| docs/decisions.md | edited | D21 "Design tokens and bundled fonts" (AC13); appended with a shell heredoc, not the edit tool | T9 |

Workflow files (group 2):
| File | Action | What and why | Task |
| --- | --- | --- | --- |
| docs/specs/p0-design-tokens/PLAN.md | created | Approved plan | plan |
| docs/specs/p0-design-tokens/SPECS.md | created | Approved spec, revision 1 (sha256 3585b539…) | plan, revision 1 |
| docs/specs/p0-design-tokens/SUBTASK.md | created | Child-ticket draft (no tracker) | plan |
| docs/specs/p0-design-tokens/tasks.md | created | T1–T9, all ticked; T8 marked revised in revision 1 | T1–T9 |
| docs/specs/p0-design-tokens/build-ledger.md | created | Build ledger | build |
| docs/specs/p0-design-tokens/changes.md | created | Implementor's change notes | build |
| docs/specs/p0-design-tokens/SUMMARY.md | created | This report | build |

Git and `changes.md` agree: every file git shows is listed, and every listed file appears in git.

## Acceptance criteria
| AC | Status | Evidence |
| --- | --- | --- |
| AC1 | Met | tokens.ts, `as const`, no imports; the reviewer checked every value against the spec list |
| AC2 | Met | tokens.css has 87 properties; the parity test checks names and values both ways |
| AC3 | Met | design-notes §2 "Title bar" group; no other value changed in the diff |
| AC4 | Met | @fontsource caret + lockfile (revision 1); 6 woff2 in out/renderer/assets; index.html and CSP unchanged |
| AC5 | Met | base.css rules as listed; e2e checks body colours, margin and font |
| AC6 | Met | Button variants, sizes, mixes, disabled with `:not(:disabled)` guards |
| AC7 | Met | Chip span/button, 28px, tones mapped to tokens |
| AC8 | Met | Gallery sections; `showGallery` = dev URL or `HARNESS_GALLERY === '1'`; guards ignore fragments |
| AC9 | Met | titlebar.css has no custom properties; main uses `tokens.color['bg/titlebar']`; window-chrome e2e passes |
| AC10 | Met | tokens.test.ts; `pnpm test` 80 passed |
| AC11 | Met | design-tokens.spec.ts; `pnpm e2e` 14 passed, 1 skipped (macOS only) |
| AC12 | Met | typecheck, lint, format:check, test, e2e, build pass (implementor's run, Windows) |
| AC13 | Met | D21 covers layout, @fontsource, gallery flag, close-hover token, with alternatives |

## Needs a runtime check
- The look of the gallery and the shell in `pnpm dev` (`pnpm dev` opens the gallery automatically): the colours, fonts and hover feel. The tests check computed values, not appearance.
- The test results are the implementor's run; the reviewer did not re-run them.
- macOS and Linux runs come with `p0-ci`.

## Review ledger
### Revision 1, round 1  (PASS)
| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| (none) | | | | | |

No review ran in revision 0: the build paused on the spec problem before the first review.

## Spec revisions
- **Revision 1:** AC11's font-origin check used `performance.getEntriesByType('resource')`. That API records nothing for the built app's `file://` fonts, so the check could not pass. The user chose to revise the spec: the check now uses Playwright `requestfinished` events filtered to `.woff2` under `out/renderer`. In the same revision, AC4's "pinned" became caret ranges in `package.json` plus the exact versions in the lockfile, and @fontsource's `.woff` fallbacks (about 230 KB) are kept.

## Rejected findings
none

## Open issues
- The first e2e run after the font change had one unrelated crash at launch, in the untouched smoke test (worker exit code 3221226505). The rerun passed and no code changed. If it recurs, especially in CI, investigate it separately.
- D21 was appended with a shell heredoc instead of the edit tool. The content is the intended text.
- CHANGELOG.md is updated after the merge, not in this commit.

## Git state
Branch `feature/p0-design-tokens`; approved; committed and pushed in the commit that adds this report.

## Next steps
Approve, commit and push; or request changes; or not yet.
