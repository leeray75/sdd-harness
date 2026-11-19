import { join } from 'node:path';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

const root = join(__dirname, '..', '..');
const isMac = process.platform === 'darwin';

// The e2e project has no DOM lib, so the browser globals used inside page.evaluate
// callbacks are described here. Each callback casts globalThis to this shape itself,
// because Playwright serializes the callback and cannot use helpers from this file.
type DomElement = { blur(): void; getAttribute(name: string): string | null };
type DomLike = {
  document: {
    activeElement: DomElement | null;
    querySelector(selector: string): { textContent: string | null } | null;
  };
  getComputedStyle(el: DomElement): {
    outlineStyle: string;
    backgroundColor: string;
    paddingLeft: string;
  };
  window: { open(url: string): unknown };
  location: { href: string };
};

/** Launches the built app, without the dev-server URL. */
async function launchApp(): Promise<ElectronApplication> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RENDERER_URL') {
      env[key] = value;
    }
  }
  return electron.launch({ args: [root], cwd: root, env });
}

/** Reads the state of the app's main window in the main process. */
function windowState(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return {
      count: BrowserWindow.getAllWindows().length,
      minimized: win.isMinimized(),
      maximized: win.isMaximized(),
    };
  });
}

test('window is frameless on Windows and Linux, and has the 1024x680 minimum size', async () => {
  test.skip(isMac, 'macOS keeps a hidden-inset title bar, checked by the macOS title-bar test');
  const app = await launchApp();
  try {
    await app.firstWindow();
    const frameState = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return {
        bounds: win.getBounds(),
        content: win.getContentBounds(),
        minimumSize: win.getMinimumSize(),
      };
    });
    // A frameless window has no title bar or frame, so its content area is its whole size.
    expect(frameState.content).toEqual(frameState.bounds);
    expect(frameState.minimumSize).toEqual([1024, 680]);
  } finally {
    await app.close();
  }
});

test('title bar is 40px tall, uses the title bar background and shows the app name', async () => {
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    const header = page.locator('header.titlebar');
    await expect(header).toBeVisible();

    const { height, background } = await header.evaluate((el: unknown) => {
      const d = globalThis as unknown as DomLike;
      const node = el as DomElement & { getBoundingClientRect(): { height: number } };
      return {
        height: node.getBoundingClientRect().height,
        background: d.getComputedStyle(node).backgroundColor,
      };
    });
    expect(height).toBe(40);
    expect(background).toBe('rgb(11, 13, 16)');
    await expect(header.getByText('SDD Harness', { exact: true })).toBeVisible();

    // The app mark is decorative.
    await expect(header.locator('svg').first()).toHaveAttribute('aria-hidden', 'true');

    // The location slot is present and empty.
    await expect(header.getByRole('navigation', { name: 'Location' })).toBeEmpty();
  } finally {
    await app.close();
  }
});

test('caption buttons have accessible names, and Tab focus shows an outline', async () => {
  test.skip(isMac, 'macOS renders no caption buttons');
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('button', { name: 'Minimize', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Maximize', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeVisible();

    // Tab from the top of the page reaches Minimize first, and it shows a visible outline.
    await page.evaluate(() => {
      const d = globalThis as unknown as DomLike;
      d.document.activeElement?.blur();
    });
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const d = globalThis as unknown as DomLike;
      const el = d.document.activeElement;
      return {
        label: el ? el.getAttribute('aria-label') : null,
        outlineStyle: el ? d.getComputedStyle(el).outlineStyle : 'none',
      };
    });
    expect(focused.label).toBe('Minimize');
    expect(focused.outlineStyle).not.toBe('none');
  } finally {
    await app.close();
  }
});

test('macOS renders no caption buttons in the title bar', async () => {
  test.skip(!isMac, 'caption buttons are checked on Windows and Linux');
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('header.titlebar')).toBeVisible();
    await expect(page.locator('header.titlebar button')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('macOS traffic lights sit at { x: 14, y: 13 } and the title bar has 78px left padding', async () => {
  test.skip(!isMac, 'the traffic lights and title-bar padding are macOS only');
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('header.titlebar')).toBeVisible();

    const position = await app.evaluate(({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows()[0].getWindowButtonPosition();
    });
    expect(position).toEqual({ x: 14, y: 13 });

    const paddingLeft = await page.locator('header.titlebar').evaluate((el: unknown) => {
      const d = globalThis as unknown as DomLike;
      return d.getComputedStyle(el as DomElement).paddingLeft;
    });
    expect(paddingLeft).toBe('78px');
  } finally {
    await app.close();
  }
});

test('Minimize, Maximize, Restore and Close drive the window', async () => {
  test.skip(isMac, 'caption buttons are checked on Windows and Linux');
  const app = await launchApp();
  try {
    const page: Page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Maximize: the button reads Restore once the window is maximized.
    await page.getByRole('button', { name: 'Maximize', exact: true }).click();
    await expect.poll(async () => (await windowState(app)).maximized).toBe(true);
    await expect(page.getByRole('button', { name: 'Restore', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Maximize', exact: true })).toHaveCount(0);

    // Restore: the window is unmaximized and the button reads Maximize again.
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect.poll(async () => (await windowState(app)).maximized).toBe(false);
    await expect(page.getByRole('button', { name: 'Maximize', exact: true })).toBeVisible();

    // Minimize: the window is minimized. Restore it through main so the app can be closed normally.
    await page.getByRole('button', { name: 'Minimize', exact: true }).click();
    await expect.poll(async () => (await windowState(app)).minimized).toBe(true);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
    await expect.poll(async () => (await windowState(app)).minimized).toBe(false);
  } finally {
    await app.close();
  }
});

test('Close closes the app', async () => {
  test.skip(isMac, 'caption buttons are checked on Windows and Linux');
  const app = await launchApp();
  let closed = false;
  app.on('close', () => {
    closed = true;
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect.poll(() => closed, { timeout: 20_000 }).toBe(true);
});

test('window.open is denied and no second window appears', async () => {
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    const opened = await page.evaluate(() => {
      const d = globalThis as unknown as DomLike;
      return d.window.open('https://example.com');
    });
    expect(opened).toBeNull();
    expect((await windowState(app)).count).toBe(1);
  } finally {
    await app.close();
  }
});

test('foreign navigation is blocked and the page stays on the app URL', async () => {
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    const appUrl = page.url();
    await page.evaluate(() => {
      const d = globalThis as unknown as DomLike;
      d.location.href = 'https://example.com';
    });
    // The navigation is prevented in main. Give it time to happen if it were going to.
    await page.waitForTimeout(1000);
    expect(page.url()).toBe(appUrl);
    // Read the page's own DOM. Playwright's locators wait for the cancelled navigation to settle.
    const heading = await page.evaluate(() => {
      const d = globalThis as unknown as DomLike;
      return d.document.querySelector('h1')?.textContent ?? null;
    });
    expect(heading).toBe('SDD Harness');
  } finally {
    await app.close();
  }
});
