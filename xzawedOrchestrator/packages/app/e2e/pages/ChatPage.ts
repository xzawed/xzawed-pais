import type { Page, Locator } from '@playwright/test'

export class ChatPage {
  readonly page: Page
  readonly navChat: Locator
  readonly newSessionButton: Locator
  readonly emptyChatMessage: Locator
  readonly messageInput: Locator
  readonly messageSendButton: Locator
  readonly chatMessageList: Locator

  constructor(page: Page) {
    this.page = page
    this.navChat = page.getByTestId('nav-chat')
    this.newSessionButton = page.getByTestId('new-session-button')
    this.emptyChatMessage = page.getByTestId('empty-chat-message')
    this.messageInput = page.getByTestId('message-input')
    this.messageSendButton = page.getByTestId('message-send-button')
    this.chatMessageList = page.getByTestId('chat-message-list')
  }

  async sendMessage(text: string): Promise<void> {
    await this.messageInput.fill(text)
    await this.messageSendButton.click()
  }

  async clickNewSession(): Promise<void> {
    await this.newSessionButton.click()
  }
}
