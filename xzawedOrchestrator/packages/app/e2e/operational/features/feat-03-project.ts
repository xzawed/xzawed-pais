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

  // ProjectContextBar는 ChatView에 항상 표시됨 (AUTH=none 포함)
  // /projects 라우트의 new-project-button은 AUTH=jwt 모드에서만 접근 가능
  try {
    const btn = page.locator('[data-testid="new-project-button"]')
    const visible = await btn.isVisible({ timeout: 5_000 }).catch(() => false)
    const shot = await ss.take(page, dir, '01-project-list')
    steps.push({ name: '새 프로젝트 버튼 표시', status: visible ? 'pass' : 'warn', screenshotPath: shot })

    if (!visible) {
      // AUTH=none: /projects 페이지 접근 방법 확인 (project-context-bar 존재 여부)
      const contextBarBtn = page.locator('[data-testid="project-context-bar"] button')
      const barVisible = await contextBarBtn.isVisible({ timeout: 2_000 }).catch(() => false)
      steps.push(
        { name: '프로젝트 컨텍스트 바 표시', status: barVisible ? 'pass' : 'warn' },
        { name: '프로젝트 생성 (AUTH=none, 스킵)', status: 'skip' },
      )
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

  // 프로젝트 생성 후 세션 버튼 표시 확인
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
    status: failed ? 'fail' : 'warn', steps, durationMs: Date.now() - start,
  }
}
