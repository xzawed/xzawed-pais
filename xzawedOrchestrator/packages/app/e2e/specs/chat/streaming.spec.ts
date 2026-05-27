import { test, expect } from '../../fixtures.js'
import { ChatPage } from '../../pages/ChatPage.js'
import { mockCreateSession, mockHealthCheck } from '../../helpers/mock-server.js'

test.describe('스트리밍 메시지', () => {
  test.beforeEach(async ({ page }) => {
    await mockHealthCheck(page)
    await mockCreateSession(page)
  })

  test('에이전트 타임라인 카드가 렌더링된다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.clickNewSession()
    await chat.sendMessage('코드를 작성해주세요')
    await expect(page.getByTestId('agent-timeline-card').first()).toBeVisible({ timeout: 10_000 })
  })

  test('코드블록이 렌더링된다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.clickNewSession()
    await chat.sendMessage('코드')
    await expect(page.getByTestId('code-block').first()).toBeVisible({ timeout: 10_000 })
  })

  test('코드블록 복사 버튼이 표시된다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.clickNewSession()
    await chat.sendMessage('코드')
    await expect(page.getByTestId('code-copy-button').first()).toBeVisible({ timeout: 10_000 })
  })

  test('스트리밍 중 메시지 전송 버튼이 비활성화된다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.clickNewSession()
    await chat.sendMessage('긴 응답')
    await expect(chat.messageSendButton).toBeDisabled()
  })

  test('스트리밍 완료 후 전송 버튼이 다시 활성화된다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.clickNewSession()
    await chat.sendMessage('짧은 응답')
    await expect(chat.messageSendButton).toBeEnabled({ timeout: 30_000 })
  })

  test('파이프라인 스텝이 렌더링된다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.clickNewSession()
    await chat.sendMessage('파이프라인')
    await expect(page.getByTestId('pipeline-step-0')).toBeVisible({ timeout: 15_000 })
  })

  test('어시스턴트 메시지가 목록에 추가된다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.clickNewSession()
    await chat.sendMessage('안녕')
    await expect(chat.chatMessageList.getByTestId('assistant-message')).toBeVisible({ timeout: 30_000 })
  })

  test('메시지 목록이 자동 스크롤된다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.clickNewSession()
    for (let i = 0; i < 3; i++) {
      await chat.sendMessage(`메시지 ${i + 1}`)
      await page.waitForTimeout(300)
    }
    await expect(chat.chatMessageList.getByTestId('user-message').last()).toBeInViewport()
  })

  test('코드블록 복사 클릭 시 토스트 알림이 표시된다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.clickNewSession()
    await chat.sendMessage('코드 복사 테스트')
    await page.getByTestId('code-copy-button').first().click({ timeout: 10_000 })
    await expect(page.locator('[data-sonner-toast]')).toBeVisible({ timeout: 3_000 })
  })

  test('마크다운이 올바르게 렌더링된다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.clickNewSession()
    await chat.sendMessage('**굵은 텍스트** 테스트')
    await expect(chat.chatMessageList.locator('strong')).toBeVisible({ timeout: 15_000 })
  })
})
