import { test, expect } from '../../fixtures.js'
import { mockHealthCheck, mockCreateSession } from '../../helpers/mock-server.js'

test.describe('서버 단절 오류 상태', () => {
  test('서버 다운 시 상태바에 오류 표시가 나타난다', async ({ page }) => {
    await mockHealthCheck(page, false)
    await expect(page.getByTestId('status-bar-error')).toBeVisible({ timeout: 10_000 })
  })

  test('서버 다운 시 메시지 전송 버튼이 비활성화된다', async ({ page }) => {
    await mockHealthCheck(page, false)
    await mockCreateSession(page)
    await page.getByTestId('new-session-button').click()
    await expect(page.getByTestId('message-send-button')).toBeDisabled({ timeout: 5_000 })
  })

  test('서버 복구 후 상태바가 정상으로 돌아온다', async ({ page }) => {
    await mockHealthCheck(page, false)
    await page.waitForTimeout(1_500)
    await page.route('**/health', (route) => {
      void route.fulfill({ status: 200, body: JSON.stringify({ status: 'ok' }) })
    })
    await expect(page.getByTestId('status-bar-running')).toBeVisible({ timeout: 10_000 })
  })

  test('네트워크 오류 발생 시 토스트 알림이 표시된다', async ({ page }) => {
    await mockHealthCheck(page)
    await mockCreateSession(page)
    await page.getByTestId('new-session-button').click()
    await page.route('**/ws/**', (route) => void route.abort())
    await page.getByTestId('message-input').fill('테스트')
    await page.getByTestId('message-send-button').click()
    await expect(page.locator('[data-sonner-toast]')).toBeVisible({ timeout: 5_000 })
  })

  test('status bar가 표시된다', async ({ page }) => {
    await expect(page.getByTestId('status-bar')).toBeVisible()
  })
})
