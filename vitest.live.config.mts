import { defineConfig } from 'vitest/config';

// Live suite (D24): runs against a real OpenAI-compatible server when HARNESS_SPIKE_BASE_URL
// is set, and is skipped otherwise. Kept out of `pnpm test`, and CI never runs it.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/live/**/*.live.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
