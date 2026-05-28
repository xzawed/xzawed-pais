import { test, expect } from './fixtures.js'

test.describe('Settings', () => {
  test('settings trigger button is visible in activity bar', async ({ page }) => {
    await expect(page.getByTestId('settings-trigger')).toBeVisible()
  })

  test('settings modal opens when trigger is clicked', async ({ page }) => {
    await page.getByTestId('settings-trigger').click()
    await expect(page.getByTestId('settings-modal')).toBeVisible()
    await expect(page.getByTestId('settings-title')).toBeVisible()
  })

  test('settings modal contains server URL field', async ({ page }) => {
    await page.getByTestId('settings-trigger').click()
    await expect(page.getByTestId('settings-server-url')).toBeVisible()
  })
})
