import { describe, it, expect } from 'vitest'
import { parseLocale } from '../server-i18n.js'

describe('parseLocale', () => {
  it('ko 헤더를 파싱한다', () => {
    expect(parseLocale('ko')).toBe('ko')
  })
  it('en-US 헤더에서 en을 추출한다', () => {
    expect(parseLocale('en-US,en;q=0.9')).toBe('en')
  })
  it('ja 헤더를 파싱한다', () => {
    expect(parseLocale('ja-JP')).toBe('ja')
  })
  it('지원하지 않는 언어는 ko로 폴백한다', () => {
    expect(parseLocale('fr-FR')).toBe('ko')
  })
  it('undefined 헤더는 ko로 폴백한다', () => {
    expect(parseLocale(undefined)).toBe('ko')
  })
})
