import React from 'react'
import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Message } from '@xzawed/shared'
import { AgentTimelineCard } from '../components/chat/AgentTimelineCard.js'

const makeMessage = (content: string): Message => ({
  id: '1',
  sessionId: 'session-1',
  role: 'assistant',
  content,
  timestamp: Date.now(),
})

describe('AgentTimelineCard', () => {
  test('renders card with agent-timeline-card testid', () => {
    render(<AgentTimelineCard message={makeMessage('[MGR] 작업을 시작합니다.')} />)
    expect(screen.getByTestId('agent-timeline-card')).toBeInTheDocument()
  })

  test('renders agent name from message content', () => {
    render(<AgentTimelineCard message={makeMessage('[PLN] 계획을 수립합니다.')} />)
    expect(screen.getByTestId('agent-timeline-card')).toBeInTheDocument()
    expect(screen.getByText('Planner')).toBeInTheDocument()
  })

  test('renders nothing when content is empty', () => {
    const { container } = render(<AgentTimelineCard message={makeMessage('')} />)
    expect(container.firstChild).toBeEmptyDOMElement()
  })
})
