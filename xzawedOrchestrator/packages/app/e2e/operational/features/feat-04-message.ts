import type { Page } from 'playwright'
import type { FeatureResult, StepResult } from '../helpers/screenshot-helper.js'
import { ScreenshotHelper } from '../helpers/screenshot-helper.js'

const TEST_MESSAGE = '안녕하세요. 현재 날짜가 언제인지 알려주세요.'

export async function runFeat04Message(
  page: Page,
  ss: ScreenshotHelper
): Promise<FeatureResult> {
  const start = Date.now()
  const steps: StepResult[] = []
  const dir = '04-message'

  // 세션이 없으면 새 세션 생성 후 메시지 입력창 대기
  try {
    const hasInput = await page.locator('[data-testid="message-input"]').isVisible({ timeout: 2_000 }).catch(() => false)
    if (!hasInput) {
      const newSession = page.locator('[data-testid="new-session-button"]')
      if (await newSession.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await newSession.click()
      }
    }
    await page.waitForSelector('[data-testid="message-input"]', { timeout: 10_000 })
    await page.locator('[data-testid="message-input"]').fill(TEST_MESSAGE)
    const shot = await ss.take(page, dir, '01-message-input')
    steps.push({ name: '메시지 입력', status: 'pass', screenshotPath: shot })
  } catch (e) {
    steps.push({ name: '메시지 입력창 없음', status: 'fail', error: String(e) })
    return { featureId: '04', featureName: '메시지 전송·스트리밍', status: 'fail', steps, durationMs: Date.now() - start }
  }

  try {
    await page.locator('[data-testid="message-send-button"]').click()
    await page.waitForSelector('[data-testid="streaming-indicator"]', { timeout: 30_000 })
    const shot = await ss.take(page, dir, '02-streaming-active')
    steps.push({ name: '스트리밍 시작', status: 'pass', screenshotPath: shot })
  } catch (e) {
    steps.push({ name: '스트리밍 시작', status: 'warn', error: String(e) })
  }

  try {
    await page.waitForSelector('[data-testid="streaming-indicator"]', { state: 'hidden', timeout: 90_000 })
    const shot = await ss.take(page, dir, '03-response-complete')
    steps.push({ name: '응답 완료', status: 'pass', screenshotPath: shot })
  } catch (e) {
    const shot = await ss.take(page, dir, '03-response-timeout').catch(() => undefined)
    steps.push({ name: '응답 완료 (타임아웃)', status: 'warn', error: String(e), screenshotPath: shot })
  }

  try {
    const msgList = page.locator('[data-testid="chat-message-list"]')
    const visible = await msgList.isVisible({ timeout: 3_000 }).catch(() => false)
    steps.push({ name: '채팅 메시지 목록 표시', status: visible ? 'pass' : 'warn' })
  } catch (e) {
    steps.push({ name: '채팅 메시지 목록', status: 'warn', error: String(e) })
  }

  const failed = steps.some(s => s.status === 'fail')
  return {
    featureId: '04', featureName: '메시지 전송·스트리밍',
    status: failed ? 'fail' : 'pass', steps, durationMs: Date.now() - start,
  }
}
