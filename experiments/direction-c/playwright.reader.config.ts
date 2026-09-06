import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  testDir: './tests-reader',
  outputDir: './artifacts/reader-tests',
  timeout: 45000,
  expect: { timeout: 10000 },
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:5198', channel: 'chrome', headless: true, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm.cmd run dev -- --host 127.0.0.1 --port 5198 --strictPort --configLoader runner',
    cwd: fileURLToPath(new URL('../../frontend', import.meta.url)),
    url: 'http://127.0.0.1:5198', reuseExistingServer: true, timeout: 30000,
  },
});
