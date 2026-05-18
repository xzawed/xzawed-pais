import { test, expect } from './fixtures.js'

test.describe('GitHub Panel', () => {
  test('github nav button is visible in activity bar', async ({ page }) => {
    await expect(page.getByTestId('nav-github')).toBeVisible()
  })

  test('clicking github nav button shows github panel', async ({ page }) => {
    await page.getByTestId('nav-github').click()
    await expect(page.getByTestId('github-panel')).toBeVisible()
  })

  test('github panel shows GitHub heading', async ({ page }) => {
    await page.getByTestId('nav-github').click()
    await expect(page.getByText(/GitHub/)).toBeVisible()
  })
})
