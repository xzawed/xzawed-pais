import React from 'react'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useChatStore } from '../store/chat.store.js'
import { ChatView } from '../components/ChatView.js'

vi.mock('../lib/api.js', () => ({
  postMessage: vi.fn(),
  SessionWsClient: vi.fn(() => ({ connect: vi.fn(() => () => {}), send: vi.fn() })),
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
      pendingInfoRequest: null,
    })
  })

  test('renders empty state when no session', () => {
    render(<MemoryRouter><ChatView /></MemoryRouter>)
    expect(screen.getByTestId('empty-chat-message')).toBeInTheDocument()
  })

  test('renders chat-message-list when session is active', () => {
    useChatStore.setState({ sessionId: 'test-session' })
    render(<MemoryRouter><ChatView /></MemoryRouter>)
    expect(screen.getByTestId('chat-message-list')).toBeInTheDocument()
  })

  test('renders agent_info_request prompt when pendingInfoRequest is set', () => {
    useChatStore.setState({
      sessionId: 'test-session',
      pendingInfoRequest: { agentId: 'planner', prompt: 'What is the target framework?' },
    })
    render(<MemoryRouter><ChatView /></MemoryRouter>)
    expect(screen.getByTestId('agent-info-request')).toBeInTheDocument()
    expect(screen.getByTestId('agent-info-request-prompt')).toHaveTextContent('What is the target framework?')
    expect(screen.getByTestId('agent-info-response-input')).toBeInTheDocument()
    expect(screen.getByTestId('agent-info-response-send')).toBeInTheDocument()
  })
})
