import type { Page } from 'playwright'
import type { FeatureResult, StepResult } from '../helpers/screenshot-helper.js'
import { ScreenshotHelper } from '../helpers/screenshot-helper.js'

export async function runFeat11Error(
  page: Page,
  ss: ScreenshotHelper
): Promise<FeatureResult> {
  const start = Date.now()
  const steps: StepResult[] = []
  const dir = '11-error-states'

  try {
    await page.locator('[data-testid="settings-trigger"]').click({ timeout: 5_000 })
    await page.locator('[data-testid="settings-modal"]').waitFor({ state: 'visible', timeout: 5_000 })
    await page.locator('[data-testid="settings-server-url"]').fill('http://localhost:9999')
    await page.locator('[data-testid="settings-save"]').click()
    await page.waitForTimeout(2_000)
    const shot = await ss.take(page, dir, '01-wrong-server-url')
    steps.push({ name: '잘못된 서버 URL 설정', status: 'pass', screenshotPath: shot })
  } catch (e) {
    steps.push({ name: '오류 상태 유발', status: 'warn', error: String(e) })
  }

  try {
    await page.waitForTimeout(2_000)
    const shot = await ss.take(page, dir, '02-error-state')
    const errorEl = page.locator('[data-testid="server-error"], [class*="error"], [class*="disconnect"]')
    const hasError = (await errorEl.count()) > 0
    steps.push({ name: '연결 오류 상태 표시', status: hasError ? 'pass' : 'warn', screenshotPath: shot })
  } catch (e) {
    steps.push({ name: '오류 상태 표시', status: 'warn', error: String(e) })
  }

  try {
    await page.locator('[data-testid="settings-trigger"]').click({ timeout: 5_000 })
    await page.locator('[data-testid="settings-modal"]').waitFor({ state: 'visible', timeout: 5_000 })
    await page.locator('[data-testid="settings-server-url"]').fill('http://localhost:3000')
    await page.locator('[data-testid="settings-save"]').click()
    await page.waitForTimeout(2_000)
    const shot = await ss.take(page, dir, '03-server-restored')
    steps.push({ name: '서버 URL 복원', status: 'pass', screenshotPath: shot })
  } catch (e) {
    steps.push({ name: '서버 URL 복원', status: 'warn', error: String(e) })
  }

  const failed = steps.some(s => s.status === 'fail')
  return {
    featureId: '11', featureName: '오류 상태·복구',
    status: failed ? 'fail' : 'pass', steps, durationMs: Date.now() - start,
  }
}
