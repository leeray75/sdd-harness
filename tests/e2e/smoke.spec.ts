import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { HarnessBridge } from '../../src/shared/bridge';

const root = join(__dirname, '..', '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };

// Typed view of the renderer's global, used inside page.evaluate callbacks.
type RendererGlobal = { harness: HarnessBridge };

test('shell boots with the bridge and no Node access in the renderer', async () => {
  // Drop the dev-server URL so the app loads the built page, and any undefined values.
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RENDERER_URL') {
      env[key] = value;
    }
  }

  // Launch with the app root (package.json "main" points at the built entry), the same
  // way a packaged app runs, so app.getVersion() reads this package's version.
  const app = await electron.launch({
    args: [root],
    cwd: root,
    env,
  });

  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // The placeholder shell is shown.
    await expect(page.getByRole('heading', { name: 'SDD Harness' })).toBeVisible();
    await expect(page.getByText('Empty shell.')).toBeVisible();

    // The version shown comes from window.harness.getVersion(), and matches package.json.
    const appVersion = await app.evaluate(({ app }) => app.getVersion());
    expect(appVersion).toBe(pkg.version);
    await expect(page.getByTestId('app-version')).toHaveText(pkg.version);
    expect(
      await page.evaluate(() => (globalThis as unknown as RendererGlobal).harness.getVersion()),
    ).toBe(pkg.version);

    // Node globals are not reachable from the renderer.
    const nodeGlobals = await page.evaluate(() => ({
      require: typeof require,
      process: typeof process,
      module: typeof module,
    }));
    expect(nodeGlobals).toEqual({
      require: 'undefined',
      process: 'undefined',
      module: 'undefined',
    });

    // window.harness has exactly the declared members and nothing else.
    const harnessKeys = await page.evaluate(() =>
      Object.keys((globalThis as unknown as RendererGlobal).harness).sort(),
    );
    expect(harnessKeys).toEqual(['getVersion', 'humanAction', 'platform', 'window']);

    // window.harness.window has exactly the caption controls.
    const windowKeys = await page.evaluate(() =>
      Object.keys((globalThis as unknown as RendererGlobal).harness.window).sort(),
    );
    expect(windowKeys).toEqual([
      'close',
      'isMaximized',
      'minimize',
      'onMaximizedChange',
      'toggleMaximize',
    ]);
  } finally {
    await app.close();
  }
});
