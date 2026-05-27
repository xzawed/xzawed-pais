import { test, expect } from '../../fixtures.js'
import { mockLoginSuccess, mockHealthCheck } from '../../helpers/mock-server.js'

test.describe('프로젝트 전환', () => {
  test.beforeEach(async ({ page }) => {
    await mockHealthCheck(page)
    await mockLoginSuccess(page)
    await page.route('**/api/projects', (route) => {
      void route.fulfill({
        status: 200,
        body: JSON.stringify([
          { id: 'p1', name: 'Project Alpha', workspacePath: '/workspace/alpha' },
          { id: 'p2', name: 'Project Beta', workspacePath: '/workspace/beta' },
        ]),
      })
    })
  })

  test('프로젝트 목록 페이지가 표시된다', async ({ page }) => {
    await expect(page.getByTestId('projects-page')).toBeVisible()
  })

  test('프로젝트 목록에 등록된 프로젝트가 표시된다', async ({ page }) => {
    await expect(page.getByTestId('project-item')).toHaveCount(2)
  })

  test('프로젝트 클릭 시 채팅 페이지로 이동한다', async ({ page }) => {
    await page.getByTestId('project-item').first().click()
    await expect(page.getByTestId('nav-chat')).toBeVisible()
  })

  test('프로젝트 컨텍스트 바가 채팅 페이지에 표시된다', async ({ page }) => {
    await page.getByTestId('project-item').first().click()
    await expect(page.getByTestId('project-context-bar')).toBeVisible()
  })

  test('프로젝트 컨텍스트 바에 프로젝트 이름이 표시된다', async ({ page }) => {
    await page.getByTestId('project-item').first().click()
    await expect(page.getByTestId('project-context-bar')).toContainText('Project Alpha')
  })

  test('새 프로젝트 버튼이 표시된다', async ({ page }) => {
    await expect(page.getByTestId('new-project-button')).toBeVisible()
  })

  test('로그아웃 버튼이 표시된다', async ({ page }) => {
    await expect(page.getByTestId('logout-button')).toBeVisible()
  })

  test('로그아웃 클릭 시 로그인 페이지로 이동한다', async ({ page }) => {
    await page.getByTestId('logout-button').click()
    await expect(page.getByTestId('login-email')).toBeVisible()
  })
})
