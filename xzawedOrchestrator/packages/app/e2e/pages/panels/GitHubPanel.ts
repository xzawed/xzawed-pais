import type { Page, Locator } from '@playwright/test'

export class GitHubPanel {
  readonly panel: Locator
  readonly navButton: Locator
  readonly connectHint: Locator

  constructor(page: Page) {
    this.panel = page.getByTestId('github-panel')
    this.navButton = page.getByTestId('nav-github')
    this.connectHint = page.getByTestId('github-connect-hint')
  }

  async open(): Promise<void> {
    await this.navButton.click()
    await this.panel.waitFor({ state: 'visible' })
  }
}
