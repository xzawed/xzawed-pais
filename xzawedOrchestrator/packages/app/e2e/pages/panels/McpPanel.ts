import type { Page, Locator } from '@playwright/test'

export class McpPanel {
  readonly panel: Locator
  readonly navButton: Locator
  readonly installedTab: Locator
  readonly recommendedTab: Locator
  readonly customTab: Locator
  readonly emptyMessage: Locator
  readonly backButton: Locator

  constructor(page: Page) {
    this.panel = page.getByTestId('mcp-panel')
    this.navButton = page.getByTestId('nav-mcp')
    this.installedTab = page.getByTestId('mcp-tab-installed')
    this.recommendedTab = page.getByTestId('mcp-tab-recommended')
    this.customTab = page.getByTestId('mcp-tab-custom')
    this.emptyMessage = page.getByTestId('mcp-empty-message')
    this.backButton = page.getByTestId('mcp-back-button')
  }

  async open(): Promise<void> {
    await this.navButton.click()
    await this.panel.waitFor({ state: 'visible' })
  }
}
