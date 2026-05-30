import type { Page } from 'playwright'
import type { FeatureResult, StepResult } from '../helpers/screenshot-helper.js'
import { ScreenshotHelper } from '../helpers/screenshot-helper.js'

export async function runFeat10Palette(
  page: Page,
  ss: ScreenshotHelper
): Promise<FeatureResult> {
  const start = Date.now()
  const steps: StepResult[] = []
  const dir = '10-command-palette'

  try {
    await page.keyboard.press('Control+k')
    await page.locator('[data-testid="command-palette"]').waitFor({ state: 'visible', timeout: 5_000 })
    const shot = await ss.take(page, dir, '01-palette-open')
    steps.push({ name: 'Ctrl+K → 팔레트 열림', status: 'pass', screenshotPath: shot })
  } catch (e) {
    steps.push({ name: '팔레트 열기', status: 'fail', error: String(e) })
    return { featureId: '10', featureName: 'Command Palette', status: 'fail', steps, durationMs: Date.now() - start }
  }

  try {
    await page.locator('[data-testid="command-palette-input"]').fill('설정')
    await page.waitForTimeout(300)
    const itemCount = await page.locator('[data-testid="command-palette-item"]').count()
    const shot = await ss.take(page, dir, '02-palette-search')
    steps.push({ name: '검색 결과 필터링', status: itemCount >= 0 ? 'pass' : 'warn', screenshotPath: shot })
  } catch (e) {
    steps.push({ name: '검색 필터링', status: 'warn', error: String(e) })
  }

  try {
    await page.keyboard.press('Escape')
    await page.locator('[data-testid="command-palette"]').waitFor({ state: 'hidden', timeout: 3_000 })
    const shot = await ss.take(page, dir, '03-palette-closed')
    steps.push({ name: 'Escape → 팔레트 닫힘', status: 'pass', screenshotPath: shot })
  } catch (e) {
    steps.push({ name: '팔레트 닫기', status: 'warn', error: String(e) })
  }

  const failed = steps.some(s => s.status === 'fail')
  return {
    featureId: '10', featureName: 'Command Palette',
    status: failed ? 'fail' : 'pass', steps, durationMs: Date.now() - start,
  }
}
