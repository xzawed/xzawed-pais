import { test, expect } from '../../fixtures.js'
import { mockHealthCheck } from '../../helpers/mock-server.js'
import { ChatPage } from '../../pages/ChatPage.js'

const UI_ACTIONS_GLOB = '**/sessions/*/ui-actions'

/** /ui-actions 요청 본문은 { action: '<decision JSON 문자열>' } 형태 — 결정을 풀어 반환한다. */
function parseDecision(postData: string | null): { decision: string; feedback?: string } {
  const outer = JSON.parse(postData ?? '{}') as { action?: string }
  return JSON.parse(outer.action ?? '{}') as { decision: string; feedback?: string }
}

test.describe('승인 게이트 (approval gate)', () => {
  test.beforeEach(async ({ page }) => {
    await mockHealthCheck(page)
    // 결정 전송 경로(HTTP /ui-actions)를 가로채 202로 응답 (WS는 mock 불가, HTTP만 intercept)
    await page.route(UI_ACTIONS_GLOB, (route) =>
      route.fulfill({ status: 202, contentType: 'application/json', body: '{"status":"accepted"}' }),
    )
  })

  test('승인 게이트 대기 시 승인/수정/중단 버튼이 표시된다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.injectApprovalRequest('plan_task', '계획 산출물 요약')
    await expect(chat.approvalActions).toBeVisible({ timeout: 10_000 })
    await expect(chat.approvalApprove).toBeVisible()
    await expect(chat.approvalRevise).toBeVisible()
    await expect(chat.approvalAbort).toBeVisible()
  })

  test('승인 클릭 시 decision:approve를 /ui-actions로 전송한다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.injectApprovalRequest('plan_task', 's')
    await expect(chat.approvalApprove).toBeVisible({ timeout: 10_000 })

    const reqPromise = page.waitForRequest(UI_ACTIONS_GLOB)
    await chat.approvalApprove.click()
    const req = await reqPromise
    expect(req.method()).toBe('POST')
    expect(parseDecision(req.postData()).decision).toBe('approve')
  })

  test('중단 클릭 시 decision:abort를 전송한다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.injectApprovalRequest('build_project', 's')
    await expect(chat.approvalAbort).toBeVisible({ timeout: 10_000 })

    const reqPromise = page.waitForRequest(UI_ACTIONS_GLOB)
    await chat.approvalAbort.click()
    const req = await reqPromise
    expect(parseDecision(req.postData()).decision).toBe('abort')
  })

  test('수정요청은 피드백 입력 후 decision:revise와 피드백을 전송한다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.injectApprovalRequest('design_ui', 's')
    await expect(chat.approvalRevise).toBeVisible({ timeout: 10_000 })

    await chat.approvalFeedback.fill('색상 변경 필요')
    const reqPromise = page.waitForRequest(UI_ACTIONS_GLOB)
    await chat.approvalRevise.click()
    const req = await reqPromise
    const decision = parseDecision(req.postData())
    expect(decision.decision).toBe('revise')
    expect(decision.feedback).toBe('색상 변경 필요')
  })
})
