import React from 'react'
import { describe, test, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MessageInput } from '../components/MessageInput.js'

function type(text: string) {
  fireEvent.change(screen.getByTestId('message-input'), { target: { value: text } })
}

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
})
