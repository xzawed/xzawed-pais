import type { Page } from '@playwright/test'

export async function mockLoginSuccess(page: Page, token = 'test-token-123'): Promise<void> {
  await page.route('**/auth/login', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        token,
        userId: 'test-user',
        user: { id: 'test-user', email: 'test@example.com' },
        accessToken: token,
      }),
    })
  )
}

export async function mockLoginFailure(page: Page): Promise<void> {
  await page.route('**/auth/login', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Invalid credentials' }),
    })
  )
}

export async function mockCreateSession(page: Page, sessionId = 'session-001'): Promise<void> {
  await page.route('**/sessions', (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ sessionId }),
      })
    }
    return route.continue()
  })
}

export async function mockHealthCheck(page: Page, healthy = true): Promise<void> {
  await page.route('**/health', (route) =>
    route.fulfill({
      status: healthy ? 200 : 503,
      contentType: 'application/json',
      body: JSON.stringify({ status: healthy ? 'ok' : 'error' }),
    })
  )
}
