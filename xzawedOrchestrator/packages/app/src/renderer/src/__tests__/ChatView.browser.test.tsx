import React from 'react'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useChatStore } from '../store/chat.store.js'
import { ChatView } from '../components/ChatView.js'

const postUiAction = vi.fn(() => Promise.resolve())

vi.mock('../lib/api.js', () => ({
  postMessage: vi.fn(),
  postUiAction: (...args: unknown[]) => postUiAction(...args),
  SessionWsClient: vi.fn(function () { return ({ connect: vi.fn(() => () => {}), send: vi.fn() }) }),
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

  test('renders approval actions when approval meta is present', () => {
    useChatStore.setState({
      sessionId: 'test-session',
      pendingInfoRequest: {
        agentId: 'manager',
        prompt: 'review',
        approval: { stage: 'plan_task', summary: '계획 산출물 요약', mode: 'manual' },
      },
    })
    render(<MemoryRouter><ChatView /></MemoryRouter>)
    expect(screen.getByTestId('approval-actions')).toBeInTheDocument()
    expect(screen.getByTestId('agent-info-request-prompt')).toHaveTextContent('계획 산출물 요약')
    expect(screen.getByTestId('approval-approve')).toBeInTheDocument()
    expect(screen.getByTestId('approval-revise')).toBeInTheDocument()
    expect(screen.getByTestId('approval-abort')).toBeInTheDocument()
    // 자유 텍스트 명확화 입력은 노출되지 않아야 한다
    expect(screen.queryByTestId('agent-info-response-send')).not.toBeInTheDocument()
  })

  test('approve sends decision JSON via postUiAction', () => {
    postUiAction.mockClear()
    useChatStore.setState({
      sessionId: 'sess-approve',
      pendingInfoRequest: {
        agentId: 'manager', prompt: 'review',
        approval: { stage: 'plan_task', summary: 's', mode: 'manual' },
      },
    })
    render(<MemoryRouter><ChatView /></MemoryRouter>)
    fireEvent.click(screen.getByTestId('approval-approve'))
    expect(postUiAction).toHaveBeenCalledWith(
      expect.any(String), 'sess-approve', JSON.stringify({ decision: 'approve', rememberAuto: false, saveToWiki: false }),
    )
    // 승인 후 대기 요청이 사라진다
    expect(useChatStore.getState().pendingInfoRequest).toBeNull()
  })

  test('approve with remember-auto checkbox sends rememberAuto:true', () => {
    postUiAction.mockClear()
    useChatStore.setState({
      sessionId: 'sess-auto',
      pendingInfoRequest: {
        agentId: 'manager', prompt: 'review',
        approval: { stage: 'plan_task', summary: 's', mode: 'manual' },
      },
    })
    render(<MemoryRouter><ChatView /></MemoryRouter>)
    fireEvent.click(screen.getByTestId('approval-remember-auto'))
    fireEvent.click(screen.getByTestId('approval-approve'))
    expect(postUiAction).toHaveBeenCalledWith(
      expect.any(String), 'sess-auto', JSON.stringify({ decision: 'approve', rememberAuto: true, saveToWiki: false }),
    )
  })

  test('지식성 단계: save-to-wiki 체크박스 표시 + 체크 후 승인 시 saveToWiki:true', () => {
    postUiAction.mockClear()
    useChatStore.setState({
      sessionId: 'sess-wiki',
      pendingInfoRequest: {
        agentId: 'manager', prompt: 'review',
        approval: { stage: 'plan_task', summary: 's', mode: 'manual' },
      },
    })
    render(<MemoryRouter><ChatView /></MemoryRouter>)
    expect(screen.getByTestId('approval-save-wiki')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('approval-save-wiki'))
    fireEvent.click(screen.getByTestId('approval-approve'))
    expect(postUiAction).toHaveBeenCalledWith(
      expect.any(String), 'sess-wiki', JSON.stringify({ decision: 'approve', rememberAuto: false, saveToWiki: true }),
    )
  })

  test('위키 저장 체크 시 편집 가능한 summary textarea가 요약으로 prefill된다', () => {
    useChatStore.setState({
      sessionId: 'sess-wiki-prefill',
      pendingInfoRequest: {
        agentId: 'manager', prompt: 'review',
        approval: { stage: 'plan_task', summary: '자동 생성된 요약', mode: 'manual' },
      },
    })
    render(<MemoryRouter><ChatView /></MemoryRouter>)
    // 체크 전엔 편집 textarea 미노출
    expect(screen.queryByTestId('approval-wiki-summary')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('approval-save-wiki'))
    const ta = screen.getByTestId('approval-wiki-summary') as HTMLTextAreaElement
    expect(ta).toBeInTheDocument()
    expect(ta.value).toBe('자동 생성된 요약')
  })

  test('요약 편집 후 승인하면 payload에 편집된 wikiSummary가 포함된다', () => {
    postUiAction.mockClear()
    useChatStore.setState({
      sessionId: 'sess-wiki-edit',
      pendingInfoRequest: {
        agentId: 'manager', prompt: 'review',
        approval: { stage: 'plan_task', summary: '자동 요약', mode: 'manual' },
      },
    })
    render(<MemoryRouter><ChatView /></MemoryRouter>)
    fireEvent.click(screen.getByTestId('approval-save-wiki'))
    fireEvent.change(screen.getByTestId('approval-wiki-summary'), { target: { value: 'PO가 다듬은 결정 요약' } })
    fireEvent.click(screen.getByTestId('approval-approve'))
    expect(postUiAction).toHaveBeenCalledWith(
      expect.any(String), 'sess-wiki-edit',
      JSON.stringify({ decision: 'approve', rememberAuto: false, saveToWiki: true, wikiSummary: 'PO가 다듬은 결정 요약' }),
    )
  })

  test('위키 저장 체크했지만 편집하지 않으면 wikiSummary를 보내지 않는다', () => {
    postUiAction.mockClear()
    useChatStore.setState({
      sessionId: 'sess-wiki-noedit',
      pendingInfoRequest: {
        agentId: 'manager', prompt: 'review',
        approval: { stage: 'plan_task', summary: '자동 요약', mode: 'manual' },
      },
    })
    render(<MemoryRouter><ChatView /></MemoryRouter>)
    fireEvent.click(screen.getByTestId('approval-save-wiki'))
    fireEvent.click(screen.getByTestId('approval-approve'))
    expect(postUiAction).toHaveBeenCalledWith(
      expect.any(String), 'sess-wiki-noedit',
      JSON.stringify({ decision: 'approve', rememberAuto: false, saveToWiki: true }),
    )
  })

  test('비지식성 단계(build_project)는 save-to-wiki 체크박스를 표시하지 않는다', () => {
    useChatStore.setState({
      sessionId: 'sess-build',
      pendingInfoRequest: {
        agentId: 'manager', prompt: 'review',
        approval: { stage: 'build_project', summary: 's', mode: 'manual' },
      },
    })
    render(<MemoryRouter><ChatView /></MemoryRouter>)
    expect(screen.getByTestId('approval-actions')).toBeInTheDocument()
    expect(screen.queryByTestId('approval-save-wiki')).not.toBeInTheDocument()
  })

  test('revise requires feedback and sends it', () => {
    postUiAction.mockClear()
    useChatStore.setState({
      sessionId: 'sess-revise',
      pendingInfoRequest: {
        agentId: 'manager', prompt: 'review',
        approval: { stage: 'design_ui', summary: 's', mode: 'manual' },
      },
    })
    render(<MemoryRouter><ChatView /></MemoryRouter>)
    // 피드백 없이 수정요청은 비활성(전송 안 됨)
    fireEvent.click(screen.getByTestId('approval-revise'))
    expect(postUiAction).not.toHaveBeenCalled()
    // 피드백 입력 후 전송
    fireEvent.change(screen.getByTestId('approval-feedback-input'), { target: { value: '색상 변경' } })
    fireEvent.click(screen.getByTestId('approval-revise'))
    expect(postUiAction).toHaveBeenCalledWith(
      expect.any(String), 'sess-revise', JSON.stringify({ decision: 'revise', feedback: '색상 변경' }),
    )
  })

  test('shows UISpec demo preview for design_ui approval', () => {
    useChatStore.setState({
      sessionId: 'sess-demo',
      uiSpec: { type: 'mockup_viewer', title: 'Dashboard', content: '[ Demo Mockup ]' },
      pendingInfoRequest: {
        agentId: 'manager', prompt: 'review',
        approval: { stage: 'design_ui', summary: '대시보드 설계', mode: 'manual' },
      },
    })
    render(<MemoryRouter><ChatView /></MemoryRouter>)
    expect(screen.getByTestId('uispec-preview')).toBeInTheDocument()
    expect(screen.getByText(/Demo Mockup/)).toBeInTheDocument()
  })

  test('does not show demo preview for non-design approval', () => {
    useChatStore.setState({
      sessionId: 'sess-nodemo',
      uiSpec: { type: 'mockup_viewer', title: 'stale', content: 'old' },
      pendingInfoRequest: {
        agentId: 'manager', prompt: 'review',
        approval: { stage: 'build_project', summary: '빌드 결과', mode: 'manual' },
      },
    })
    render(<MemoryRouter><ChatView /></MemoryRouter>)
    expect(screen.queryByTestId('uispec-preview')).not.toBeInTheDocument()
  })

  test('abort sends abort decision', () => {
    postUiAction.mockClear()
    useChatStore.setState({
      sessionId: 'sess-abort',
      pendingInfoRequest: {
        agentId: 'manager', prompt: 'review',
        approval: { stage: 'build_project', summary: 's', mode: 'manual' },
      },
    })
    render(<MemoryRouter><ChatView /></MemoryRouter>)
    fireEvent.click(screen.getByTestId('approval-abort'))
    expect(postUiAction).toHaveBeenCalledWith(
      expect.any(String), 'sess-abort', JSON.stringify({ decision: 'abort' }),
    )
  })
})
