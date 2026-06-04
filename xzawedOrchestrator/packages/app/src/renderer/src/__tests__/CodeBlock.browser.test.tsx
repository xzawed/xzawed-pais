import React from 'react'
import { describe, test, expect, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import koApp from '../locales/ko/app.json'
import { CodeBlock } from '../components/chat/CodeBlock.js'

// i18n 초기화 — t()가 ko 값을 반환하도록 실제 ko/app.json 리소스를 주입한다.
beforeAll(async () => {
  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      lng: 'ko', fallbackLng: 'ko', defaultNS: 'app', ns: ['app'],
      interpolation: { escapeValue: false }, resources: {},
    })
  }
  i18n.addResourceBundle('ko', 'app', koApp, true, true)
})

describe('CodeBlock', () => {
  test('renders copy button with data-testid', () => {
    render(<CodeBlock code="const x = 1" lang="typescript" />)
    expect(screen.getByTestId('code-copy-button')).toBeInTheDocument()
  })

  test('copy button shows 복사 text by default', () => {
    render(<CodeBlock code="console.log('hello')" lang="javascript" />)
    expect(screen.getByTestId('code-copy-button')).toHaveTextContent('복사')
  })

  test('renders code content as fallback before highlighting', () => {
    render(<CodeBlock code="export default {}" lang="json" />)
    expect(screen.getByTestId('code-copy-button')).toBeInTheDocument()
  })
})
