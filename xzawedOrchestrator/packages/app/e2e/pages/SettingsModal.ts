import type { Page, Locator } from '@playwright/test'

export class SettingsModal {
  readonly trigger: Locator
  readonly modal: Locator
  readonly serverUrlInput: Locator
  readonly languageSelect: Locator
  readonly saveButton: Locator
  readonly cancelButton: Locator

  constructor(page: Page) {
    this.trigger = page.getByTestId('settings-trigger')
    this.modal = page.getByTestId('settings-modal')
    this.serverUrlInput = page.getByTestId('settings-server-url')
    this.languageSelect = page.getByTestId('settings-language')
    this.saveButton = page.getByTestId('settings-save')
    this.cancelButton = page.getByTestId('settings-cancel')
  }

  async open(): Promise<void> {
    await this.trigger.click()
    await this.modal.waitFor({ state: 'visible' })
  }

  async changeLanguage(locale: 'ko' | 'en' | 'ja'): Promise<void> {
    await this.languageSelect.selectOption(locale)
  }
}
