import React from 'react'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useChatStore } from '../store/chat.store.js'
import { ChatView } from '../components/ChatView.js'

vi.mock('../lib/api.js', () => ({
  postMessage: vi.fn(),
  SessionWsClient: vi.fn(() => ({ connect: vi.fn(() => () => {}) })),
}))

describe('ChatView', () => {
  beforeEach(() => {
    useChatStore.setState({
      sessionId: null,
      messages: [],
      streamingContent: '',
      streamingMsgId: null,
      isStreaming: false,
      isPending: false,
      uiSpec: null,
      logLines: [],
      tokenCount: 0,
      elapsedMs: 0,
      modifiedFiles: [],
    })
  })

  test('renders empty state when no session', () => {
    render(<MemoryRouter><ChatView /></MemoryRouter>)
    expect(screen.getByText('새 세션을 시작해주세요')).toBeInTheDocument()
  })

  test('renders chat-message-list when session is active', () => {
    useChatStore.setState({ sessionId: 'test-session' })
    render(<MemoryRouter><ChatView /></MemoryRouter>)
    expect(screen.getByTestId('chat-message-list')).toBeInTheDocument()
  })
})
