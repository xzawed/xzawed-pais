import { test, expect } from '../../fixtures.js'
import { LoginPage } from '../../pages/LoginPage.js'
import { mockLoginSuccess, mockLoginFailure, mockHealthCheck } from '../../helpers/mock-server.js'

test.describe('로그인', () => {
  test.beforeEach(async ({ page }) => {
    await mockHealthCheck(page)
  })

  test('이메일 입력 필드가 표시된다', async ({ page }) => {
    const login = new LoginPage(page)
    await expect(login.emailInput).toBeVisible()
  })

  test('비밀번호 입력 필드가 표시된다', async ({ page }) => {
    const login = new LoginPage(page)
    await expect(login.passwordInput).toBeVisible()
  })

  test('로그인 버튼이 표시된다', async ({ page }) => {
    const login = new LoginPage(page)
    await expect(login.submitButton).toBeVisible()
  })

  test('회원가입 링크가 표시된다', async ({ page }) => {
    const login = new LoginPage(page)
    await expect(login.registerLink).toBeVisible()
  })

  test('올바른 자격증명으로 로그인하면 프로젝트 페이지로 이동한다', async ({ page }) => {
    await mockLoginSuccess(page)
    const login = new LoginPage(page)
    await login.login('test@example.com', 'password123')
    await expect(page.getByTestId('projects-page')).toBeVisible()
  })

  test('잘못된 자격증명은 오류 메시지를 표시한다', async ({ page }) => {
    await mockLoginFailure(page)
    const login = new LoginPage(page)
    await login.login('wrong@example.com', 'wrongpass')
    await expect(login.errorMessage).toBeVisible()
  })

  test('이메일 없이 제출하면 페이지 이동이 차단된다', async ({ page }) => {
    const login = new LoginPage(page)
    await login.passwordInput.fill('password123')
    await login.submitButton.click()
    await expect(page.getByTestId('projects-page')).not.toBeVisible()
  })

  test('비밀번호 필드는 type=password이다', async ({ page }) => {
    const login = new LoginPage(page)
    await expect(login.passwordInput).toHaveAttribute('type', 'password')
  })

  test('로그인 후 토큰이 localStorage에 저장된다', async ({ page }) => {
    await mockLoginSuccess(page, 'my-jwt-token')
    const login = new LoginPage(page)
    await login.login('test@example.com', 'password123')
    const stored = await page.evaluate(() => localStorage.getItem('token'))
    expect(stored).toBe('my-jwt-token')
  })

  test('로그인 성공 후 뒤로가기를 눌러도 로그인 페이지로 돌아오지 않는다', async ({ page }) => {
    await mockLoginSuccess(page)
    const login = new LoginPage(page)
    await login.login('test@example.com', 'password123')
    await page.goBack()
    await expect(page.getByTestId('projects-page')).toBeVisible()
  })

  test('Enter 키로 폼을 제출할 수 있다', async ({ page }) => {
    await mockLoginSuccess(page)
    const login = new LoginPage(page)
    await login.emailInput.fill('test@example.com')
    await login.passwordInput.fill('password123')
    await login.passwordInput.press('Enter')
    await expect(page.getByTestId('projects-page')).toBeVisible()
  })

  test('로딩 중 버튼이 비활성화된다', async ({ page }) => {
    await page.route('**/api/auth/login', async (route) => {
      await new Promise((r) => setTimeout(r, 500))
      await route.fulfill({ status: 200, body: JSON.stringify({ token: 'tok', userId: 'u' }) })
    })
    const login = new LoginPage(page)
    await login.emailInput.fill('test@example.com')
    await login.passwordInput.fill('password123')
    await login.submitButton.click()
    await expect(login.submitButton).toBeDisabled()
  })
})
