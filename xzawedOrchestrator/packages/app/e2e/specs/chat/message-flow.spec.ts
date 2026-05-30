import { test, expect } from '../../fixtures.js'
import { ChatPage } from '../../pages/ChatPage.js'
import { mockCreateSession, mockHealthCheck } from '../../helpers/mock-server.js'

test.describe('메시지 플로우', () => {
  test.beforeEach(async ({ page }) => {
    await mockHealthCheck(page)
    await mockCreateSession(page)
  })

  test('메시지 입력창에 텍스트를 입력할 수 있다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.clickNewSession()
    await chat.messageInput.fill('안녕하세요')
    await expect(chat.messageInput).toHaveValue('안녕하세요')
  })

  test('전송 버튼이 표시된다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.clickNewSession()
    await expect(chat.messageSendButton).toBeVisible()
  })

  test('텍스트 없이는 전송 버튼이 비활성화된다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.clickNewSession()
    await expect(chat.messageSendButton).toBeDisabled()
  })

  test('텍스트 입력 후 전송 버튼이 활성화된다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.clickNewSession()
    await chat.messageInput.fill('테스트 메시지')
    await expect(chat.messageSendButton).toBeEnabled()
  })

  test('메시지 전송 후 입력창이 초기화된다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.clickNewSession()
    await chat.sendMessage('테스트 메시지')
    await expect(chat.messageInput).toHaveValue('')
  })

  test('전송된 메시지가 메시지 목록에 표시된다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.clickNewSession()
    await chat.sendMessage('안녕하세요')
    await expect(chat.chatMessageList.getByTestId('user-message')).toBeVisible()
  })

  test('Enter 키로 메시지를 전송할 수 있다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.clickNewSession()
    await chat.messageInput.fill('Enter 전송 테스트')
    await chat.messageInput.press('Enter')
    await expect(chat.messageInput).toHaveValue('')
  })

  test('Shift+Enter는 줄바꿈을 삽입한다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.clickNewSession()
    await chat.messageInput.fill('첫 줄')
    await chat.messageInput.press('Shift+Enter')
    const value = await chat.messageInput.inputValue()
    expect(value).toContain('\n')
  })

  test('공백만 있는 메시지는 전송되지 않는다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.clickNewSession()
    await chat.messageInput.fill('   ')
    await expect(chat.messageSendButton).toBeDisabled()
  })

  test('메시지 목록 영역이 표시된다', async ({ page }) => {
    const chat = new ChatPage(page)
    await chat.clickNewSession()
    await expect(chat.chatMessageList).toBeVisible()
  })
})
