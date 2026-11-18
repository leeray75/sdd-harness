import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { tokens } from '../../src/shared/tokens';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tokensCssPath = join(root, 'src', 'renderer', 'styles', 'tokens.css');
const tokensTsPath = join(root, 'src', 'shared', 'tokens.ts');

/** Every AC1 value, written out literally from the spec. */
const expected = {
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
  font: {
    ui: "'Inter', system-ui, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, monospace",
  },
  size: {
    'page-title': 20,
    'feature-title': 17,
    'section-title': 15,
    body: 14,
    control: 13,
    meta: 12,
    label: 11,
  },
  weight: { regular: 400, medium: 500, semibold: 600, bold: 700 },
  lineHeight: { body: 1.55, log: 1.6 },
  letterSpacing: { label: '0.06em' },
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
  radius: { chip: 6, control: 8, card: 10, panel: 12, pill: 999 },
};

/** The CSS custom property each token maps to, with the value the CSS must declare. */
function cssPropertiesFromTokens(): Map<string, string> {
  const map = new Map<string, string>();
  for (const [key, value] of Object.entries(tokens.color)) {
    map.set(`--${key.replace('/', '-')}`, value);
  }
  for (const [key, value] of Object.entries(tokens.font)) {
    map.set(`--font-${key}`, value);
  }
  for (const [key, value] of Object.entries(tokens.size)) {
    map.set(`--size-${key}`, `${value}px`);
  }
  for (const [key, value] of Object.entries(tokens.weight)) {
    map.set(`--weight-${key}`, `${value}`);
  }
  for (const [key, value] of Object.entries(tokens.lineHeight)) {
    map.set(`--line-height-${key}`, `${value}`);
  }
  for (const [key, value] of Object.entries(tokens.letterSpacing)) {
    map.set(`--letter-spacing-${key}`, value);
  }
  for (const [key, value] of Object.entries(tokens.space)) {
    map.set(`--space-${key}`, `${value}px`);
  }
  for (const [key, value] of Object.entries(tokens.height)) {
    map.set(`--height-${key}`, `${value}px`);
  }
  for (const [key, value] of Object.entries(tokens.radius)) {
    map.set(`--radius-${key}`, `${value}px`);
  }
  return map;
}

/** Reads the `:root` custom properties from tokens.css, in order. */
function cssPropertiesFromFile(): Array<[string, string]> {
  const css = readFileSync(tokensCssPath, 'utf8');
  const rootBlock = /:root\s*\{([^}]*)\}/.exec(css);
  if (!rootBlock) {
    throw new Error('tokens.css has no :root block');
  }
  return [...rootBlock[1].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [
    `--${m[1]}`,
    m[2].trim(),
  ]);
}

/** Lower-cases hex colours so that #0B0D10 and #0b0d10 compare equal. Other values are kept. */
function normalise(value: string): string {
  return value.startsWith('#') ? value.toLowerCase() : value;
}

/** Every file under a directory, recursively. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

// WCAG 2.2 contrast. Colours are sRGB hex strings.

function channels(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The colour of `color-mix(in srgb, <fill> <weight>%, <other>)` as the CSS engine computes it:
 * a weighted average of the sRGB channels. `other` is 'white' or 'black'.
 */
function colorMix(fill: string, weight: number, other: 'white' | 'black'): string {
  const otherHex = other === 'white' ? '#FFFFFF' : '#000000';
  const a = channels(fill);
  const b = channels(otherHex);
  const hex = a.map((c, i) => Math.round(weight * c + (1 - weight) * b[i]));
  return `#${hex.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** The hover and pressed fills from Button and Chip: 94% of the fill mixed with white or black. */
const HOVER_WEIGHT = 0.94;
const hoverOf = (fill: string) => colorMix(fill, HOVER_WEIGHT, 'white');
const pressedOf = (fill: string) => colorMix(fill, HOVER_WEIGHT, 'black');

const AA = 4.5;

describe('AC1: token values', () => {
  it('match the spec exactly, with no extra or missing tokens', () => {
    expect(tokens).toEqual(expected);
  });

  it('src/shared/tokens.ts imports nothing', () => {
    const source = readFileSync(tokensTsPath, 'utf8');
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\(/);
  });
});

describe('AC2: tokens.css matches the TypeScript module', () => {
  const fromTs = cssPropertiesFromTokens();
  const declared = cssPropertiesFromFile();
  const fromCss = new Map(declared);

  it('declares each property once', () => {
    expect(fromCss.size).toBe(declared.length);
  });

  it('has exactly the properties the tokens produce, no more and no less', () => {
    expect([...fromCss.keys()].sort()).toEqual([...fromTs.keys()].sort());
  });

  it('gives every property the same value as the TypeScript token', () => {
    for (const [name, value] of fromTs) {
      expect(normalise(fromCss.get(name) ?? ''), name).toBe(normalise(value));
    }
  });

  it('declares 87 properties, the count AC1 implies', () => {
    expect(fromTs.size).toBe(87);
  });
});

describe('AC10: no hex colours outside the token file', () => {
  const hex = /#[0-9a-fA-F]{3,8}\b/;
  const renderer = join(root, 'src', 'renderer');
  const main = join(root, 'src', 'main');
  const rendererFiles = filesUnder(renderer).filter(
    (file) => resolve(file) !== resolve(tokensCssPath),
  );
  const mainFiles = filesUnder(main);

  it('finds files to scan under src/renderer and src/main', () => {
    expect(rendererFiles.length).toBeGreaterThan(0);
    expect(mainFiles.length).toBeGreaterThan(0);
  });

  it.each(rendererFiles.map((file) => [file.slice(root.length + 1), file]))(
    'renderer file %s has no hex colour',
    (_name, file) => {
      expect(readFileSync(file, 'utf8')).not.toMatch(hex);
    },
  );

  it.each(mainFiles.map((file) => [file.slice(root.length + 1), file]))(
    'main file %s has no hex colour',
    (_name, file) => {
      expect(readFileSync(file, 'utf8')).not.toMatch(hex);
    },
  );
});

describe('AC10: contrast', () => {
  const c = tokens.color;

  describe('Button text on its fill (WCAG AA, 4.5:1)', () => {
    it('primary: accent/on on accent, at rest, hover and pressed', () => {
      expect(contrast(c['accent/on'], c.accent)).toBeGreaterThanOrEqual(AA);
      expect(contrast(c['accent/on'], hoverOf(c.accent))).toBeGreaterThanOrEqual(AA);
      expect(contrast(c['accent/on'], pressedOf(c.accent))).toBeGreaterThanOrEqual(AA);
    });

    it('gate: amber/on on amber/strong, at rest, hover and pressed', () => {
      expect(contrast(c['amber/on'], c['amber/strong'])).toBeGreaterThanOrEqual(AA);
      expect(contrast(c['amber/on'], hoverOf(c['amber/strong']))).toBeGreaterThanOrEqual(AA);
      expect(contrast(c['amber/on'], pressedOf(c['amber/strong']))).toBeGreaterThanOrEqual(AA);
    });

    it('secondary: text/primary on bg/app, and on the bg/chip hover fill', () => {
      expect(contrast(c['text/primary'], c['bg/app'])).toBeGreaterThanOrEqual(AA);
      expect(contrast(c['text/primary'], c['bg/chip'])).toBeGreaterThanOrEqual(AA);
      expect(contrast(c['text/primary'], c['bg/raised'])).toBeGreaterThanOrEqual(AA);
    });

    it('ghost: text/muted on bg/app, and on the hover and pressed fills', () => {
      expect(contrast(c['text/muted'], c['bg/app'])).toBeGreaterThanOrEqual(AA);
      expect(contrast(c['text/muted'], c['bg/chip'])).toBeGreaterThanOrEqual(AA);
      expect(contrast(c['text/muted'], c['bg/raised'])).toBeGreaterThanOrEqual(AA);
    });

    it('danger: red/strong on bg/app, and on the hover and pressed fills', () => {
      expect(contrast(c['red/strong'], c['bg/app'])).toBeGreaterThanOrEqual(AA);
      expect(contrast(c['red/strong'], c['bg/chip'])).toBeGreaterThanOrEqual(AA);
      expect(contrast(c['red/strong'], c['bg/raised'])).toBeGreaterThanOrEqual(AA);
    });
  });

  describe('Chip text on its background (WCAG AA, 4.5:1)', () => {
    const tones: Array<[string, string, string]> = [
      ['neutral', c['text/secondary'], c['bg/chip']],
      ['accent', c['accent/soft-text'], c['accent/soft']],
      ['amber', c['amber/text'], c['amber/chip']],
      ['green', c['green/text'], c['green/chip']],
      ['red', c['red/text'], c['red/chip']],
    ];

    it.each(tones)('%s tone passes at rest, hover and pressed', (_tone, text, fill) => {
      expect(contrast(text, fill)).toBeGreaterThanOrEqual(AA);
      expect(contrast(text, hoverOf(fill))).toBeGreaterThanOrEqual(AA);
      expect(contrast(text, pressedOf(fill))).toBeGreaterThanOrEqual(AA);
    });
  });

  it('text/primary passes 4.5:1 on bg/app', () => {
    expect(contrast(c['text/primary'], c['bg/app'])).toBeGreaterThanOrEqual(AA);
  });

  it('titlebar/close-hover-on passes 4.5:1 on titlebar/close-hover', () => {
    expect(
      contrast(c['titlebar/close-hover-on'], c['titlebar/close-hover']),
    ).toBeGreaterThanOrEqual(AA);
  });
});
