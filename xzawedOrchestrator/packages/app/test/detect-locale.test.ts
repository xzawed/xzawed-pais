import { describe, it, expect, beforeEach, vi } from 'vitest'
import { detectLocale, LOCALES } from '../src/renderer/src/lib/detect-locale.js'

// Mock localStorage for Node.js environment
const mockLocalStorage = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = String(value)
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      store = {}
    },
  }
})()

describe('detectLocale', () => {
  beforeEach(() => {
    mockLocalStorage.clear()
    vi.stubGlobal('localStorage', mockLocalStorage)
    vi.stubGlobal('navigator', { language: 'ko-KR' })
  })

  it('localStorage 저장값을 우선 반환한다', () => {
    localStorage.setItem('locale', 'en')
    expect(detectLocale()).toBe('en')
  })

  it('저장값이 없으면 navigator.language를 사용한다', () => {
    vi.stubGlobal('navigator', { language: 'ja-JP' })
    expect(detectLocale()).toBe('ja')
  })

  it('알 수 없는 언어는 ko로 폴백한다', () => {
    vi.stubGlobal('navigator', { language: 'fr-FR' })
    expect(detectLocale()).toBe('ko')
  })

  it('LOCALES는 ko, en, ja를 포함한다', () => {
    expect(LOCALES).toEqual(['ko', 'en', 'ja'])
  })
})
