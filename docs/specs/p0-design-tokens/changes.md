# Changes: p0-design-tokens

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/shared/tokens.ts | created | Typed `as const` token module with every AC1 value; imports nothing, so main and the renderer both use it. | T1 |
| src/renderer/styles/tokens.css | created | Every AC1 token as a custom property on `:root`, same values; the only renderer file with hex colours. | T2 |
| docs/design-notes.md | edited | Added the "Title bar" row group with `titlebar/close-hover` `#C42B1C` (AC3). Prettier also realigned the new table's columns. No other value changed. | T2 |
| docs/specs/p0-design-tokens/tasks.md | edited | Ticked every task after its check passed: T1 to T7, then T8 and T9 in revision 1. | T1, T2, T3, T4, T5, T6, T7, T8, T9 |
| package.json | edited | Added `@fontsource/inter` and `@fontsource/jetbrains-mono` (5.3.0) as devDependencies via `pnpm add -D`. | T3 |
| pnpm-lock.yaml | edited | Lockfile update from `pnpm add -D` for the two font packages. | T3 |
| src/renderer/styles/base.css | created | Global base styles: box-sizing, html/body margin 0 and token colours and Inter, mono for code, one global `:focus-visible` ring (AC5). | T3 |
| src/renderer/main.tsx | edited | Imports the Inter 400/500/600/700 and JetBrains Mono 400/500 Latin CSS, then `tokens.css` and `base.css`, before the app (AC4). | T3 |
| src/renderer/components/Button.tsx | created | Button component: real `button`, `type="button"` by default, `variant` and `size` props (AC6). | T4 |
| src/renderer/components/Button.css | created | Button variants, hover and pressed mixes (94% with white or black), disabled state, all from tokens (AC6). | T4 |
| src/renderer/components/Chip.tsx | created | Chip component: `span` without `onClick`, `button` (type="button") with it; `tone` prop (AC7). | T4 |
| src/renderer/components/Chip.css | created | Chip tones, pill radius, 11px text, 28px button height and hover and pressed mixes (AC7). | T4 |
| src/renderer/Gallery.tsx | created | Gallery page with every Button variant in both sizes plus disabled, every Chip tone as span and button, and Inter and JetBrains Mono samples (AC8). | T5 |
| src/renderer/Gallery.css | created | Gallery layout only; colours and type come from tokens (AC8). | T5 |
| src/renderer/App.tsx | edited | Renders `TitleBar` and `Gallery` instead of the shell when `window.location.hash === '#gallery'` (AC8). | T5 |
| src/main/index.ts | edited | Appends `#gallery` to the loaded URL under `ELECTRON_RENDERER_URL` or `HARNESS_GALLERY=1` (T5, AC8). Sets `backgroundColor` from `tokens.color['bg/titlebar']` (T6, AC9). The navigation guards ignore fragments, so they are unchanged. | T5, T6 |
| src/renderer/titlebar.css | edited | Removed the local colour variables and the title bar's own outline rule; uses the AC2 tokens and `height-titlebar`; keeps the caption buttons' `outline-offset: -2px` (AC9). | T6 |
| tests/unit/tokens.test.ts | created | AC1 values asserted literally, tokens.css parity (no extra or missing properties), hex scan of renderer and main files, WCAG contrast for Button, Chip, text and close-hover pairs with the 94% hover and pressed mixes (AC10). | T7 |
| tests/e2e/design-tokens.spec.ts | created | e2e tests for the shell body colours and margin, the gallery's variants and tones, the font check and bundled woff2 loads, focus outline and hover (AC11). Revision 1: the font-origin check uses Playwright `requestfinished` events filtered to woff2 under `out/renderer` (was resource timing, which records nothing for file:// fonts). | T8, revision 1 |
| docs/decisions.md | edited | Added D21 "Design tokens and bundled fonts" with the token file layout, the @fontsource choice and its rejected alternative, the gallery flag and its rejected alternative, and the `titlebar/close-hover` token (AC13). Written with a shell append, not Edit, against the file-change rule; the content is the intended text. | T9 |
