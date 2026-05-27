import { test, expect } from '../../fixtures.js'

test.describe('Command Palette', () => {
  test('Meta+K 단축키로 Command Palette가 열린다', async ({ page }) => {
    await page.keyboard.press('Meta+k')
    await expect(page.getByTestId('command-palette')).toBeVisible()
  })

  test('검색창이 자동 포커스된다', async ({ page }) => {
    await page.keyboard.press('Meta+k')
    await expect(page.getByTestId('command-palette-input')).toBeFocused()
  })

  test('검색어 입력 시 결과가 표시된다', async ({ page }) => {
    await page.keyboard.press('Meta+k')
    await page.getByTestId('command-palette-input').fill('세션')
    await expect(page.getByTestId('command-palette-item').first()).toBeVisible()
  })

  test('Escape 키로 Command Palette가 닫힌다', async ({ page }) => {
    await page.keyboard.press('Meta+k')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('command-palette')).not.toBeVisible()
  })

  test('새 세션 항목 선택 시 세션이 생성된다', async ({ page }) => {
    await page.keyboard.press('Meta+k')
    await page.getByTestId('command-palette-input').fill('새 세션')
    await page.getByTestId('command-palette-item').first().click()
    await expect(page.getByTestId('message-input')).toBeVisible({ timeout: 5_000 })
  })
})
