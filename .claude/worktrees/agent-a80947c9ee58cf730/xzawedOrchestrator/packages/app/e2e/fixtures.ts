import { test as base } from '@playwright/test'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import path from 'path'

const mainEntry = path.resolve(__dirname, '../out/main/index.js')

type E2EFixtures = {
  electronApp: ElectronApplication
  page: Page
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
})

export { expect } from '@playwright/test'
