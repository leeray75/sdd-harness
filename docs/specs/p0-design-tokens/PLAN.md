# Plan: Design tokens, bundled fonts, Button and Chip with a gallery

Ticket: none (vibe planning; subtask 4 of Phase 0, docs/phases/phase-00-scaffold.md)
Status: approved
Date: 2026-11-17

## Objective

Turn design-notes §2–4 into code. All colour, type, spacing, height and radius tokens go into one CSS file of custom properties and one typed TS module, and the two must not drift. Inter and JetBrains Mono are bundled with the app, with no CDN and an unchanged CSP. Button (primary, gate, secondary, ghost, danger) and Chip components get the hover, focus and pressed states from §6 and §9. A gallery page shows every variant, reachable only in dev or behind an env flag. The title bar switches from its local variables to the tokens. A global base stylesheet also fixes the empty shell's unreadable black-on-black text.

## Scope

- **In:**
  - `src/renderer/styles/tokens.css`: every token in §2–4 as a CSS custom property, plus the paired text colours the tables name (for example `#CFE0FF` on `accent/selected`, `#1A1206` on the gate fill);
  - `src/shared/tokens.ts`: the same values as typed constants, readable from main and the renderer;
  - a new token `titlebar/close-hover` (`#C42B1C`, white text), added to design-notes §2;
  - `src/renderer/styles/base.css`: `html`/`body` with `bg/app`, `text/primary`, Inter, `margin: 0`, box-sizing, and the global 2px `accent` focus ring with a 2px offset (§9);
  - fonts from `@fontsource/inter` (400, 500, 600, 700) and `@fontsource/jetbrains-mono` (400, 500), imported as CSS so Vite bundles the woff2 files;
  - `Button` component: variants `primary | gate | secondary | ghost | danger`, sizes `default` (40px) and `small` (32px), and disabled. Hover lightens about 6% (or gains `bg/chip` on transparent variants), pressed darkens about 6%, both via `color-mix()` on tokens and no new hex values;
  - `Chip` component: a 999-radius pill at 11–12px with tones `neutral | accent | amber | green | red`, as a `span`, or as a real `button` when it has an `onClick`;
  - a gallery page that shows every Button variant, size and state and every Chip tone. Main loads the app with `#gallery` only under `pnpm dev` or when `HARNESS_GALLERY=1` is set; otherwise the app renders the shell;
  - the title bar uses the tokens and the shared focus ring; `src/main/index.ts` takes `backgroundColor` from `src/shared/tokens.ts`;
  - unit tests:
    - the TS module matches `tokens.css` value for value;
    - the values match design-notes §2–4;
    - no hex colour appears in `src/renderer` outside `tokens.css`;
  - e2e tests:
    - the gallery renders every variant;
    - fonts load from bundled files;
    - buttons and chips have a visible focus ring;
    - the shell's body text and background pass 4.5:1;
  - decision D21.
- **Out:**
  - screens, sidebar, icon rail, Next bar and other components (§6 lists, cards, forms, icons);
  - a light theme;
  - spinners and loading states inside buttons;
  - CI (`p0-ci`).

## Decisions

| Question                        | Decision                                                                                                                                                                                                                     | Alternatives considered                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Feature slug, repo, base branch | `p0-design-tokens`, sdd-harness, base `main`, branch `feature/p0-design-tokens`                                                                                                                                              | (fixed by the phase doc)                                      |
| Tracker                         | None; the spec stays in `docs/specs/`                                                                                                                                                                                        | Ticket story                                                  |
| Gallery access                  | Main appends `#gallery` to the app URL under `pnpm dev` (`ELECTRON_RENDERER_URL` set) or when `HARNESS_GALLERY=1`; the e2e test sets the flag. In a normal build the user can't reach it, because navigation is locked down | Dev server only, which needs a new dev-server e2e setup       |
| Font source                     | `@fontsource/inter` and `@fontsource/jetbrains-mono` as pinned dev dependencies; only the weights in §3 are imported; OFL licence                                                                                           | woff2 files committed by hand                                 |
| Global base styles              | In scope, with an e2e check of the computed body colours and contrast                                                                                                                                                        | Leave the shell unstyled until screens arrive                 |
| Title bar close hover           | New token `titlebar/close-hover` `#C42B1C` with white text, added to design-notes §2                                                                                                                                         | Status red `#F2767A`, which fails AA with white text          |
| Token naming (default)          | CSS: `--bg-titlebar`, `--text-primary`, `--accent-selected`, `--space-8`, `--radius-8`, `--height-button`, and so on; TS: nested `tokens.color.bg.titlebar` etc. `/` in a token name becomes `-` in CSS                     | (convention)                                                  |
| Hover and pressed (default)     | `color-mix(in srgb, <token> 94%, white)` for hover and `… 94%, black` for pressed: no new hex values, supported in Electron 45's Chromium                                                                                    | Precomputed hover and pressed hex tokens                      |
| TS module location (default)    | `src/shared/tokens.ts`, so main can use `bg/titlebar` for `backgroundColor` and the no-ad-hoc-hex rule covers main's one colour too                                                                                          | `src/renderer/tokens.ts`                                      |
| Decision record                 | D21: bundled fonts via @fontsource, the token files' layout and the gallery flag                                                                                                                                             | No new decision                                               |

## Approach

1. **Tokens.** Write `src/shared/tokens.ts` from §2–4 (colours, the status table, type roles, spacing, heights, radii) and `src/renderer/styles/tokens.css` with the same values. Add `titlebar/close-hover` to design-notes §2. A unit test parses `tokens.css` and compares every property with the TS module, and a second one checks the TS values against the hex values listed in the spec (taken from design-notes).
2. **Fonts and base.** Add the two @fontsource packages with `pnpm add -D` from Windows, run under `allowBuilds`; neither has an install script. Import the weight CSS files and `base.css` from `main.tsx`. The CSP already allows `font-src 'self'`, and Vite emits the woff2 files as hashed assets under `out/renderer`.
3. **Components.** `src/renderer/components/Button.tsx` and `Chip.tsx` with one CSS file each. Real `button` elements (`type="button"` by default), the 8px radius, the heights from §4, and focus from the base ring.
4. **Gallery.** `src/renderer/Gallery.tsx` with every variant, both sizes, disabled, and every Chip tone, as a span and as a button. `App.tsx` renders the gallery when `location.hash === '#gallery'`. `src/main/index.ts` appends `#gallery` per the decision above.
5. **Title bar.** Replace the local variables in `titlebar.css` with tokens, and drop the local focus rule in favour of the base ring. Keep the caption buttons' inset offset.
6. **Tests and checks.** Unit tests (token parity, values, a hex scan of `src/renderer` and `src/main`) and `tests/e2e/design-tokens.spec.ts`. Then add D21, run `pnpm format` and the full set of checks.

## Verified assumptions

| Assumption                                                        | Evidence                                                                                                 |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| The CSP allows bundled fonts and only `'self'` styles             | `electron.vite.config.ts` `PROD_CSP`: `font-src 'self'; style-src 'self'`                                |
| The title bar's local variables are the only renderer colours     | `src/renderer/titlebar.css` (7 variables plus `#ffffff`); no hex in `src/renderer/*.tsx`                 |
| Main sets the window background as a hex literal                  | `src/main/index.ts:27` `backgroundColor: '#0B0D10'`                                                      |
| The app URL is built in one place, so `#gallery` is a small change | `src/main/index.ts:10` `appUrl`, loaded at `:53`                                                         |
| e2e tests already pass env flags to the app                       | `tests/e2e/agent-process.spec.ts:14` sets `HARNESS_AGENT_SELFCHECK`                                      |
| The shell has no base styles today                                | `src/renderer/index.html` and `main.tsx` import no stylesheet; only `TitleBar.tsx` imports `titlebar.css` |
| Paired text colours and the gate fill come from the design notes  | design-notes §2 Accent and Status tables; §6 Buttons table (`#F0A247` fill, `#1A1206` text)              |

## Risks

- **`color-mix()` support.** Electron 45 (Chromium 140+) supports it. The e2e test reads the computed hover colour, which shows a failure early.
- **@fontsource adds files Vite must bundle.** If the fonts fail to load, the e2e `document.fonts.check('16px Inter')` check catches it.
- **Native files in `node_modules`.** `pnpm add` must run from Windows, not WSL. The implementor runs it from Git Bash, and the lockfile change is part of the diff.
- **Contrast of hover and pressed states.** Lighter or darker fills shift the contrast. The e2e test checks it for each variant's default state; for hover, the spec requires AA by calculation.

## Open questions

none
