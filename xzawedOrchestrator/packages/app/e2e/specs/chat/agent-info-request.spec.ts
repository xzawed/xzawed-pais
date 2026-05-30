import { test, expect } from '../../fixtures.js'
import { mockHealthCheck, mockCreateSession } from '../../helpers/mock-server.js'
import { ChatPage } from '../../pages/ChatPage.js'

test.describe('에이전트 추가 입력 요청 (info_request)', () => {
  test.beforeEach(async ({ page }) => {
    await mockHealthCheck(page)
    await mockCreateSession(page)
  })

  test('채팅 초기 상태에서 빈 상태 메시지가 표시된다', async ({ page }) => {
    const chat = new ChatPage(page)
    await expect(chat.emptyChatMessage).toBeVisible({ timeout: 10_000 })
  })

  test('세션 생성 후 메시지 입력창이 표시된다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.clickNewSession()
    await expect(chat.messageInput).toBeVisible({ timeout: 10_000 })
  })

  test('세션 생성 후 메시지 입력창이 활성화 상태이다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.clickNewSession()
    await expect(chat.messageInput).toBeEnabled({ timeout: 10_000 })
  })
})
