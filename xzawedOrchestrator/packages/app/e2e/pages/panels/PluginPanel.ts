import type { Page, Locator } from '@playwright/test'

export class PluginPanel {
  readonly panel: Locator
  readonly navButton: Locator
  readonly searchInput: Locator

  constructor(page: Page) {
    this.panel = page.getByTestId('plugin-panel')
    this.navButton = page.getByTestId('nav-plugins')
    this.searchInput = page.getByTestId('plugin-search')
  }

  async open(): Promise<void> {
    await this.navButton.click()
    await this.panel.waitFor({ state: 'visible' })
  }
}
