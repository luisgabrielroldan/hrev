// Browser tests of the viewer against the real hrev binary. Run them with `make e2e`, which builds the binary first.
// They use the installed Google Chrome. Set PW_CHANNEL to another channel, or to an empty value to use the
// Chromium of `npx playwright install chromium`.
import { defineConfig } from '@playwright/test';

const channel = process.env.PW_CHANNEL ?? 'chrome';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    ...(channel ? { channel } : {}),
    headless: true,
    viewport: { width: 1400, height: 1000 },
  },
});
