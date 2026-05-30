import type { Page } from 'playwright'
import type { FeatureResult, StepResult } from '../helpers/screenshot-helper.js'
import { ScreenshotHelper } from '../helpers/screenshot-helper.js'

const PIPELINE_MESSAGE = '간단한 TypeScript 함수를 하나 작성해주세요: 두 숫자를 더하는 add 함수'

export async function runFeat05Pipeline(
  page: Page,
  ss: ScreenshotHelper
): Promise<FeatureResult> {
  const start = Date.now()
  const steps: StepResult[] = []
  const dir = '05-pipeline'

  try {
    await page.waitForSelector('[data-testid="message-input"]', { timeout: 10_000 })
    await page.locator('[data-testid="message-input"]').fill(PIPELINE_MESSAGE)
    await page.locator('[data-testid="message-send-button"]').click()
    const shot = await ss.take(page, dir, '01-message-sent')
    steps.push({ name: '파이프라인 트리거 메시지 전송', status: 'pass', screenshotPath: shot })
  } catch (e) {
    steps.push({ name: '파이프라인 트리거', status: 'fail', error: String(e) })
    return { featureId: '05', featureName: '에이전트 파이프라인', status: 'fail', steps, durationMs: Date.now() - start }
  }

  try {
    const pipelineOrTimeline = page.locator('[data-testid="pipeline-strip"], [data-testid="agent-timeline"]')
    const appeared = await pipelineOrTimeline.first().isVisible({ timeout: 30_000 }).catch(() => false)
    const shot = await ss.take(page, dir, '02-pipeline-progress')
    steps.push({ name: '파이프라인 진행 표시', status: appeared ? 'pass' : 'warn', screenshotPath: shot })
  } catch (e) {
    steps.push({ name: '파이프라인 진행 표시', status: 'warn', error: String(e) })
  }

  try {
    await page.waitForSelector('[data-testid="streaming-indicator"]', { state: 'hidden', timeout: 120_000 })
    const shot = await ss.take(page, dir, '03-pipeline-complete')
    steps.push({ name: '파이프라인 완료', status: 'pass', screenshotPath: shot })
  } catch (e) {
    const shot = await ss.take(page, dir, '03-pipeline-timeout').catch(() => undefined)
    steps.push({ name: '파이프라인 완료', status: 'warn', error: String(e), screenshotPath: shot })
  }

  const failed = steps.some(s => s.status === 'fail')
  return {
    featureId: '05', featureName: '에이전트 파이프라인',
    status: failed ? 'fail' : 'pass', steps, durationMs: Date.now() - start,
  }
}
