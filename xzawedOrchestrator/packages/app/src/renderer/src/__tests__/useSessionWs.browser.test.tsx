import React from 'react'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { useChatStore } from '../store/chat.store.js'
import type { WsMessage } from '../lib/api.js'

// SessionWsClient를 mock해 connect의 onMessage 콜백을 캡처 → WS 수신을 시뮬레이트한다.
let captured: ((msg: WsMessage) => void) | null = null
const connect = vi.fn(
  (_url: string, _sid: string, onMessage: (m: WsMessage) => void) => {
    captured = onMessage
    return () => {}
  },
)
vi.mock('../lib/api.js', () => ({
  SessionWsClient: vi.fn(function () {
    return { connect, send: vi.fn() }
  }),
}))

import { useSessionWs } from '../lib/useSessionWs.js'

function Harness(): React.JSX.Element {
  useSessionWs()
  return <div />
}

beforeEach(() => {
  captured = null
  connect.mockClear()
  useChatStore.getState().reset()
})

describe('useSessionWs', () => {
  test('sessionId가 없으면 연결하지 않는다', () => {
    render(<Harness />)
    expect(connect).not.toHaveBeenCalled()
  })

  test('sessionId가 있으면 연결한다', () => {
    useChatStore.setState({ sessionId: 'sess-1' })
    render(<Harness />)
    expect(connect).toHaveBeenCalledOnce()
  })

  test('chunk 수신 시 스트리밍 내용에 반영한다', () => {
    useChatStore.setState({ sessionId: 'sess-1' })
    render(<Harness />)
    act(() => {
      captured?.({ type: 'chunk', messageId: 'm1', content: 'hello' })
    })
    expect(useChatStore.getState().streamingContent).toBe('hello')
  })

  test('agent_info_request 수신 시 승인 대기 요청을 설정한다', () => {
    useChatStore.setState({ sessionId: 'sess-1' })
    render(<Harness />)
    act(() => {
      captured?.({
        type: 'agent_info_request',
        agentId: 'manager',
        content: 'review',
        approval: { stage: 'plan_task', summary: 's', mode: 'manual' },
      })
    })
    expect(useChatStore.getState().pendingInfoRequest?.approval?.stage).toBe('plan_task')
  })

  test('knowledge_changed 수신 시 notifyKnowledgeChange로 store에 반영한다(위키 실시간 갱신)', () => {
    useChatStore.setState({ sessionId: 'sess-1' })
    render(<Harness />)
    act(() => {
      captured?.({ type: 'knowledge_changed', projectId: 'proj-7' })
    })
    expect(useChatStore.getState().knowledgeChange?.projectId).toBe('proj-7')
  })

  test('knowledge_changed에 projectId가 없으면 무시한다', () => {
    useChatStore.setState({ sessionId: 'sess-1' })
    render(<Harness />)
    act(() => {
      captured?.({ type: 'knowledge_changed' })
    })
    expect(useChatStore.getState().knowledgeChange).toBeNull()
  })
})
