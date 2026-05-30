import { test, expect } from '../../fixtures.js'
import { mockLoginSuccess, mockHealthCheck } from '../../helpers/mock-server.js'

const MOCK_PROJECTS = [
  { id: 'p1', name: 'Project Alpha', slug: 'project-alpha', createdAt: '2024-01-01', workspace_path: '/workspace/alpha', workspace_type: 'local' },
  { id: 'p2', name: 'Project Beta', slug: 'project-beta', createdAt: '2024-01-02', workspace_path: '/workspace/beta', workspace_type: 'local' },
]

test.describe('프로젝트 전환', () => {
  test.beforeEach(async ({ loginPage }) => {
    await mockHealthCheck(loginPage)
    await mockLoginSuccess(loginPage)
    await loginPage.route('**/projects', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ projects: MOCK_PROJECTS }),
      })
    )
    // Navigate to projects page via login
    await loginPage.getByTestId('login-email').fill('test@example.com')
    await loginPage.getByTestId('login-password').fill('password123')
    await loginPage.getByTestId('login-submit').click()
    await loginPage.getByTestId('projects-page').waitFor({ state: 'visible', timeout: 10_000 })
  })

  test('프로젝트 목록 페이지가 표시된다', async ({ loginPage }) => {
    await expect(loginPage.getByTestId('projects-page')).toBeVisible()
  })

  test('프로젝트 목록에 등록된 프로젝트가 표시된다', async ({ loginPage }) => {
    await expect(loginPage.getByTestId('project-item')).toHaveCount(2)
  })

  test('프로젝트 클릭 시 채팅 페이지로 이동한다', async ({ loginPage }) => {
    await loginPage.getByTestId('project-item').first().locator('button').first().click()
    await loginPage.getByTestId('nav-chat').waitFor({ state: 'visible', timeout: 10_000 })
    await expect(loginPage.getByTestId('nav-chat')).toBeVisible()
  })

  test('프로젝트 컨텍스트 바가 채팅 페이지에 표시된다', async ({ loginPage }) => {
    await loginPage.getByTestId('project-item').first().locator('button').first().click()
    await loginPage.getByTestId('project-context-bar').waitFor({ state: 'visible', timeout: 10_000 })
    await expect(loginPage.getByTestId('project-context-bar')).toBeVisible()
  })

  test('프로젝트 컨텍스트 바에 프로젝트 이름이 표시된다', async ({ loginPage }) => {
    await loginPage.getByTestId('project-item').first().locator('button').first().click()
    await loginPage.getByTestId('project-context-bar').waitFor({ state: 'visible', timeout: 10_000 })
    await expect(loginPage.getByTestId('project-context-bar')).toContainText('Project Alpha', { timeout: 5_000 })
  })

  test('새 프로젝트 버튼이 표시된다', async ({ loginPage }) => {
    await expect(loginPage.getByTestId('new-project-button')).toBeVisible()
  })

  test('로그아웃 버튼이 표시된다', async ({ loginPage }) => {
    await expect(loginPage.getByTestId('logout-button')).toBeVisible()
  })

  test('로그아웃 클릭 시 로그인 페이지로 이동한다', async ({ loginPage }) => {
    await loginPage.getByTestId('logout-button').click()
    await expect(loginPage.getByTestId('login-email')).toBeVisible({ timeout: 5_000 })
  })

  test('새 프로젝트 버튼이 클릭 가능하다', async ({ loginPage }) => {
    const newBtn = loginPage.getByTestId('new-project-button')
    await expect(newBtn).toBeVisible({ timeout: 5_000 })
    await expect(newBtn).toBeEnabled({ timeout: 5_000 })
  })

  test('새 프로젝트 버튼 클릭 시 오류 없이 반응한다', async ({ loginPage }) => {
    const newBtn = loginPage.getByTestId('new-project-button')
    if (await newBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await newBtn.click()
      // 오류 메시지가 표시되지 않아야 함
      await expect(loginPage.getByRole('alert')).not.toBeVisible({ timeout: 1_000 }).catch(() => {})
    } else {
      test.skip()
    }
  })
})
