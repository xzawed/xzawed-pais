import { test, expect } from '../../fixtures.js'
import { mockCreateSession } from '../../helpers/mock-server.js'
import { CommandPalette } from '../../pages/CommandPalette.js'

// page fixture는 ELECTRON_TEST_ROUTE 미설정 → hash=test → MemoryRouter /chat 진입
// ChatLayout이 인증 없이 마운트되므로 CommandPalette 테스트에 적합하다
test.describe('Command Palette', () => {
  test('Control+K 단축키로 Command Palette가 열린다', async ({ page }) => {
    const cp = new CommandPalette(page)
    await page.keyboard.press('Control+k')
    await expect(cp.palette).toBeVisible()
  })

  test('검색창이 표시된다', async ({ page }) => {
    const cp = new CommandPalette(page)
    await cp.open()
    // Electron 헤드리스 CI에서 window focus가 inactive 상태일 수 있으므로
    // toBeFocused() 대신 toBeVisible()로 검증한다
    await expect(cp.input).toBeVisible()
  })

  test('검색어 입력 시 결과가 표시된다', async ({ page }) => {
    const cp = new CommandPalette(page)
    await cp.open()
    // CommandItem에 value="새 세션"이 명시되어 있어 i18n 초기화 여부와 무관하게 필터링된다
    await cp.search('새 세션')
    await expect(cp.items.first()).toBeVisible()
  })

  test('Escape 키로 Command Palette가 닫힌다', async ({ page }) => {
    const cp = new CommandPalette(page)
    await cp.open()
    await page.keyboard.press('Escape')
    await expect(cp.palette).not.toBeVisible()
  })

  test('새 세션 항목 선택 시 세션이 생성된다', async ({ page }) => {
    // /sessions POST 요청을 mock하여 sessionId를 반환한다
    await mockCreateSession(page, 'session-cp-001')
    // /chat 레이아웃에 이미 있으므로 빈 세션 상태 확인
    await expect(page.getByTestId('empty-chat-message')).toBeVisible({ timeout: 10_000 })

    const cp = new CommandPalette(page)
    await cp.open()
    await cp.search('새 세션')
    await cp.items.first().click()
    // 세션 생성 후 ChatView가 message-input을 렌더링한다
    await expect(page.getByTestId('message-input')).toBeVisible({ timeout: 5_000 })
  })
})
