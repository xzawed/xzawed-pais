import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/i18n.js', () => ({
  default: { changeLanguage: vi.fn().mockResolvedValue(undefined) },
}))

describe('useAppStore — locale', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('기본 locale은 ko이다', async () => {
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
