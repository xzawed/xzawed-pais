import { test, expect } from '../../fixtures.js'
import { GitHubPanel } from '../../pages/panels/GitHubPanel.js'

test.describe('GitHub 패널', () => {
  test('GitHub nav 버튼이 activity bar에 표시된다', async ({ page }) => {
    await expect(new GitHubPanel(page).navButton).toBeVisible()
  })

  test('nav 버튼 클릭 시 GitHub 패널이 열린다', async ({ page }) => {
    const gh = new GitHubPanel(page)
    await gh.open()
    await expect(gh.panel).toBeVisible()
  })

  test('연결 안내 문구가 표시된다 (미연결 상태)', async ({ page }) => {
    const gh = new GitHubPanel(page)
    await gh.open()
    await expect(gh.connectHint).toBeVisible()
  })

  test('GitHub 패널 제목이 표시된다', async ({ page }) => {
    const gh = new GitHubPanel(page)
    await gh.open()
    await expect(page.getByTestId('github-panel-title')).toBeVisible()
  })

  test('OAuth 연결 버튼이 표시된다', async ({ page }) => {
    const gh = new GitHubPanel(page)
    await gh.open()
    await expect(page.getByTestId('github-oauth-button')).toBeVisible()
  })

  test('다른 패널 열면 GitHub 패널이 닫힌다', async ({ page }) => {
    const gh = new GitHubPanel(page)
    await gh.open()
    await page.getByTestId('nav-mcp').click()
    await expect(gh.panel).not.toBeVisible()
  })

  test('OAuth 성공 mock 시 레포 목록이 표시된다', async ({ electronApp, page }) => {
    // IPC 핸들러를 main 프로세스에서 교체하여 GitHub 연결 상태를 모킹
    await electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('github:get-status')
      ipcMain.handle('github:get-status', () => ({
        connected: true,
        username: 'test-user',
        avatarUrl: 'https://avatars.githubusercontent.com/u/1',
      }))
      ipcMain.removeHandler('github:list-repos')
      ipcMain.handle('github:list-repos', () => [
        { id: 1, name: 'test-repo', fullName: 'test-user/test-repo', private: false, defaultBranch: 'main' },
      ])
    })

    await page.reload()
    await page.waitForSelector('[data-i18n-ready]')

    const gh = new GitHubPanel(page)
    await gh.open()
    await expect(page.getByTestId('github-repo-list')).toBeVisible({ timeout: 10000 })
  })

  test('GitHub 패널에서 채팅으로 돌아갈 수 있다', async ({ page }) => {
    const gh = new GitHubPanel(page)
    await gh.open()
    await page.getByTestId('nav-chat').click()
    await expect(gh.panel).not.toBeVisible()
  })
})
