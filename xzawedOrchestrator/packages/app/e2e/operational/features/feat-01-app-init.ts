import type { Page } from 'playwright'
import type { FeatureResult, StepResult } from '../helpers/screenshot-helper.js'
import { ScreenshotHelper } from '../helpers/screenshot-helper.js'

export async function runFeat01AppInit(
  page: Page,
  ss: ScreenshotHelper
): Promise<FeatureResult> {
  const start = Date.now()
  const steps: StepResult[] = []
  const dir = '01-app-init'

  try {
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 })
    const shot = await ss.take(page, dir, '01-app-startup')
    steps.push({ name: 'domcontentloaded 완료', status: 'pass', screenshotPath: shot })
  } catch (e) {
    steps.push({ name: 'domcontentloaded 완료', status: 'fail', error: String(e) })
    return { featureId: '01', featureName: '앱 초기화', status: 'fail', steps, durationMs: Date.now() - start }
  }

  const errors: string[] = []
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
  await page.waitForTimeout(2_000)
  if (errors.length > 0) {
    steps.push({ name: '콘솔 오류 없음', status: 'warn', error: errors.join('; ') })
  } else {
    steps.push({ name: '콘솔 오류 없음', status: 'pass' })
  }

  try {
    const shot = await ss.take(page, dir, '02-loading-complete')
    steps.push({ name: '초기 화면 렌더링', status: 'pass', screenshotPath: shot })
  } catch (e) {
    steps.push({ name: '초기 화면 렌더링', status: 'fail', error: String(e) })
  }

  const allPass = steps.every(s => s.status === 'pass')
  const hasWarn = steps.some(s => s.status === 'warn')
  return {
    featureId: '01',
    featureName: '앱 초기화',
    status: allPass ? 'pass' : hasWarn ? 'warn' : 'fail',
    steps,
    durationMs: Date.now() - start,
  }
}
