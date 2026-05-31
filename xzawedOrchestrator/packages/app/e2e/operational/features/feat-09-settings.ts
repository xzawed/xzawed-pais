import type { Page } from 'playwright'
import type { FeatureResult, StepResult } from '../helpers/screenshot-helper.js'
import { ScreenshotHelper } from '../helpers/screenshot-helper.js'

export async function runFeat09Settings(
  page: Page,
  ss: ScreenshotHelper
): Promise<FeatureResult> {
  const start = Date.now()
  const steps: StepResult[] = []
  const dir = '09-settings'

  try {
    await page.locator('[data-testid="settings-trigger"]').click({ timeout: 8_000 })
    await page.locator('[data-testid="settings-modal"]').waitFor({ state: 'visible', timeout: 5_000 })
    const shot = await ss.take(page, dir, '01-settings-ko')
    steps.push({ name: '설정 모달 열기 (ko)', status: 'pass', screenshotPath: shot })
  } catch (e) {
    steps.push({ name: '설정 모달 열기', status: 'fail', error: String(e) })
    return { featureId: '09', featureName: '설정·i18n', status: 'fail', steps, durationMs: Date.now() - start }
  }

  for (const locale of ['en', 'ja'] as const) {
    try {
      await page.locator('[data-testid="settings-language"]').selectOption(locale)
      await page.waitForSelector('[data-i18n-ready]', { timeout: 8_000 }).catch(() => {})
      const shot = await ss.take(page, dir, `02-settings-${locale}`)
      steps.push({ name: `${locale} 언어 전환`, status: 'pass', screenshotPath: shot })
    } catch (e) {
      steps.push({ name: `${locale} 언어 전환`, status: 'warn', error: String(e) })
    }
  }

  try {
    await page.locator('[data-testid="settings-language"]').selectOption('ko')
    await page.locator('[data-testid="settings-save"]').click()
    await page.locator('[data-testid="settings-modal"]').waitFor({ state: 'hidden', timeout: 5_000 })
    const shot = await ss.take(page, dir, '03-settings-saved')
    steps.push({ name: '설정 저장 완료 (ko 복원)', status: 'pass', screenshotPath: shot })
  } catch (e) {
    steps.push({ name: '설정 저장', status: 'warn', error: String(e) })
  }

  const failed = steps.some(s => s.status === 'fail')
  return {
    featureId: '09', featureName: '설정·i18n',
    status: failed ? 'fail' : 'pass', steps, durationMs: Date.now() - start,
  }
}
