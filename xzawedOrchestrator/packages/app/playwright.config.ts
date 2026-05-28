import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  fullyParallel: false,
  workers: 1,
  use: {
    trace: 'on-first-retry',
  },
})
