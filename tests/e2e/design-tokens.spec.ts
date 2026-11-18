import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { tokens } from '../../src/shared/tokens';

const root = join(__dirname, '..', '..');

// The e2e project has no DOM lib, so browser globals used inside page.evaluate callbacks are
// described here. Each callback casts globalThis to this shape itself.
type ElementLike = { tagName: string; textContent: string | null; focus(): void };
type StyleLike = {
  backgroundColor: string;
  color: string;
  fontFamily: string;
  margin: string;
  outlineStyle: string;
  outlineWidth: string;
  outlineColor: string;
  outlineOffset: string;
};
type DomLike = {
  document: {
    body: ElementLike;
    activeElement: ElementLike | null;
    fonts: { ready: Promise<unknown>; check(font: string): boolean };
  };
  getComputedStyle(el: ElementLike): StyleLike;
  performance: { getEntriesByType(type: string): Array<{ name: string }> };
};

/** Launches the built app. Only the flags passed in are set, so a developer's shell cannot change them. */
async function launch(gallery: boolean): Promise<ElectronApplication> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RENDERER_URL' && key !== 'HARNESS_GALLERY') {
      env[key] = value;
    }
  }
  if (gallery) {
    env['HARNESS_GALLERY'] = '1';
  }
  return electron.launch({ args: [root], cwd: root, env });
}

/** `#RRGGBB` as the `rgb(r, g, b)` string that getComputedStyle returns. */
function rgbOf(hex: string): string {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

/** Parses `rgb(r, g, b)` back into channels. */
function parseRgb(value: string): [number, number, number] {
  const m = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(value);
  if (!m) {
    throw new Error(`not an rgb() colour: ${value}`);
  }
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** WCAG 2.2 contrast ratio of two rgb() colours. */
function contrastOf(a: string, b: string): number {
  const lum = (value: string) => {
    const [r, g, bl] = parseRgb(value).map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const la = lum(a);
  const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Presses Tab until the focused element's text is `name`. */
async function tabTo(page: Page, name: string): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    const active = await page.evaluate(() => {
      const d = globalThis as unknown as DomLike;
      return d.document.activeElement?.textContent ?? null;
    });
    if (active === name) {
      return;
    }
    await page.keyboard.press('Tab');
  }
  throw new Error(`could not Tab to "${name}"`);
}

test('shell: body uses bg/app and text/primary in Inter, with no margin', async () => {
  const app = await launch(false);
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('heading', { name: 'SDD Harness' })).toBeVisible();

    const style = await page.evaluate(() => {
      const d = globalThis as unknown as DomLike;
      const s = d.getComputedStyle(d.document.body);
      return {
        backgroundColor: s.backgroundColor,
        color: s.color,
        fontFamily: s.fontFamily,
        margin: s.margin,
      };
    });

    expect(style.backgroundColor).toBe(rgbOf(tokens.color['bg/app']));
    expect(style.color).toBe(rgbOf(tokens.color['text/primary']));
    expect(contrastOf(style.color, style.backgroundColor)).toBeGreaterThanOrEqual(4.5);
    expect(style.fontFamily.startsWith('Inter')).toBe(true);
    expect(style.margin).toBe('0px');
  } finally {
    await app.close();
  }
});

test('gallery: every Button variant in both sizes, disabled, and every Chip tone', async () => {
  const app = await launch(true);
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('heading', { name: 'Design tokens gallery' })).toBeVisible();

    const variants = ['Primary', 'Gate', 'Secondary', 'Ghost', 'Danger'];
    for (const label of variants) {
      await expect(page.getByRole('button', { name: label, exact: true })).toBeEnabled();
      await expect(page.getByRole('button', { name: `${label} small`, exact: true })).toBeEnabled();
      await expect(
        page.getByRole('button', { name: `${label} disabled`, exact: true }),
      ).toBeDisabled();
    }

    for (const tone of ['Neutral', 'Accent', 'Amber', 'Green', 'Red']) {
      // A Chip without onClick is a span; with onClick it is a real button.
      await expect(page.locator('span.chip', { hasText: tone }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: `${tone} button`, exact: true })).toBeVisible();
    }
  } finally {
    await app.close();
  }
});

test('gallery: Inter and JetBrains Mono are bundled and loaded from the app', async () => {
  const app = await launch(true);
  // Playwright reports each finished request. The listener is attached to each window as
  // soon as Playwright sees it, so requests made while the page loads are recorded too.
  const fontUrls: string[] = [];
  app.on('window', (win: Page) => {
    win.on('requestfinished', (request) => {
      const url = request.url();
      if (request.resourceType() === 'font' || /\.woff2?$/.test(url)) {
        fontUrls.push(url);
      }
    });
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('heading', { name: 'Design tokens gallery' })).toBeVisible();

    const checks = await page.evaluate(async () => {
      const d = globalThis as unknown as DomLike;
      await d.document.fonts.ready;
      return {
        inter: d.document.fonts.check('600 14px Inter'),
        mono: d.document.fonts.check('400 13px "JetBrains Mono"'),
      };
    });
    expect(checks).toEqual({ inter: true, mono: true });

    // The built renderer folder. Every font must come from there, not from any other location.
    const rendererDir = `${pathToFileURL(join(root, 'out', 'renderer')).href}/`;
    expect(fontUrls.length).toBeGreaterThan(0);
    expect(fontUrls.every((url) => url.startsWith(rendererDir))).toBe(true);

    const bundledWoff2 = fontUrls.filter((url) => url.endsWith('.woff2'));
    expect(bundledWoff2.some((url) => url.includes('/inter-'))).toBe(true);
    expect(bundledWoff2.some((url) => url.includes('/jetbrains-mono-'))).toBe(true);
  } finally {
    await app.close();
  }
});

test('focus: keyboard focus on a Button and on a button Chip shows a 2px accent outline', async () => {
  const app = await launch(true);
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('heading', { name: 'Design tokens gallery' })).toBeVisible();

    const outlineOf = () =>
      page.evaluate(() => {
        const d = globalThis as unknown as DomLike;
        const el = d.document.activeElement;
        if (!el) {
          return null;
        }
        const s = d.getComputedStyle(el);
        return {
          outlineStyle: s.outlineStyle,
          outlineWidth: s.outlineWidth,
          outlineColor: s.outlineColor,
        };
      });

    for (const name of ['Primary', 'Neutral button']) {
      await tabTo(page, name);
      expect(await outlineOf(), name).toEqual({
        outlineStyle: 'solid',
        outlineWidth: '2px',
        outlineColor: rgbOf(tokens.color.accent),
      });
    }
  } finally {
    await app.close();
  }
});

test('hover: hovering a primary button changes its background', async () => {
  const app = await launch(true);
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    const primary = page.getByRole('button', { name: 'Primary', exact: true });
    await expect(primary).toBeVisible();

    const background = () =>
      primary.evaluate((el: unknown) => {
        const d = globalThis as unknown as DomLike;
        return d.getComputedStyle(el as ElementLike).backgroundColor;
      });

    const rest = await background();
    expect(rest).toBe(rgbOf(tokens.color.accent));

    await primary.hover();
    await expect.poll(background).not.toBe(rest);
  } finally {
    await app.close();
  }
});
