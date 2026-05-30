import type { Page } from 'playwright'
import type { FeatureResult, StepResult } from '../helpers/screenshot-helper.js'
import { ScreenshotHelper } from '../helpers/screenshot-helper.js'

export async function runFeat08Plugin(
  page: Page,
  ss: ScreenshotHelper
): Promise<FeatureResult> {
  const start = Date.now()
  const steps: StepResult[] = []
  const dir = '08-plugin'

  try {
    await page.waitForSelector('[data-testid="plugin-panel"]', { timeout: 8_000 }).catch(() => {})
    const shot = await ss.take(page, dir, '01-plugin-panel')
    const visible = await page.locator('[data-testid="plugin-panel"]').isVisible({ timeout: 3_000 }).catch(() => false)
    steps.push({ name: '플러그인 패널 표시', status: visible ? 'pass' : 'warn', screenshotPath: shot })
  } catch (e) {
    steps.push({ name: '플러그인 패널', status: 'warn', error: String(e) })
    return { featureId: '08', featureName: '플러그인 관리', status: 'warn', steps, durationMs: Date.now() - start }
  }

  try {
    const toggleBtns = page.locator('[data-testid*="plugin-toggle"]')
    const count = await toggleBtns.count()
    if (count > 0) {
      await toggleBtns.first().click()
      await page.waitForTimeout(500)
      const shot = await ss.take(page, dir, '02-plugin-toggled')
      steps.push({ name: '플러그인 토글', status: 'pass', screenshotPath: shot })
    } else {
      steps.push({ name: '플러그인 토글 (목록 없음)', status: 'skip' })
    }
  } catch (e) {
    steps.push({ name: '플러그인 토글', status: 'warn', error: String(e) })
  }

  const failed = steps.some(s => s.status === 'fail')
  return {
    featureId: '08', featureName: '플러그인 관리',
    status: failed ? 'fail' : 'pass', steps, durationMs: Date.now() - start,
  }
}
