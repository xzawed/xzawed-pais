import { test, expect } from '../../fixtures.js'
import { CommandPalette } from '../../pages/CommandPalette.js'

test.describe('Command Palette', () => {
  test('Control+K 단축키로 Command Palette가 열린다', async ({ page }) => {
    const cp = new CommandPalette(page)
    await page.keyboard.press('Control+k')
    await expect(cp.palette).toBeVisible()
  })

  test('검색창이 자동 포커스된다', async ({ page }) => {
    const cp = new CommandPalette(page)
    await cp.open()
    await expect(cp.input).toBeFocused()
  })

  test('검색어 입력 시 결과가 표시된다', async ({ page }) => {
    const cp = new CommandPalette(page)
    await cp.open()
    await cp.search('세션')
    await expect(cp.items.first()).toBeVisible()
  })

  test('Escape 키로 Command Palette가 닫힌다', async ({ page }) => {
    const cp = new CommandPalette(page)
    await cp.open()
    await page.keyboard.press('Escape')
    await expect(cp.palette).not.toBeVisible()
  })

  test('새 세션 항목 선택 시 세션이 생성된다', async ({ page }) => {
    const cp = new CommandPalette(page)
    await cp.open()
    await cp.search('새 세션')
    await cp.items.first().click()
    await expect(page.getByTestId('message-input')).toBeVisible({ timeout: 5_000 })
  })
})
