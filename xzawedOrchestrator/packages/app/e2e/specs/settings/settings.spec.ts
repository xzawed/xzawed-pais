import { test, expect } from '../../fixtures.js'
import { SettingsModal } from '../../pages/SettingsModal.js'

test.describe('설정 모달', () => {
  test('설정 트리거 버튼이 표시된다', async ({ page }) => {
    await expect(new SettingsModal(page).trigger).toBeVisible()
  })

  test('트리거 클릭 시 설정 모달이 열린다', async ({ page }) => {
    const s = new SettingsModal(page)
    await s.open()
    await expect(s.modal).toBeVisible()
  })

  test('서버 URL 입력 필드가 표시된다', async ({ page }) => {
    const s = new SettingsModal(page)
    await s.open()
    await expect(s.serverUrlInput).toBeVisible()
  })

  test('언어 선택 드롭다운이 표시된다', async ({ page }) => {
    const s = new SettingsModal(page)
    await s.open()
    await expect(s.languageSelect).toBeVisible()
  })

  test('저장 버튼이 표시된다', async ({ page }) => {
    const s = new SettingsModal(page)
    await s.open()
    await expect(s.saveButton).toBeVisible()
  })

  test('취소 버튼 클릭 시 모달이 닫힌다', async ({ page }) => {
    const s = new SettingsModal(page)
    await s.open()
    await s.cancelButton.click()
    await expect(s.modal).not.toBeVisible()
  })

  test('서버 URL 변경 후 저장 시 설정이 유지된다', async ({ page }) => {
    const s = new SettingsModal(page)
    await s.open()
    await s.serverUrlInput.fill('http://localhost:9999')
    await s.saveButton.click()
    await s.open()
    await expect(s.serverUrlInput).toHaveValue('http://localhost:9999')
  })
})
