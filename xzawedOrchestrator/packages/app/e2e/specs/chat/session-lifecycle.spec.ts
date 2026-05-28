import { test, expect } from '../../fixtures.js'
import { ChatPage } from '../../pages/ChatPage.js'
import { mockCreateSession, mockHealthCheck } from '../../helpers/mock-server.js'

test.describe('세션 라이프사이클', () => {
  test.beforeEach(async ({ page }) => {
    await mockHealthCheck(page)
    await mockCreateSession(page)
  })

  test('새 세션 버튼 클릭 시 세션이 생성된다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.clickNewSession()
    await expect(page.getByTestId('session-id-display')).toBeVisible()
  })

  test('세션 생성 후 메시지 입력창이 활성화된다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.clickNewSession()
    await expect(chat.messageInput).toBeVisible()
    await expect(chat.messageInput).toBeEnabled()
  })

  test('세션 생성 후 빈 상태 메시지가 사라진다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.clickNewSession()
    await expect(chat.emptyChatMessage).not.toBeVisible()
  })

  test('세션 목록에 현재 세션이 표시된다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.clickNewSession()
    await expect(page.getByTestId('session-list-item')).toBeVisible()
  })

  test('세션 목록 항목을 클릭하면 해당 세션으로 전환된다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.clickNewSession()
    const item = page.getByTestId('session-list-item').first()
    await item.click()
    await expect(chat.messageInput).toBeVisible()
  })

  test('세션 생성 후 세션 목록에 항목이 존재한다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.clickNewSession()
    const count = await page.getByTestId('session-list-item').count()
    expect(count).toBeGreaterThanOrEqual(1)
  })

  test('세션 생성 중 버튼이 비활성화된다', async ({ page }) => {
    await page.route('**/sessions', async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return }
      await new Promise((r) => setTimeout(r, 300))
      await route.fulfill({ status: 201, body: JSON.stringify({ sessionId: 'ses-001' }) })
    })
    const chat = new ChatPage(page)
    await chat.newSessionButton.click()
    await expect(chat.newSessionButton).toBeDisabled()
  })

  test('세션 생성 실패 시 버튼이 다시 활성화된다', async ({ page }) => {
    await page.route('**/sessions', (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      return route.fulfill({ status: 500, body: JSON.stringify({ error: 'Server Error' }) })
    })
    const chat = new ChatPage(page)
    await chat.clickNewSession()
    await expect(chat.newSessionButton).toBeEnabled()
  })

  test('초기 상태에서 메시지 입력창이 숨겨져 있다', async ({ page }) => {
    const chat = new ChatPage(page)
    await expect(chat.messageInput).not.toBeVisible()
  })

  test('초기 상태에서 빈 상태 메시지가 표시된다', async ({ page }) => {
    const chat = new ChatPage(page)
    await expect(chat.emptyChatMessage).toBeVisible()
  })

  test('세션 nav 버튼이 activity bar에 표시된다', async ({ page }) => {
    const chat = new ChatPage(page)
    await expect(chat.navChat).toBeVisible()
  })

  test('새 세션 버튼이 sidebar에 표시된다', async ({ page }) => {
    const chat = new ChatPage(page)
    await expect(chat.newSessionButton).toBeVisible()
  })
})
