import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', timeout: 45_000, workers: 1,
  globalSetup: './tests/browser/server.ts',
  use: { channel: 'chrome', headless: true, baseURL: 'http://127.0.0.1:4187', viewport: { width: 1280, height: 900 }, screenshot: 'only-on-failure' },
});
