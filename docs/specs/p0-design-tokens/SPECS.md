---
status: done
ticket:
---

# p0-design-tokens

## Problem

The design system in design-notes §2–4 exists only as prose, so every screen would have to copy hex values by hand. The title bar carries its own local colour variables, and main sets the window background as a literal. The renderer has no base styles, so the empty shell shows the browser's default black serif text on the dark window: it is unreadable. The fonts the designs name are not bundled, and there are no shared Button or Chip components for later screens to build on.

## Goals

- **G1:** One source of truth for the tokens. Every colour, type, spacing, height and radius token from design-notes §2–4 lives in `src/shared/tokens.ts` (typed) and `src/renderer/styles/tokens.css` (custom properties), and tests keep the two identical.
- **G2:** Inter and JetBrains Mono bundled with the app through @fontsource, with no runtime download and no CSP change (D21).
- **G3:** Readable global base styles: `html`/`body` use `bg/app`, `text/primary` and Inter, with no default margin, plus one global focus ring.
- **G4:** `Button` (primary, gate, secondary, ghost, danger; default and small; disabled) and `Chip` (neutral, accent, amber, green, red) components with the hover, focus and pressed states of §6 and §9, meeting WCAG AA.
- **G5:** A gallery page with every variant, shown only under `pnpm dev` or with `HARNESS_GALLERY=1`.
- **G6:** The title bar and main's window background use the tokens, and no ad-hoc hex colour remains in `src/renderer` or `src/main`.

## Non-goals

- Screens, sidebar, icon rail, Next bar, and the other §6 components (lists, cards, chat blocks, forms, icons).
- A light theme or theme switching.
- Spinners or loading states inside buttons.
- CI and running the tests on macOS or Linux (`p0-ci`).

## Acceptance criteria

- **AC1 — TS token module.** `src/shared/tokens.ts` imports nothing and exports a `tokens` object, typed `as const`, with exactly these values. Names are the design-notes names. CSS names replace `/` with `-` and prefix the group shown.
  - **Surfaces** (`--bg-*`):
    - `bg/titlebar` `#0B0D10`
    - `bg/app` `#0E1014`
    - `bg/rail` `#111317`
    - `bg/surface` `#14171C`
    - `bg/raised` `#161A20`
    - `bg/chip` `#1A1E24`
  - **Borders** (`--border-*`):
    - `border/subtle` `#23272E`
    - `border/control` `#2A2F37`
    - `border/strong` `#2F3540`
  - **Text** (`--text-*`):
    - `text/primary` `#E8EAED`
    - `text/secondary` `#C9CED6`
    - `text/muted` `#A0A8B3`
    - `text/faint` `#8B939E`
  - **Accent:**
    - `accent` `#6EA8FE`
    - `accent/on` `#0B1220`
    - `accent/selected` `#22324D`
    - `accent/selected-text` `#CFE0FF`
    - `accent/soft` `#1A2333`
    - `accent/soft-text` `#9CC2FF`
    - `accent/active-card` `#121822`
    - `accent/active-card-alt` `#131B28`
    - `accent/active-card-border` `#2B3E5E`
    - `link` `#8AB8FF`
    - `link/hover` `#B3D0FF`
  - **Amber** (`--amber-*`):
    - `amber/strong` `#F0A247`
    - `amber/text` `#F5B862`
    - `amber/chip` `#3A2A12`
    - `amber/panel` `#17130D`
    - `amber/panel-border` `#5A4120`
    - `amber/inner` `#1E1912`
    - `amber/muted-text` `#C9B48E`
    - `amber/on` `#1A1206` (text on the gate fill)
  - **Green** (`--green-*`):
    - `green/strong` `#4CC38A`
    - `green/text` `#6FD6A0`
    - `green/chip` `#16291F`
    - `green/panel` `#11201A`
    - `green/panel-border` `#2E5A44`
    - `green/step-dot` `#3E7E5E`
  - **Red** (`--red-*`):
    - `red/strong` `#F2767A`
    - `red/text` `#F59A9D`
    - `red/chip` `#3A1A1C`
    - `red/panel` `#1A1012`
    - `red/panel-border` `#5A2A2C`
  - **Title bar:**
    - `titlebar/close-hover` `#C42B1C`
    - `titlebar/close-hover-on` `#FFFFFF`
  - **Fonts:**
    - `font/ui`: `'Inter', system-ui, sans-serif`
    - `font/mono`: `'JetBrains Mono', ui-monospace, monospace`
  - **Type sizes** (px):
    - `size/page-title` 20
    - `size/feature-title` 17
    - `size/section-title` 15
    - `size/body` 14
    - `size/control` 13
    - `size/meta` 12
    - `size/label` 11
  - **Weights:** `regular` 400, `medium` 500, `semibold` 600, `bold` 700.
  - **Line heights:** `body` 1.55, `log` 1.6.
  - **Label letter-spacing:** `0.06em`.
  - **Spacing** (px, `--space-N`): 2, 4, 6, 8, 10, 12, 14, 16, 18, 22, 24, 28, 32.
  - **Heights** (px):
    - `titlebar` 40
    - `button` 40
    - `button-small` 32
    - `chip-button` 28
    - `input` 40
    - `list-item-min` 44
    - `target-min` 44
    - `rail-target` 48
  - **Radii** (px):
    - `chip` 6
    - `control` 8 (buttons, inputs, list items)
    - `card` 10
    - `panel` 12
    - `pill` 999

  Where design-notes gives a range (chip button 26–28, input 38–40, chip radius 5–6, small button 32–34), the value above is the one used.
- **AC2 — CSS tokens.** `src/renderer/styles/tokens.css` declares every AC1 token as a custom property on `:root`, with the same values. Lengths are in `px`, and letter-spacing is in `em`. It is the only file under `src/renderer` that contains hex colours.
- **AC3 — Design notes.** design-notes §2 gains a "Title bar" row group with `titlebar/close-hover` `#C42B1C` and white text: Close button hover, the Windows caption-button convention. No other design-notes value changes.
- **AC4 — Fonts.** `@fontsource/inter` and `@fontsource/jetbrains-mono` are dev dependencies, added with pnpm from Windows: `package.json` uses the repo's caret style, and `pnpm-lock.yaml` pins the exact versions. The `.woff` fallback files that @fontsource's CSS also references may ship alongside the woff2 files.
  - `src/renderer/main.tsx` imports only the weights 400, 500, 600 and 700 of Inter, and 400 and 500 of JetBrains Mono, as Latin-subset CSS files when the package provides them.
  - The built `out/renderer` contains the woff2 files.
  - No URL outside the app is referenced.
  - `index.html` and the CSP strings in `electron.vite.config.ts` are unchanged.
- **AC5 — Base styles.** `src/renderer/styles/base.css`, imported after `tokens.css` in `main.tsx`, sets:
  - `*, *::before, *::after { box-sizing: border-box; }`;
  - `html` and `body` to `margin: 0`, `background: var(--bg-app)`, `color: var(--text-primary)`, `font-family: var(--font-ui)`, `font-size: var(--size-body)` and `line-height: var(--line-height-body)`;
  - `code, kbd, samp, pre` to `var(--font-mono)`;
  - `:focus-visible` to a 2px solid `var(--accent)` outline with a 2px offset.
- **AC6 — Button.** `src/renderer/components/Button.tsx` renders a real `button` with `type="button"` unless a `type` prop is passed. It forwards other button props, and its stylesheet is `Button.css`. Props are `variant` (`primary | gate | secondary | ghost | danger`, default `secondary`) and `size` (`default` 40px tall, `small` 32px). It has an 8px radius, `size/control` (13px) text, and padding from the spacing scale.
  - **Primary:** `accent` fill, `accent/on` text, weight 600.
  - **Gate:** `amber/strong` fill, `amber/on` text, weight 600.
  - **Secondary:** transparent, 1px `border/control`, `text/primary`.
  - **Ghost:** transparent, no border, `text/muted`.
  - **Danger:** transparent, 1px `border/control`, `red/strong` text.
  - **Hover:** filled variants use `color-mix(in srgb, <fill> 94%, white)`; transparent variants gain `bg/chip`.
  - **Pressed** (`:active`): filled variants use `color-mix(in srgb, <fill> 94%, black)`; transparent variants use `bg/raised`.
  - **Disabled:** `bg/chip` fill (transparent for ghost), `text/faint` text, `cursor: not-allowed`, and no hover or pressed change.
  - **Focus:** the global ring from AC5.
- **AC7 — Chip.** `src/renderer/components/Chip.tsx` and `Chip.css`. A pill with the `pill` radius, 11px text at weight 500, and padding from the spacing scale. Prop `tone`, default `neutral`:
  - `neutral`: `bg/chip` with `text/secondary`;
  - `accent`: `accent/soft` with `accent/soft-text`;
  - `amber`: `amber/chip` with `amber/text`;
  - `green`: `green/chip` with `green/text`;
  - `red`: `red/chip` with `red/text`.

  Without `onClick` it renders a `span`. With `onClick` it renders a real `button` (`type="button"`), `chip-button` (28px) tall, with the hover and pressed rules of AC6 for filled variants and the global focus ring.
- **AC8 — Gallery.** `src/renderer/Gallery.tsx` (with `Gallery.css` if needed) shows labelled sections:
  - every Button variant in both sizes, plus one disabled button per variant;
  - every Chip tone, as a span and as a button;
  - an Inter sample at each imported weight, and a JetBrains Mono sample at each imported weight.

  `App.tsx` renders `TitleBar` and the gallery instead of the shell content when `window.location.hash === '#gallery'`. `src/main/index.ts` appends `#gallery` to the URL it loads when `ELECTRON_RENDERER_URL` is set (dev) or `process.env['HARNESS_GALLERY'] === '1'`; otherwise the URL is unchanged. The navigation guards are unchanged.
- **AC9 — Title bar and main.**
  - `src/renderer/titlebar.css` declares no local colour variables and uses the AC2 tokens:
    - `bg-titlebar` for the bar;
    - `border-subtle` for its border;
    - `text-primary` and `text-muted` for text;
    - `accent` for the icon;
    - `bg-chip` for the caption hover;
    - `titlebar-close-hover` and `titlebar-close-hover-on` for the Close hover.
  - Heights use `height-titlebar` where 40px applies.
  - The title bar's own outline rule is removed except the caption buttons' `outline-offset: -2px`.
  - `src/main/index.ts` sets `backgroundColor` from `tokens.color.bg.titlebar` (or the equivalent path in the AC1 module).
  - The existing window-chrome e2e tests still pass.
- **AC10 — Unit tests** (`tests/unit/tokens.test.ts`, plus helpers if needed):
  - every AC1 value is asserted;
  - `tokens.css` is parsed and every custom property equals the TS value, with no extra or missing ones;
  - no file under `src/renderer` other than `styles/tokens.css`, and no file under `src/main`, contains a hex colour (`/#[0-9a-fA-F]{3,8}\b/`);
  - a WCAG contrast helper computes at least 4.5:1 for each Button variant's text on its fill (transparent variants on `bg/app`), and for the AC6 hover and pressed colours computed with the same 6% mix;
  - each Chip tone's text passes 4.5:1 on its background;
  - `text/primary` passes 4.5:1 on `bg/app`, and `titlebar/close-hover-on` on `titlebar/close-hover`.
- **AC11 — e2e tests** (`tests/e2e/design-tokens.spec.ts`):
  - **Shell** (no flag): `body`'s computed `background-color` is `bg/app` and `color` is `text/primary`, and their contrast is at least 4.5:1. The computed `font-family` starts with Inter. `body` margin is 0.
  - **Gallery** (`HARNESS_GALLERY=1`): every variant, size, disabled button and Chip tone is present, by role and name.
  - **Fonts:** after `document.fonts.ready`, `document.fonts.check('600 14px Inter')` and `document.fonts.check('400 13px "JetBrains Mono"')` are true. Playwright `requestfinished` events, recorded from launch, include at least one Inter and one JetBrains Mono `.woff2` request whose URL is a `file://` path inside the app's `out/renderer` folder, and no font request goes to any other location.
  - **Focus:** keyboard focus on a Button and on a button Chip shows a 2px outline in the `accent` colour.
  - **Hover:** hovering a primary button changes its computed background colour.
- **AC12 — Checks.** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` and `pnpm e2e` pass. `pnpm build` passes.
- **AC13 — Decision.** `docs/decisions.md` gains D21, "Design tokens and bundled fonts", covering:
  - the token files' layout (`src/shared/tokens.ts` plus `src/renderer/styles/tokens.css`, kept equal by a test);
  - fonts via @fontsource (the rejected alternative is woff2 files committed by hand);
  - the gallery's dev or `HARNESS_GALLERY` flag (the rejected alternative is dev server only);
  - the `titlebar/close-hover` token.

## Open questions

- 2026-11-17, revision 1: AC11's font-origin check used `performance.getEntriesByType('resource')`, which records nothing for the built app's `file://` fonts. Decided: Playwright `requestfinished` events filtered to `.woff2` under `out/renderer`.
- 2026-11-17, revision 1: AC4's "pinned" clarified: caret ranges in `package.json`, exact versions in the lockfile. Decided: keep @fontsource's `.woff` fallbacks (about 230 KB) rather than write our own @font-face rules.
