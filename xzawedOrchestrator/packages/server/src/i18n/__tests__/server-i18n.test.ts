import { describe, it, expect, beforeEach } from 'vitest'
import { parseLocale, t, loadMessages } from '../server-i18n.js'

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
  it('빈 문자열 헤더는 ko로 폴백한다', () => {
    expect(parseLocale('')).toBe('ko')
  })
  it('대문자 언어 코드도 소문자로 정규화하여 파싱한다', () => {
    expect(parseLocale('EN')).toBe('en')
  })
  it('쿼리 파라미터가 포함된 헤더에서 언어 코드를 추출한다', () => {
    expect(parseLocale('ja;q=0.8,ko;q=0.5')).toBe('ja')
  })
})

describe('t', () => {
  beforeEach(() => {
    loadMessages('en', { 'test.hello': 'Hello', 'test.world': 'World' })
    loadMessages('ja', { 'test.hello': 'こんにちは' })
    loadMessages('ko', { 'test.hello': '안녕하세요', 'test.only_ko': 'Korean only' })
  })

  it('해당 locale에 키가 있으면 번역을 반환한다', () => {
    expect(t('test.hello', 'en')).toBe('Hello')
  })

  it('ja locale에 키가 있으면 일본어 번역을 반환한다', () => {
    expect(t('test.hello', 'ja')).toBe('こんにちは')
  })

  it('ko locale에 키가 있으면 한국어 번역을 반환한다', () => {
    expect(t('test.hello', 'ko')).toBe('안녕하세요')
  })

  it('locale에 없고 ko fallback에 있으면 ko 번역을 반환한다', () => {
    // 'test.only_ko'는 en 메시지에 없으므로 ko fallback으로 반환
    expect(t('test.only_ko', 'en')).toBe('Korean only')
  })

  it('어디에도 없는 키는 키 자체를 반환한다', () => {
    expect(t('nonexistent.key', 'en')).toBe('nonexistent.key')
  })

  it('ko locale에 없고 ko fallback에도 없으면 키 자체를 반환한다', () => {
    expect(t('nonexistent.key', 'ko')).toBe('nonexistent.key')
  })
})

describe('loadMessages', () => {
  it('messages를 오버라이드하고 t()가 새 값을 반환한다', () => {
    loadMessages('en', { 'override.test': 'Overridden' })
    expect(t('override.test', 'en')).toBe('Overridden')
  })

  it('오버라이드 후 이전 키는 사라진다', () => {
    loadMessages('en', { 'only.new': 'New value' })
    // 이전에 있던 test.hello는 새 메시지맵에 없으므로 ko fallback 또는 키 반환
    // ko fallback에도 없으면 키 자체 반환
    loadMessages('ko', {})
    expect(t('test.hello', 'en')).toBe('test.hello')
  })

  it('ko locale 메시지를 오버라이드하면 t()가 새 ko 값을 반환한다', () => {
    loadMessages('ko', { 'ko.test': '한국어 테스트' })
    expect(t('ko.test', 'ko')).toBe('한국어 테스트')
  })

  it('ja locale 메시지를 오버라이드하면 t()가 새 ja 값을 반환한다', () => {
    loadMessages('ja', { 'ja.test': '日本語テスト' })
    expect(t('ja.test', 'ja')).toBe('日本語テスト')
  })
})
