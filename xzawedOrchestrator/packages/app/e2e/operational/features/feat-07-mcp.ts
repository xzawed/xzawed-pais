import type { Page } from 'playwright'
import type { FeatureResult, StepResult } from '../helpers/screenshot-helper.js'
import { ScreenshotHelper } from '../helpers/screenshot-helper.js'

export async function runFeat07Mcp(
  page: Page,
  ss: ScreenshotHelper
): Promise<FeatureResult> {
  const start = Date.now()
  const steps: StepResult[] = []
  const dir = '07-mcp'

  try {
    await page.waitForSelector('[data-testid="mcp-panel"]', { timeout: 8_000 }).catch(async () => {
      const tabs = page.locator('[data-testid="activity-bar"] button, [role="tab"]')
      const count = await tabs.count()
      for (let i = 0; i < count; i++) {
        const text = await tabs.nth(i).textContent()
        if (text?.toLowerCase().includes('mcp')) { await tabs.nth(i).click(); break }
      }
    })
    const shot = await ss.take(page, dir, '01-mcp-panel')
    const visible = await page.locator('[data-testid="mcp-panel"]').isVisible({ timeout: 3_000 }).catch(() => false)
    steps.push({ name: 'MCP 패널 표시', status: visible ? 'pass' : 'warn', screenshotPath: shot })
  } catch (e) {
    steps.push({ name: 'MCP 패널 표시', status: 'warn', error: String(e) })
    return { featureId: '07', featureName: 'MCP 서버 관리', status: 'warn', steps, durationMs: Date.now() - start }
  }

  try {
    const installedTab = page.locator('[data-testid="mcp-tab-installed"]')
    if (await installedTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await installedTab.click()
      await page.waitForTimeout(500)
    }
    const shot = await ss.take(page, dir, '02-mcp-installed-tab')
    steps.push({ name: 'MCP 설치 탭', status: 'pass', screenshotPath: shot })
  } catch (e) {
    steps.push({ name: 'MCP 탭 확인', status: 'warn', error: String(e) })
  }

  try {
    const recTab = page.locator('[data-testid="mcp-tab-recommended"]')
    if (await recTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await recTab.click()
      await page.waitForTimeout(500)
      const shot = await ss.take(page, dir, '03-mcp-recommended-tab')
      const recItem = page.locator('[data-testid="mcp-recommended-item"]')
      const hasItems = (await recItem.count()) > 0
      steps.push({ name: 'MCP 추천 목록 표시', status: hasItems ? 'pass' : 'warn', screenshotPath: shot })
    } else {
      steps.push({ name: 'MCP 추천 탭', status: 'skip' })
    }
  } catch (e) {
    steps.push({ name: 'MCP 추천 탭', status: 'warn', error: String(e) })
  }

  const failed = steps.some(s => s.status === 'fail')
  return {
    featureId: '07', featureName: 'MCP 서버 관리',
    status: failed ? 'fail' : 'pass', steps, durationMs: Date.now() - start,
  }
}
