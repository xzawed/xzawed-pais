import { test, expect } from './fixtures.js'

test.describe('Chat Flow', () => {
  test('chat nav button is visible in activity bar', async ({ page }) => {
    await expect(page.getByTestId('nav-chat')).toBeVisible()
  })

  test('new session button is visible in sidebar', async ({ page }) => {
    await expect(page.getByTestId('new-session-button')).toBeVisible()
  })

  test('chat view shows empty state prompt without a session', async ({ page }) => {
    await expect(page.getByText('새 세션을 시작해주세요')).toBeVisible()
  })

  test('message input is not visible until session is active', async ({ page }) => {
    await expect(page.getByTestId('message-input')).not.toBeVisible()
  })
})
