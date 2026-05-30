import { test as base } from '@playwright/test'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import path from 'node:path'

const mainEntry = path.resolve(__dirname, '../out/main/index.js')

type E2EFixtures = {
  electronApp: ElectronApplication
  page: Page
  loginApp: ElectronApplication
  loginPage: Page
  waitForI18n: () => Promise<void>
}

function makeEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const env = { ...process.env } as Record<string, string>
  // ELECTRON_RUN_AS_NODE=1 causes electron.exe to behave as plain Node.js,
  // rejecting Chromium flags like --remote-debugging-port=0 that Playwright needs.
  delete env['ELECTRON_RUN_AS_NODE']
  return { ...env, NODE_ENV: 'test', ...overrides }
}

export const test = base.extend<E2EFixtures>({
  electronApp: async ({}, provide) => {
    const app = await electron.launch({
      args: [mainEntry],
      env: makeEnv(),
    })
    await provide(app)
    await app.close()
  },

  page: async ({ electronApp }, provide) => {
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await provide(window)
  },

  // Launches the app with ELECTRON_TEST_ROUTE=login so it starts at /login
  loginApp: async ({}, provide) => {
    const app = await electron.launch({
      args: [mainEntry],
      env: makeEnv({ ELECTRON_TEST_ROUTE: 'login' }),
    })
    await provide(app)
    await app.close()
  },

  loginPage: async ({ loginApp }, provide) => {
    const window = await loginApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await provide(window)
  },

  // i18n 초기화 완료 대기 헬퍼. reload 후 [data-i18n-ready] 속성 출현까지 대기한다.
  waitForI18n: async ({ page }, provide) => {
    await provide(() => page.waitForSelector('[data-i18n-ready]', { timeout: 10_000 }))
  },
})

export { expect } from '@playwright/test'
