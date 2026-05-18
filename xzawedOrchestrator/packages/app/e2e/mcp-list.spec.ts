import { test, expect } from './fixtures.js'

test.describe('MCP Panel', () => {
  test('mcp nav button is visible in activity bar', async ({ page }) => {
    await expect(page.getByTestId('nav-mcp')).toBeVisible()
  })

  test('clicking mcp nav button shows mcp panel', async ({ page }) => {
    await page.getByTestId('nav-mcp').click()
    await expect(page.getByTestId('mcp-panel')).toBeVisible()
  })

  test('mcp panel shows MCP server heading', async ({ page }) => {
    await page.getByTestId('nav-mcp').click()
    await expect(page.getByText(/MCP 서버/)).toBeVisible()
  })
})
