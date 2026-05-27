import type { Page } from '@playwright/test'

export async function mockLoginSuccess(page: Page, token = 'test-token-123'): Promise<void> {
  await page.route('**/api/auth/login', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ token, userId: 'test-user' }),
    })
  })
}

export async function mockLoginFailure(page: Page): Promise<void> {
  await page.route('**/api/auth/login', (route) => {
    void route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Invalid credentials' }),
    })
  })
}

export async function mockCreateSession(page: Page, sessionId = 'session-001'): Promise<void> {
  await page.route('**/api/sessions', (route) => {
    if (route.request().method() === 'POST') {
      void route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ sessionId }),
      })
    } else {
      void route.continue()
    }
  })
}

export async function mockHealthCheck(page: Page, healthy = true): Promise<void> {
  await page.route('**/health', (route) => {
    void route.fulfill({
      status: healthy ? 200 : 503,
      contentType: 'application/json',
      body: JSON.stringify({ status: healthy ? 'ok' : 'error' }),
    })
  })
}
