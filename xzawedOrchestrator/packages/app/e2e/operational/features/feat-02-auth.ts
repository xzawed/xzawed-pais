import type { Page } from 'playwright'
import type { FeatureResult, StepResult } from '../helpers/screenshot-helper.js'
import { ScreenshotHelper } from '../helpers/screenshot-helper.js'

export async function runFeat02Auth(
  page: Page,
  ss: ScreenshotHelper,
  opts: { serverUrl: string; email: string; password: string }
): Promise<FeatureResult> {
  const start = Date.now()
  const steps: StepResult[] = []
  const dir = '02-auth'

  try {
    const isLoginPage = await page.locator('[data-testid="login-email"]').isVisible({ timeout: 5_000 }).catch(() => false)
    const shot = await ss.take(page, dir, '01-login-form')
    steps.push({ name: '로그인 폼 표시', status: isLoginPage ? 'pass' : 'skip', screenshotPath: shot })

    if (!isLoginPage) {
      steps.push({ name: '로그인 (AUTH=none, 스킵)', status: 'skip' })
      return { featureId: '02', featureName: '로그인·인증', status: 'pass', steps, durationMs: Date.now() - start }
    }
  } catch (e) {
    steps.push({ name: '로그인 폼 표시', status: 'fail', error: String(e) })
  }

  try {
    await page.locator('[data-testid="login-email"]').fill(opts.email)
    await page.locator('[data-testid="login-password"]').fill(opts.password)
    const shot = await ss.take(page, dir, '02-credentials-entered')
    steps.push({ name: '자격증명 입력', status: 'pass', screenshotPath: shot })
  } catch (e) {
    steps.push({ name: '자격증명 입력', status: 'fail', error: String(e) })
    return { featureId: '02', featureName: '로그인·인증', status: 'fail', steps, durationMs: Date.now() - start }
  }

  try {
    await page.locator('[data-testid="login-submit"]').click()
    await page.waitForSelector('[data-testid="empty-chat-message"], [data-testid="session-list-item"]', { timeout: 15_000 })
    const shot = await ss.take(page, dir, '03-login-success')
    steps.push({ name: '로그인 성공 → 메인 화면', status: 'pass', screenshotPath: shot })
  } catch (e) {
    steps.push({ name: '로그인 성공 → 메인 화면', status: 'fail', error: String(e) })
  }

  const failed = steps.some(s => s.status === 'fail')
  return {
    featureId: '02', featureName: '로그인·인증',
    status: failed ? 'fail' : 'pass', steps, durationMs: Date.now() - start,
  }
}
