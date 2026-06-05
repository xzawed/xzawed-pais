import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/i18n.js', () => ({
  default: { changeLanguage: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('../lib/detect-locale.js', () => ({
  detectLocale: vi.fn(() => 'ko'),
}))

describe('useAppStore — locale', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('기본 locale은 detectLocale() 결과이다', async () => {
    const { useAppStore } = await import('../store/app.store.js')
    expect(useAppStore.getState().locale).toBe('ko')
  })

  it('setLocale은 locale 상태를 변경한다', async () => {
    const { useAppStore } = await import('../store/app.store.js')
    useAppStore.getState().setLocale('en')
    expect(useAppStore.getState().locale).toBe('en')
  })

  it('setLocale은 localStorage에 저장한다', async () => {
    const { useAppStore } = await import('../store/app.store.js')
    useAppStore.getState().setLocale('ja')
    expect(localStorage.getItem('locale')).toBe('ja')
  })
})

describe('useChatStore — uiSpec 생명주기', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('initSession은 이전 세션의 uiSpec을 정리한다(cross-session stale 방지)', async () => {
    const { useChatStore } = await import('../store/chat.store.js')
    useChatStore.getState().setUiSpec({ type: 'mockup_viewer', title: '이전 데모' })
    expect(useChatStore.getState().uiSpec).not.toBeNull()
    useChatStore.getState().initSession('new-session')
    expect(useChatStore.getState().uiSpec).toBeNull()
  })
})
