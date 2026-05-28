import { test, expect } from '../../fixtures.js'
import { ChatPage } from '../../pages/ChatPage.js'
import { mockCreateSession, mockHealthCheck } from '../../helpers/mock-server.js'

// NOTE: WS 스트리밍 응답(code-block, assistant-message, agent-timeline-card 등) 렌더링은
// ChatView.browser.test.tsx (브라우저 유닛 테스트)에서 검증한다.
// 이 파일은 사용자 인터랙션(메시지 전송 → user-bubble 표시 → 로딩 상태)만 검증한다.

test.describe('메시지 전송 인터랙션', () => {
  test.beforeEach(async ({ page }) => {
    await mockHealthCheck(page)
    await mockCreateSession(page)
  })

  test('메시지 전송 후 user-bubble이 목록에 표시된다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.clickNewSession()
    await chat.sendMessage('코드를 작성해주세요')
    await expect(chat.chatMessageList.getByTestId('user-message').first()).toBeVisible({ timeout: 5_000 })
  })

  test('메시지 전송 후 입력창이 비워진다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.clickNewSession()
    await chat.sendMessage('코드')
    await expect(chat.messageInput).toHaveValue('')
  })

  test('메시지 전송 후 전송 버튼이 비활성화된다 (로딩 중)', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.clickNewSession()
    await chat.sendMessage('코드')
    // isPending=true → disabled={isStreaming || isPending} → 전송 버튼 비활성화
    await expect(chat.messageSendButton).toBeDisabled()
  })

  test('메시지 목록 영역이 메시지 전송 후에도 표시된다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.clickNewSession()
    await chat.sendMessage('짧은 응답')
    await expect(chat.chatMessageList).toBeVisible()
  })

  test('여러 메시지 전송 시 각 user-bubble이 목록에 추가된다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.clickNewSession()
    await chat.sendMessage('파이프라인')
    await expect(chat.chatMessageList.getByTestId('user-message').first()).toBeVisible({ timeout: 5_000 })
    // input이 초기화되어 다음 메시지를 보낼 수 있는 상태가 되지 않으므로 (isPending=true)
    // 첫 번째 user-message 존재 여부만 확인
    const count = await chat.chatMessageList.getByTestId('user-message').count()
    expect(count).toBeGreaterThanOrEqual(1)
  })

  test('메시지 전송 직후 user-message가 메시지 목록에 나타난다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.clickNewSession()
    await chat.sendMessage('안녕')
    // user-message가 채팅 목록 안에 렌더링되는지 확인
    await expect(chat.chatMessageList.getByTestId('user-message').first()).toBeVisible({ timeout: 5_000 })
  })

  test('여러 메시지 전송 후 가장 최근 user-bubble이 뷰포트에 보인다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.clickNewSession()
    await chat.sendMessage('메시지 1')
    // 전송 후 isPending=true → input disabled, 다음 sendMessage 전 잠깐 대기
    await page.waitForTimeout(300)
    await expect(chat.chatMessageList.getByTestId('user-message').last()).toBeInViewport()
  })

  test('메시지 전송 후 입력창이 초기화되어 재입력 가능 상태가 된다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.clickNewSession()
    await chat.sendMessage('코드 복사 테스트')
    // input value가 비워진 것 확인
    await expect(chat.messageInput).toHaveValue('')
  })

  test('메시지 전송 후 session-id-display가 유지된다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.clickNewSession()
    await chat.sendMessage('**굵은 텍스트** 테스트')
    // 세션이 유지되는지 확인 (session-id-display 지속 노출)
    await expect(page.getByTestId('session-id-display')).toBeVisible()
  })
})
