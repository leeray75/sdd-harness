# Design tokens, bundled fonts, Button and Chip with a gallery

**Parent:** none: no parent chosen
**Spec:** docs/specs/p0-design-tokens/SPECS.md
**Repo and base branch:** sdd-harness, main, feature branch feature/p0-design-tokens

## Context

The design system in design-notes §2–4 exists only as prose. The title bar has local colour variables, main sets the window background as a literal, and the empty shell shows unreadable black-on-black text. This work adds every token as a typed TS module and a CSS file, kept equal by tests. It bundles Inter and JetBrains Mono through @fontsource with no CSP change, and adds readable base styles. It adds Button and Chip components with hover, focus and pressed states that meet AA, and a gallery shown only under dev or `HARNESS_GALLERY=1`. Finally, it moves the title bar and main onto the tokens (D21).

## Required work

- T1 Token module
- T2 CSS tokens and design notes
- T3 Fonts and base styles
- T4 Button and Chip
- T5 Gallery
- T6 Title bar and main on tokens
- T7 Unit tests
- T8 e2e tests
- T9 Decision and repo checks

## Acceptance criteria

- **AC1:** `src/shared/tokens.ts` exports every colour, type, spacing, height and radius token from design-notes §2–4 with the exact values listed in the spec, plus `amber/on` and the `titlebar/close-hover` pair.
- **AC2:** `src/renderer/styles/tokens.css` declares the same tokens on `:root`. It is the only file under `src/renderer` with hex colours.
- **AC3:** design-notes §2 gains `titlebar/close-hover` `#C42B1C` with white text; nothing else changes.
- **AC4:** The @fontsource packages are pinned. Only Inter 400–700 and JetBrains Mono 400 and 500 are imported, and the woff2 files are bundled. `index.html` and the CSP are unchanged.
- **AC5:** `base.css` sets box-sizing, `html`/`body` margin 0 with `bg/app`, `text/primary`, Inter, body size and line height, mono for code, and a 2px `accent` focus ring with a 2px offset.
- **AC6:** `Button` is a real `button` with the variants primary, gate, secondary, ghost and danger, sizes 40px and 32px, and a disabled state. Hover is a 6% white mix or `bg/chip`; pressed is a 6% black mix or `bg/raised`.
- **AC7:** `Chip` is a pill with the tones neutral, accent, amber, green and red. It renders a `span`, or a 28px `button` when it has `onClick`.
- **AC8:** The gallery shows every variant, size, disabled state, Chip tone and font weight. Main loads `#gallery` only under dev or `HARNESS_GALLERY=1`.
- **AC9:** The title bar uses the tokens and the global focus ring; main's `backgroundColor` comes from `tokens.ts`. The window-chrome e2e tests still pass.
- **AC10:** Unit tests cover the values, CSS parity, the hex scan of `src/renderer` and `src/main`, and AA contrast for every Button and Chip pair (including hover and pressed) and for the base text.
- **AC11:** e2e tests cover the shell body colours and contrast, every gallery item, fonts loaded from bundled files, the focus ring and the hover change.
- **AC12:** typecheck, lint, format:check, test, e2e and build pass.
- **AC13:** D21 records the token layout, @fontsource, the gallery flag and the close-hover token.

## Out of scope

- Screens, sidebar, icon rail, Next bar, and the other §6 components.
- A light theme or theme switching.
- Spinners or loading states inside buttons.
- CI and macOS or Linux runs (`p0-ci`).

## Links

- Plan: docs/specs/p0-design-tokens/PLAN.md
- Spec and tasks: docs/specs/p0-design-tokens/SPECS.md, docs/specs/p0-design-tokens/tasks.md
