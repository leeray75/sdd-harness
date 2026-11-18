import { defineConfig } from '@playwright/test';

// e2e runs against the built app (out/), so run `pnpm build` first, or use `pnpm e2e`
// which builds before the tests.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  workers: 1,
  reporter: 'list',
});
