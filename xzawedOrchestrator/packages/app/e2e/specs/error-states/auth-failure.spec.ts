import { test, expect } from '../../fixtures.js'
import { mockHealthCheck } from '../../helpers/mock-server.js'

test.describe('인증 실패 처리', () => {
  test.beforeEach(async ({ page }) => {
    await mockHealthCheck(page)
  })

  test('만료된 토큰으로 요청 시 로그인 페이지로 리다이렉트된다', async ({ page }) => {
    await page.route('**/api/**', (route) => {
      if (route.request().url().includes('/auth')) return void route.continue()
      void route.fulfill({ status: 401, body: JSON.stringify({ error: 'Unauthorized' }) })
    })
    await page.evaluate(() => localStorage.setItem('token', 'expired-token'))
    await page.reload()
    await expect(page.getByTestId('login-email')).toBeVisible({ timeout: 5_000 })
  })

  test('로그아웃 후 localStorage 토큰이 제거된다', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('token', 'valid-token'))
    await page.getByTestId('logout-button').click({ timeout: 5_000 }).catch(() => {})
    expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull()
  })

  test('Refresh 토큰 만료 시 로그인 페이지로 이동한다', async ({ page }) => {
    await page.route('**/api/auth/refresh', (route) => {
      void route.fulfill({ status: 401, body: JSON.stringify({ error: 'Refresh expired' }) })
    })
    await page.evaluate(() => {
      localStorage.setItem('token', 'expired-access')
      localStorage.setItem('refreshToken', 'expired-refresh')
    })
    await page.reload()
    await expect(page.getByTestId('login-email')).toBeVisible({ timeout: 10_000 })
  })

  test('Rate Limit 응답 시 토스트 메시지가 표시된다', async ({ page }) => {
    await page.route('**/api/auth/login', (route) => {
      void route.fulfill({ status: 429, body: JSON.stringify({ error: 'Too many requests' }) })
    })
    await page.getByTestId('login-email').fill('test@example.com').catch(() => {})
    await page.getByTestId('login-password').fill('pass').catch(() => {})
    await page.getByTestId('login-submit').click().catch(() => {})
    await expect(page.locator('[data-sonner-toast]')).toBeVisible({ timeout: 5_000 })
  })

  test('인증 오류 메시지가 표시된다', async ({ page }) => {
    await page.route('**/api/auth/login', (route) => {
      void route.fulfill({ status: 401, body: JSON.stringify({ error: 'Invalid credentials' }) })
    })
    await page.getByTestId('login-email').fill('wrong@test.com').catch(() => {})
    await page.getByTestId('login-password').fill('wrong').catch(() => {})
    await page.getByTestId('login-submit').click().catch(() => {})
    await expect(page.getByTestId('login-error')).toBeVisible({ timeout: 5_000 })
  })
})
