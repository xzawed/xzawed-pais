import { test as base } from '@playwright/test'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import path from 'node:path'

const mainEntry = path.resolve(__dirname, '../out/main/index.js')

type E2EFixtures = {
  electronApp: ElectronApplication
  page: Page
  loginApp: ElectronApplication
  loginPage: Page
}

export const test = base.extend<E2EFixtures>({
  electronApp: async ({}, provide) => {
    const app = await electron.launch({
      args: [mainEntry],
      env: { ...process.env, NODE_ENV: 'test' },
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
      env: { ...process.env, NODE_ENV: 'test', ELECTRON_TEST_ROUTE: 'login' },
    })
    await provide(app)
    await app.close()
  },

  loginPage: async ({ loginApp }, provide) => {
    const window = await loginApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await provide(window)
  },
})

export { expect } from '@playwright/test'
