import type { Page, Locator } from '@playwright/test'

export class ChatPage {
  readonly page: Page
  readonly navChat: Locator
  readonly newSessionButton: Locator
  readonly emptyChatMessage: Locator
  readonly messageInput: Locator
  readonly messageSendButton: Locator
  readonly chatMessageList: Locator
  readonly approvalActions: Locator
  readonly approvalApprove: Locator
  readonly approvalRevise: Locator
  readonly approvalAbort: Locator
  readonly approvalFeedback: Locator
  readonly approvalRememberAuto: Locator

  constructor(page: Page) {
    this.page = page
    this.navChat = page.getByTestId('nav-chat')
    this.newSessionButton = page.getByTestId('new-session-button')
    this.emptyChatMessage = page.getByTestId('empty-chat-message')
    this.messageInput = page.getByTestId('message-input')
    this.messageSendButton = page.getByTestId('message-send-button')
    this.chatMessageList = page.getByTestId('chat-message-list')
    this.approvalActions = page.getByTestId('approval-actions')
    this.approvalApprove = page.getByTestId('approval-approve')
    this.approvalRevise = page.getByTestId('approval-revise')
    this.approvalAbort = page.getByTestId('approval-abort')
    this.approvalFeedback = page.getByTestId('approval-feedback-input')
    this.approvalRememberAuto = page.getByTestId('approval-remember-auto')
  }

  async sendMessage(text: string): Promise<void> {
    await this.messageInput.fill(text)
    await this.messageSendButton.click()
  }

  async clickNewSession(): Promise<void> {
    await this.newSessionButton.click()
  }

  /** test 모드 전용: chat 스토어에 승인 게이트 대기 상태를 직접 주입한다(WS mock 불가 대응). */
  async injectApprovalRequest(stage: string, summary: string): Promise<void> {
    await this.page.evaluate(
      ({ stage, summary }) => {
        const store = (globalThis as unknown as { __chatStore?: { setState: (s: unknown) => void } }).__chatStore
        store?.setState({
          sessionId: 'e2e-session',
          pendingInfoRequest: { agentId: 'manager', prompt: 'review', approval: { stage, summary, mode: 'manual' } },
        })
      },
      { stage, summary },
    )
  }
}
