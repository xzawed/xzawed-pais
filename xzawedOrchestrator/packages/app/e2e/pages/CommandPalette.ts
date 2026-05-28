import type { Page, Locator } from '@playwright/test'

export class CommandPalette {
  readonly page: Page
  readonly palette: Locator
  readonly input: Locator
  readonly items: Locator

  constructor(page: Page) {
    this.page = page
    this.palette = page.getByTestId('command-palette')
    this.input = page.getByTestId('command-palette-input')
    this.items = page.getByTestId('command-palette-item')
  }

  async open(): Promise<void> {
    await this.page.keyboard.press('Control+k')
    await this.palette.waitFor({ state: 'visible' })
  }

  async close(): Promise<void> {
    await this.page.keyboard.press('Escape')
    await this.palette.waitFor({ state: 'hidden' })
  }

  async search(text: string): Promise<void> {
    await this.input.fill(text)
  }
}
