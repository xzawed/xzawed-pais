import { test, expect } from '../../fixtures.js'
import { McpPanel } from '../../pages/panels/McpPanel.js'

test.describe('MCP 패널', () => {
  test('MCP nav 버튼이 activity bar에 표시된다', async ({ page }) => {
    await expect(new McpPanel(page).navButton).toBeVisible()
  })

  test('nav 버튼 클릭 시 MCP 패널이 열린다', async ({ page }) => {
    const mcp = new McpPanel(page)
    await mcp.open()
    await expect(mcp.panel).toBeVisible()
  })

  test('설치됨·추천·직접추가 탭이 표시된다', async ({ page }) => {
    const mcp = new McpPanel(page)
    await mcp.open()
    await expect(mcp.installedTab).toBeVisible()
    await expect(mcp.recommendedTab).toBeVisible()
    await expect(mcp.customTab).toBeVisible()
  })

  test('설치된 서버 없을 때 빈 상태 메시지가 표시된다', async ({ page }) => {
    const mcp = new McpPanel(page)
    await mcp.open()
    await expect(mcp.emptyMessage).toBeVisible()
  })

  test('추천 탭 클릭 시 추천 서버 목록이 표시된다', async ({ page }) => {
    const mcp = new McpPanel(page)
    await mcp.open()
    await mcp.recommendedTab.click()
    await expect(page.getByTestId('mcp-recommended-item').first()).toBeVisible()
  })

  test('채팅으로 버튼 클릭 시 패널이 닫힌다', async ({ page }) => {
    const mcp = new McpPanel(page)
    await mcp.open()
    await mcp.backButton.click()
    await expect(mcp.panel).not.toBeVisible()
  })
})
