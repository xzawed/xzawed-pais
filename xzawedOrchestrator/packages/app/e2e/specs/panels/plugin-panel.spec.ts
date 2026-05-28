import { test, expect } from '../../fixtures.js'
import { PluginPanel } from '../../pages/panels/PluginPanel.js'

test.describe('플러그인 패널', () => {
  test('플러그인 nav 버튼이 activity bar에 표시된다', async ({ page }) => {
    await expect(new PluginPanel(page).navButton).toBeVisible()
  })

  test('nav 버튼 클릭 시 플러그인 패널이 열린다', async ({ page }) => {
    const p = new PluginPanel(page)
    await p.navButton.click()
    await expect(p.panel).toBeVisible()
  })

  test('플러그인 검색창이 표시된다', async ({ page }) => {
    const p = new PluginPanel(page)
    await p.navButton.click()
    await expect(p.searchInput).toBeVisible()
  })

  test('플러그인 검색창에 텍스트를 입력할 수 있다', async ({ page }) => {
    const p = new PluginPanel(page)
    await p.navButton.click()
    await p.searchInput.fill('test')
    await expect(p.searchInput).toHaveValue('test')
  })
})
