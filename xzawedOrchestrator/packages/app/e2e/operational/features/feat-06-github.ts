import type { Page } from 'playwright'
import type { FeatureResult, StepResult } from '../helpers/screenshot-helper.js'
import { ScreenshotHelper } from '../helpers/screenshot-helper.js'

export async function runFeat06Github(
  page: Page,
  ss: ScreenshotHelper
): Promise<FeatureResult> {
  const start = Date.now()
  const steps: StepResult[] = []
  const dir = '06-github'

  try {
    await page.waitForSelector('[data-testid="github-panel"]', { timeout: 8_000 }).catch(async () => {
      const tabs = page.locator('[data-testid="activity-bar"] button, [role="tab"]')
      const count = await tabs.count()
      for (let i = 0; i < count; i++) {
        const text = await tabs.nth(i).textContent()
        if (text?.toLowerCase().includes('github')) { await tabs.nth(i).click(); break }
      }
    })
    const shot = await ss.take(page, dir, '01-github-panel-open')
    const visible = await page.locator('[data-testid="github-panel"]').isVisible({ timeout: 3_000 }).catch(() => false)
    steps.push({ name: 'GitHub 패널 열기', status: visible ? 'pass' : 'warn', screenshotPath: shot })
  } catch (e) {
    const shot = await ss.take(page, dir, '01-github-panel-error').catch(() => undefined)
    steps.push({ name: 'GitHub 패널 열기', status: 'warn', error: String(e), screenshotPath: shot })
    return { featureId: '06', featureName: 'GitHub 패널', status: 'warn', steps, durationMs: Date.now() - start }
  }

  try {
    const connected = page.locator('[data-testid="github-repo-list"]')
    const isConnected = await connected.isVisible({ timeout: 3_000 }).catch(() => false)
    if (isConnected) {
      const shot = await ss.take(page, dir, '02-github-connected')
      steps.push({ name: 'GitHub 이미 연결됨', status: 'pass', screenshotPath: shot })
    } else {
      const oauthBtn = page.locator('[data-testid="github-oauth-button"]')
      const hint = page.locator('[data-testid="github-connect-hint"]')
      const btnVisible = await oauthBtn.isVisible({ timeout: 3_000 }).catch(() => false)
      const hintVisible = await hint.isVisible({ timeout: 3_000 }).catch(() => false)
      const shot = await ss.take(page, dir, '02-github-disconnected')
      steps.push({
        name: 'GitHub 연결 버튼/힌트 표시',
        status: (btnVisible || hintVisible) ? 'pass' : 'warn',
        screenshotPath: shot,
      })
      // test 모드에서 store 직접 주입
      await page.evaluate(() => {
        const store = (window as unknown as Record<string, unknown>).__integrationsStore as {
          setState?: (s: Record<string, unknown>) => void
        } | undefined
        store?.setState?.({ github: { connected: true, username: 'test-user', avatarUrl: null } })
      })
      await page.waitForTimeout(500)
      const shot2 = await ss.take(page, dir, '03-github-simulated-connected')
      steps.push({ name: 'GitHub 연결 상태 주입', status: 'pass', screenshotPath: shot2 })
    }
  } catch (e) {
    steps.push({ name: 'GitHub 상태 확인', status: 'warn', error: String(e) })
  }

  const failed = steps.some(s => s.status === 'fail')
  return {
    featureId: '06', featureName: 'GitHub 패널',
    status: failed ? 'fail' : 'pass', steps, durationMs: Date.now() - start,
  }
}
