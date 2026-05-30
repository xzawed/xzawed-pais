import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e/operational/runner',
  testMatch: '**/round-*.ts',
  tsconfig: './e2e/operational/tsconfig.json',
  timeout: 120_000,
  globalTimeout: 1_800_000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-operational-report', open: 'never' }],
  ],
  use: {
    trace: 'on',
    screenshot: 'on',
    video: 'on',
  },
})
