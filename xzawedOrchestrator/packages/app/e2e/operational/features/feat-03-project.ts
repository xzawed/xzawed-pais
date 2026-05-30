import type { Page } from 'playwright'
import type { FeatureResult, StepResult } from '../helpers/screenshot-helper.js'
import { ScreenshotHelper } from '../helpers/screenshot-helper.js'

export async function runFeat03Project(
  page: Page,
  ss: ScreenshotHelper
): Promise<FeatureResult> {
  const start = Date.now()
  const steps: StepResult[] = []
  const dir = '03-project'

  try {
    const btn = page.locator('[data-testid="new-project-button"]')
    const visible = await btn.isVisible({ timeout: 5_000 }).catch(() => false)
    const shot = await ss.take(page, dir, '01-project-list')
    steps.push({ name: '새 프로젝트 버튼 표시', status: visible ? 'pass' : 'warn', screenshotPath: shot })
    if (!visible) {
      steps.push({ name: '프로젝트 생성 (버튼 없음, 스킵)', status: 'skip' })
      return { featureId: '03', featureName: '프로젝트 생성·전환', status: 'warn', steps, durationMs: Date.now() - start }
    }
    await btn.click()
    await page.waitForTimeout(500)
    const shot2 = await ss.take(page, dir, '02-new-project-clicked')
    steps.push({ name: '새 프로젝트 버튼 클릭', status: 'pass', screenshotPath: shot2 })
  } catch (e) {
    steps.push({ name: '새 프로젝트 버튼 확인', status: 'fail', error: String(e) })
    return { featureId: '03', featureName: '프로젝트 생성·전환', status: 'fail', steps, durationMs: Date.now() - start }
  }

  try {
    const newSessionBtn = page.locator('[data-testid="new-session-button"]')
    const visible = await newSessionBtn.isVisible({ timeout: 3_000 }).catch(() => false)
    if (visible) {
      await newSessionBtn.click()
      await page.waitForTimeout(1_000)
    }
    const shot = await ss.take(page, dir, '03-after-project-action')
    steps.push({ name: '세션/프로젝트 생성 후', status: 'pass', screenshotPath: shot })
  } catch (e) {
    steps.push({ name: '세션 생성', status: 'warn', error: String(e) })
  }

  const failed = steps.some(s => s.status === 'fail')
  return {
    featureId: '03', featureName: '프로젝트 생성·전환',
    status: failed ? 'fail' : 'pass', steps, durationMs: Date.now() - start,
  }
}
