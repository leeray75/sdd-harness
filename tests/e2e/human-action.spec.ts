import { join } from 'node:path';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { GESTURE_WINDOW_MS } from '../../src/main/human/gesture';

// The human-only channel (D33) in the built app. Page script calls it through the bridge, and
// real Playwright input stands in for a user. The calls are made by page.evaluate, right after
// the input. The e2e project has no DOM lib, so the page global is described here.
const root = join(__dirname, '..', '..');

type HumanResult = { ok: true } | { ok: false; code: string; reason: string };
type HarnessGlobal = {
  harness: { humanAction(request: unknown): Promise<HumanResult> };
};

/** The centre of the 1280 x 800 default window, on the page body. */
const CLICK_X = 640;
const CLICK_Y = 400;

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

/** Opens the app's window and waits until the page has loaded. */
async function openPage(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return page;
}

test('(a) a call with no prior input is refused as no-gesture', async () => {
  const app = await launchApp();
  try {
    const page = await openPage(app);
    const result = await page.evaluate(() =>
      (globalThis as unknown as HarnessGlobal).harness.humanAction({
        action: 'approve-spec',
        feature: 'demo',
      }),
    );
    expect(result).toMatchObject({ ok: false, code: 'no-gesture' });
  } finally {
    await app.close();
  }
});

test('(b) a request that fails the guard is refused as invalid', async () => {
  const app = await launchApp();
  try {
    const page = await openPage(app);
    const result = await page.evaluate(() =>
      (globalThis as unknown as HarnessGlobal).harness.humanAction({
        action: 'approve-spec',
        feature: '../demo',
      }),
    );
    expect(result).toMatchObject({ ok: false, code: 'invalid' });
  } finally {
    await app.close();
  }
});

test('(c) after a real click, the same call passes the gesture check (not-available)', async () => {
  const app = await launchApp();
  try {
    const page = await openPage(app);
    await page.mouse.click(CLICK_X, CLICK_Y);
    const result = await page.evaluate(() =>
      (globalThis as unknown as HarnessGlobal).harness.humanAction({
        action: 'approve-spec',
        feature: 'demo',
      }),
    );
    // No handler is registered yet, so the gesture was seen and the request got that far.
    expect(result).toMatchObject({ ok: false, code: 'not-available' });
  } finally {
    await app.close();
  }
});

test('(d) a second call after one click is refused as no-gesture', async () => {
  const app = await launchApp();
  try {
    const page = await openPage(app);
    await page.mouse.click(CLICK_X, CLICK_Y);
    const first = await page.evaluate(() =>
      (globalThis as unknown as HarnessGlobal).harness.humanAction({
        action: 'approve-spec',
        feature: 'demo',
      }),
    );
    expect(first).toMatchObject({ ok: false, code: 'not-available' });

    const second = await page.evaluate(() =>
      (globalThis as unknown as HarnessGlobal).harness.humanAction({
        action: 'approve-spec',
        feature: 'demo',
      }),
    );
    expect(second).toMatchObject({ ok: false, code: 'no-gesture' });
  } finally {
    await app.close();
  }
});

test('(e) after a real Enter key press in the page, the call passes the gesture check', async () => {
  const app = await launchApp();
  try {
    const page = await openPage(app);
    await page.keyboard.press('Enter');
    const result = await page.evaluate(() =>
      (globalThis as unknown as HarnessGlobal).harness.humanAction({
        action: 'approve-spec',
        feature: 'demo',
      }),
    );
    expect(result).toMatchObject({ ok: false, code: 'not-available' });
  } finally {
    await app.close();
  }
});

test('(f) a click older than the gesture window is refused as no-gesture', async () => {
  const app = await launchApp();
  try {
    const page = await openPage(app);
    await page.mouse.click(CLICK_X, CLICK_Y);
    await page.waitForTimeout(GESTURE_WINDOW_MS + 250);
    const result = await page.evaluate(() =>
      (globalThis as unknown as HarnessGlobal).harness.humanAction({
        action: 'approve-spec',
        feature: 'demo',
      }),
    );
    expect(result).toMatchObject({ ok: false, code: 'no-gesture' });
  } finally {
    await app.close();
  }
});
