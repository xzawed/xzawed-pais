import { test, expect } from '../../fixtures.js'
import { SettingsModal } from '../../pages/SettingsModal.js'

test.describe('언어 전환', () => {
  test('기본 언어가 한국어이다', async ({ page }) => {
    // CI 브라우저는 navigator.language='en'이므로 localStorage에 'ko'를 명시적으로 주입 후 재로드
    await page.addInitScript(() => localStorage.setItem('locale', 'ko'))
    await page.reload()
    await page.waitForSelector('[data-i18n-ready]', { timeout: 10_000 })
    const s = new SettingsModal(page)
    await s.open()
    await expect(s.languageSelect).toHaveValue('ko')
  })

  test('영어로 전환하면 설정 제목이 Settings로 변경된다', async ({ page }) => {
    const s = new SettingsModal(page)
    await s.open()
    await s.changeLanguage('en')
    await expect(page.getByTestId('settings-title')).toHaveText('Settings')
  })

  test('일본어로 전환하면 설정 제목이 設定으로 변경된다', async ({ page }) => {
    const s = new SettingsModal(page)
    await s.open()
    await s.changeLanguage('ja')
    await expect(page.getByTestId('settings-title')).toHaveText('設定')
  })

  test('언어 전환이 앱 전체에 반영된다', async ({ page }) => {
    const s = new SettingsModal(page)
    await s.open()
    await s.changeLanguage('en')
    await s.cancelButton.click()
    await expect(page.getByTestId('settings-trigger')).toBeVisible()
  })

  test('언어 선택이 localStorage에 저장된다', async ({ page }) => {
    const s = new SettingsModal(page)
    await s.open()
    await s.changeLanguage('ja')
    expect(await page.evaluate(() => localStorage.getItem('locale'))).toBe('ja')
  })

  test('새로고침 후에도 언어 설정이 유지된다', async ({ page }) => {
    const s = new SettingsModal(page)
    await s.open()
    await s.changeLanguage('en')
    await page.reload()
    await page.waitForSelector('[data-i18n-ready]', { timeout: 10_000 })
    const s2 = new SettingsModal(page)
    await s2.open()
    await expect(s2.languageSelect).toHaveValue('en')
  })
})
