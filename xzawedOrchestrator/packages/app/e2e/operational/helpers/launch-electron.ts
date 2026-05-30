import { _electron as electron, type ElectronApplication, type Page } from 'playwright'

export async function ensureSessionActive(page: Page): Promise<void> {
  const hasInput = await page.locator('[data-testid="message-input"]').isVisible({ timeout: 2_000 }).catch(() => false)
  if (!hasInput) {
    const newSession = page.locator('[data-testid="new-session-button"]')
    if (await newSession.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await newSession.click()
    }
  }
}

export async function launchElectronApp(
  mainEntry: string,
  serverUrl?: string,
): Promise<{ app: ElectronApplication; page: Page }> {
  const env = { ...process.env } as Record<string, string>
  // ELECTRON_RUN_AS_NODE=1 causes electron.exe to run as plain Node.js,
  // rejecting Chromium flags like --remote-debugging-port=0 that Playwright needs.
  delete env['ELECTRON_RUN_AS_NODE']
  const app = await electron.launch({
    args: [mainEntry],
    env: {
      ...env,
      NODE_ENV: 'test',
      SERVER_URL: serverUrl ?? process.env['SERVER_URL'] ?? 'http://localhost:3000',
    },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}
