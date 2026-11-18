// Design tokens from docs/design-notes.md §2–4. The single source for colours, type,
// spacing, heights and radii in TypeScript. src/renderer/styles/tokens.css repeats them as
// custom properties, and tests/unit/tokens.test.ts keeps the two equal. This file imports
// nothing, so main and the renderer can both use it.
//
// Keys are the design-notes names. The CSS custom property is the key with `/` replaced by
// `-`, prefixed by its group: colour keys already carry their prefix (`bg/app` is `--bg-app`),
// and the other groups add one (`size/body` is `--size-body`).

export const tokens = {
  /** Colours. Keys carry their own prefix: `bg/app` becomes `--bg-app`. */
  color: {
    'bg/titlebar': '#0B0D10',
    'bg/app': '#0E1014',
    'bg/rail': '#111317',
    'bg/surface': '#14171C',
    'bg/raised': '#161A20',
    'bg/chip': '#1A1E24',

    'border/subtle': '#23272E',
    'border/control': '#2A2F37',
    'border/strong': '#2F3540',

    'text/primary': '#E8EAED',
    'text/secondary': '#C9CED6',
    'text/muted': '#A0A8B3',
    'text/faint': '#8B939E',

    accent: '#6EA8FE',
    'accent/on': '#0B1220',
    'accent/selected': '#22324D',
    'accent/selected-text': '#CFE0FF',
    'accent/soft': '#1A2333',
    'accent/soft-text': '#9CC2FF',
    'accent/active-card': '#121822',
    'accent/active-card-alt': '#131B28',
    'accent/active-card-border': '#2B3E5E',
    link: '#8AB8FF',
    'link/hover': '#B3D0FF',

    'amber/strong': '#F0A247',
    'amber/text': '#F5B862',
    'amber/chip': '#3A2A12',
    'amber/panel': '#17130D',
    'amber/panel-border': '#5A4120',
    'amber/inner': '#1E1912',
    'amber/muted-text': '#C9B48E',
    'amber/on': '#1A1206',

    'green/strong': '#4CC38A',
    'green/text': '#6FD6A0',
    'green/chip': '#16291F',
    'green/panel': '#11201A',
    'green/panel-border': '#2E5A44',
    'green/step-dot': '#3E7E5E',

    'red/strong': '#F2767A',
    'red/text': '#F59A9D',
    'red/chip': '#3A1A1C',
    'red/panel': '#1A1012',
    'red/panel-border': '#5A2A2C',

    'titlebar/close-hover': '#C42B1C',
    'titlebar/close-hover-on': '#FFFFFF',
  },

  /** Font families. CSS: `--font-ui`, `--font-mono`. */
  font: {
    ui: "'Inter', system-ui, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, monospace",
  },

  /** Type sizes in px. CSS: `--size-body` and so on. */
  size: {
    'page-title': 20,
    'feature-title': 17,
    'section-title': 15,
    body: 14,
    control: 13,
    meta: 12,
    label: 11,
  },

  /** Font weights. CSS: `--weight-regular` and so on. */
  weight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },

  /** Unitless line heights. CSS: `--line-height-body`. */
  lineHeight: {
    body: 1.55,
    log: 1.6,
  },

  /** Letter spacing in em. CSS: `--letter-spacing-label`. */
  letterSpacing: {
    label: '0.06em',
  },

  /** Spacing scale in px. CSS: `--space-2` and so on. */
  space: {
    2: 2,
    4: 4,
    6: 6,
    8: 8,
    10: 10,
    12: 12,
    14: 14,
    16: 16,
    18: 18,
    22: 22,
    24: 24,
    28: 28,
    32: 32,
  },

  /** Heights in px. CSS: `--height-titlebar` and so on. */
  height: {
    titlebar: 40,
    button: 40,
    'button-small': 32,
    'chip-button': 28,
    input: 40,
    'list-item-min': 44,
    'target-min': 44,
    'rail-target': 48,
  },

  /** Corner radii in px. CSS: `--radius-chip` and so on. */
  radius: {
    chip: 6,
    control: 8,
    card: 10,
    panel: 12,
    pill: 999,
  },
} as const;

export type Tokens = typeof tokens;
