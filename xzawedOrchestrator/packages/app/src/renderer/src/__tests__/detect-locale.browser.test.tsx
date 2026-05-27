import { describe, it, expect, beforeEach, vi } from 'vitest'
import { detectLocale, LOCALES } from '../lib/detect-locale.js'

describe('detectLocale', () => {
  beforeEach(() => {
    localStorage.clear()
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
