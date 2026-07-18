import React from 'react'
import { describe, test, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MessageInput } from '../components/MessageInput.js'

function type(text: string) {
  fireEvent.change(screen.getByTestId('message-input'), { target: { value: text } })
}

describe('MessageInput', () => {
  test('renders textarea with data-testid', () => {
    render(<MessageInput onSend={() => {}} disabled={false} />)
    expect(screen.getByTestId('message-input')).toBeInTheDocument()
  })

  test('send button is disabled when textarea is empty', () => {
    render(<MessageInput onSend={() => {}} disabled={false} />)
    expect(screen.getByTestId('message-send-button')).toBeDisabled()
  })

  test('send button is disabled when component is disabled', () => {
    render(<MessageInput onSend={() => {}} disabled={true} />)
    expect(screen.getByTestId('message-send-button')).toBeDisabled()
  })
})

describe('MessageInput — 모드 토글', () => {
  test('기본은 chat — 전송 시 onSend(content, "chat")', () => {
    const onSend = vi.fn()
    render(<MessageInput onSend={onSend} disabled={false} />)
    expect(screen.getByTestId('mode-toggle-chat')).toBeInTheDocument()
    expect(screen.getByTestId('mode-toggle-build')).toBeInTheDocument()
    type('hello')
    fireEvent.click(screen.getByTestId('message-send-button'))
    expect(onSend).toHaveBeenCalledWith('hello', 'chat')
  })

  test('Build 토글 후 전송 → onSend(content, "build")', () => {
    const onSend = vi.fn()
    render(<MessageInput onSend={onSend} disabled={false} />)
    fireEvent.click(screen.getByTestId('mode-toggle-build'))
    type('build a todo app')
    fireEvent.click(screen.getByTestId('message-send-button'))
    expect(onSend).toHaveBeenCalledWith('build a todo app', 'build')
  })

  test('모드 토글 버튼에 모드 설명 툴팁(title·aria-label)이 있다 (G2 명확화)', () => {
    render(<MessageInput onSend={() => {}} disabled={false} />)
    const chatBtn = screen.getByTestId('mode-toggle-chat')
    const buildBtn = screen.getByTestId('mode-toggle-build')
    for (const btn of [chatBtn, buildBtn]) {
      expect(btn).toHaveAttribute('title')
      expect(btn.getAttribute('title')).toBeTruthy()
      expect(btn).toHaveAttribute('aria-label')
    }
  })
})
