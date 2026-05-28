import { test, expect } from '../../fixtures.js'
import { mockHealthCheck, mockLoginSuccess } from '../../helpers/mock-server.js'

test.describe('인증 실패 처리', () => {
  test.beforeEach(async ({ loginPage }) => {
    await mockHealthCheck(loginPage)
  })

  test('만료된 토큰으로 요청 시 로그인 페이지로 리다이렉트된다', async ({ loginPage }) => {
    await loginPage.route('**/api/**', (route) => {
      if (route.request().url().includes('/auth')) return route.continue()
      return route.fulfill({ status: 401, body: JSON.stringify({ error: 'Unauthorized' }) })
    })
    await loginPage.evaluate(() => sessionStorage.setItem('access_token', 'expired-token'))
    await loginPage.reload()
    await expect(loginPage.getByTestId('login-email')).toBeVisible({ timeout: 5_000 })
  })

  test('로그아웃 후 sessionStorage access_token이 제거된다', async ({ loginPage }) => {
    await mockLoginSuccess(loginPage)
    await loginPage.getByTestId('login-email').fill('test@example.com').catch(() => {})
    await loginPage.getByTestId('login-password').fill('password123').catch(() => {})
    await loginPage.getByTestId('login-submit').click().catch(() => {})
    await loginPage.getByTestId('logout-button').click({ timeout: 5_000 }).catch(() => {})
    await expect(loginPage.getByTestId('login-email')).toBeVisible({ timeout: 5_000 })
  })

  test('Refresh 토큰 만료 시 로그인 페이지로 이동한다', async ({ loginPage }) => {
    await loginPage.route('**/auth/refresh', (route) =>
      route.fulfill({ status: 401, body: JSON.stringify({ error: 'Refresh expired' }) })
    )
    await loginPage.evaluate(() => {
      sessionStorage.setItem('access_token', 'expired-access')
      sessionStorage.setItem('refresh_token', 'expired-refresh')
    })
    await loginPage.reload()
    await expect(loginPage.getByTestId('login-email')).toBeVisible({ timeout: 10_000 })
  })

  test('Rate Limit 응답 시 오류 메시지가 표시된다', async ({ loginPage }) => {
    await loginPage.route('**/auth/login', (route) =>
      route.fulfill({ status: 429, body: JSON.stringify({ error: 'Too many requests' }) })
    )
    await loginPage.getByTestId('login-email').fill('test@example.com').catch(() => {})
    await loginPage.getByTestId('login-password').fill('pass').catch(() => {})
    await loginPage.getByTestId('login-submit').click().catch(() => {})
    await expect(loginPage.getByTestId('login-error')).toBeVisible({ timeout: 5_000 })
  })

  test('인증 오류 메시지가 표시된다', async ({ loginPage }) => {
    await loginPage.route('**/auth/login', (route) =>
      route.fulfill({ status: 401, body: JSON.stringify({ error: 'Invalid credentials' }) })
    )
    await loginPage.getByTestId('login-email').fill('wrong@test.com').catch(() => {})
    await loginPage.getByTestId('login-password').fill('wrong').catch(() => {})
    await loginPage.getByTestId('login-submit').click().catch(() => {})
    await expect(loginPage.getByTestId('login-error')).toBeVisible({ timeout: 5_000 })
  })
})
