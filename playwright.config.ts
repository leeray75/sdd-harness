import { defineConfig } from '@playwright/test';

// e2e runs against the built app (out/), so run `pnpm build` first, or use `pnpm e2e`
// which builds before the tests.
//
// CI sets `CI`: a failed test is retried twice, the first retry keeps a trace, and an HTML
// report is written to playwright-report/. Locally there are no retries, no trace and only
// the list reporter, so a launch problem shows on the first failure.
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  workers: 1,
  retries: isCI ? 2 : 0,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: isCI ? 'on-first-retry' : 'off',
  },
});
