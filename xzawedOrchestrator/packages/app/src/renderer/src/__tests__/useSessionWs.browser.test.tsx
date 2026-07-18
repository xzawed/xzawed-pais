import React from 'react'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { useChatStore } from '../store/chat.store.js'
import type { WsMessage } from '../lib/api.js'

// SessionWsClient를 mock해 connect의 콜백들을 캡처 → WS 수신·끊김·재연결을 시뮬레이트한다.
let captured: ((msg: WsMessage) => void) | null = null
let capturedClose: (() => void) | null = null
let capturedOpen: (() => void) | null = null
let capturedToken: string | null | undefined
const teardown = vi.fn()
const connect = vi.fn(
  (
    _url: string,
    _sid: string,
    onMessage: (m: WsMessage) => void,
    onClose?: () => void,
    token?: string | null,
    onOpen?: () => void,
  ) => {
    captured = onMessage
    capturedClose = onClose ?? null
    capturedOpen = onOpen ?? null
    capturedToken = token
    return teardown
  },
)
vi.mock('../lib/api.js', () => ({
  SessionWsClient: vi.fn(function () {
    return { connect, send: vi.fn() }
  }),
}))

// useAuthStore를 mock해 selector(deps)와 getState(재연결 시 토큰)를 독립 제어한다.
let storeToken: string | null = null
vi.mock('@xzawed/ui', () => ({
  useAuthStore: Object.assign((sel: (s: { accessToken: string | null }) => unknown) => sel({ accessToken: storeToken }), {
    getState: () => ({ accessToken: storeToken }),
  }),
}))

import { useSessionWs } from '../lib/useSessionWs.js'

function Harness(): React.JSX.Element {
  useSessionWs()
  return <div />
}

beforeEach(() => {
  captured = null
  capturedClose = null
  capturedOpen = null
  capturedToken = undefined
  storeToken = null
  connect.mockClear()
  teardown.mockClear()
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

  test('agent_status의 costUsd/tokensUsed를 세션 비용·토큰으로 반영한다 (G5)', () => {
    useChatStore.setState({ sessionId: 'sess-1' })
    render(<Harness />)
    act(() => {
      captured?.({ type: 'agent_status', agentId: 'manager', content: 'working', costUsd: 0.1234, tokensUsed: 5000 })
    })
    expect(useChatStore.getState().sessionCostUsd).toBe(0.1234)
    expect(useChatStore.getState().tokenCount).toBe(5000)
  })

  test('agent_status에 cost 필드가 없으면 기존 값 유지(회귀 0)', () => {
    useChatStore.setState({ sessionId: 'sess-1', sessionCostUsd: 0.5, tokenCount: 10 })
    render(<Harness />)
    act(() => {
      captured?.({ type: 'agent_status', agentId: 'manager', content: 'no cost' })
    })
    expect(useChatStore.getState().sessionCostUsd).toBe(0.5)
    expect(useChatStore.getState().tokenCount).toBe(10)
  })

  test('agent_info_request에 동반된 uiSpec을 store에 반영한다(P4 승인 데모)', () => {
    useChatStore.setState({ sessionId: 'sess-1' })
    render(<Harness />)
    act(() => {
      captured?.({
        type: 'agent_info_request',
        agentId: 'manager',
        content: 'review',
        approval: { stage: 'design_ui', summary: 's', mode: 'manual' },
        uiSpec: { type: 'mockup_viewer', title: 'Demo', components: [{ name: 'Card', description: 'c' }] },
      } as unknown as WsMessage)
    })
    expect(useChatStore.getState().uiSpec).toEqual({
      type: 'mockup_viewer',
      title: 'Demo',
      components: [{ name: 'Card', description: 'c' }],
    })
    expect(useChatStore.getState().pendingInfoRequest?.approval?.stage).toBe('design_ui')
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

describe('useSessionWs 자동 재연결', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  test('예기치 않은 끊김 시 백오프(500ms) 후 재연결한다', () => {
    useChatStore.setState({ sessionId: 'sess-1' })
    render(<Harness />)
    expect(connect).toHaveBeenCalledTimes(1)
    act(() => {
      capturedClose?.()
    })
    // 백오프 전에는 재연결하지 않는다
    act(() => {
      vi.advanceTimersByTime(499)
    })
    expect(connect).toHaveBeenCalledTimes(1)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(connect).toHaveBeenCalledTimes(2)
  })

  test('연속 끊김은 지수 백오프(500→1000)를 따른다', () => {
    useChatStore.setState({ sessionId: 'sess-1' })
    render(<Harness />)
    act(() => {
      capturedClose?.()
    })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(connect).toHaveBeenCalledTimes(2) // 첫 재연결

    act(() => {
      capturedClose?.()
    })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(connect).toHaveBeenCalledTimes(2) // 아직 1000ms 안 됨
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(connect).toHaveBeenCalledTimes(3) // 1000ms 경과 → 두 번째 재연결
  })

  test('성공 연결(onOpen) 후 다음 끊김은 base(500ms) 지연으로 재연결한다', () => {
    useChatStore.setState({ sessionId: 'sess-1' })
    render(<Harness />)
    act(() => {
      capturedClose?.()
    })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(connect).toHaveBeenCalledTimes(2)
    // 재연결 성공 시뮬레이트 → 백오프 리셋
    act(() => {
      capturedOpen?.()
    })
    act(() => {
      capturedClose?.()
    })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(connect).toHaveBeenCalledTimes(3) // base 지연으로 재연결
  })

  test('언마운트(의도적 teardown) 후에는 재연결하지 않는다', () => {
    useChatStore.setState({ sessionId: 'sess-1' })
    const { unmount } = render(<Harness />)
    unmount()
    expect(teardown).toHaveBeenCalled()
    act(() => {
      capturedClose?.() // 정리 중 발생한 close
    })
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(connect).toHaveBeenCalledTimes(1) // 재연결 없음
  })

  test('재연결 시 store의 최신 토큰을 재첨부한다', () => {
    storeToken = 'tok-old'
    useChatStore.setState({ sessionId: 'sess-1' })
    render(<Harness />)
    expect(capturedToken).toBe('tok-old')
    // 연결 유지 중 토큰 갱신(이펙트 재실행 없이) 후 끊김 → 재연결은 최신 토큰 사용
    storeToken = 'tok-new'
    act(() => {
      capturedClose?.()
    })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(connect).toHaveBeenCalledTimes(2)
    expect(capturedToken).toBe('tok-new')
  })

  test('중복 close(error+close)에도 재연결은 한 번만 스케줄된다', () => {
    useChatStore.setState({ sessionId: 'sess-1' })
    render(<Harness />)
    act(() => {
      capturedClose?.()
      capturedClose?.() // error→close 쌍으로 두 번 호출
    })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(connect).toHaveBeenCalledTimes(2) // 재연결 1회만(총 2회 connect)
  })
})
