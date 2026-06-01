import { describe, it, expect, vi } from 'vitest'
import { AgentQuery } from '../types/agent-query.js'
import { runCollaborativeHandle, makeCollaborationContext, createCollaborativeHandler } from '../streams/collaboration.js'

describe('createCollaborativeHandler', () => {
  function setup(overrides: Record<string, unknown> = {}) {
    const publish = vi.fn().mockResolvedValue(undefined)
    const answerQuery = vi.fn().mockResolvedValue('답변')
    const handler = createCollaborativeHandler<{ sessionId: string; messageId: string; timestamp: number; type: string; payload: Record<string, unknown> }, { query?: string; context: Record<string, unknown> }>({
      publish,
      answerQuery,
      completeType: 'x_complete',
      runMain: vi.fn().mockResolvedValue({ publishResult: vi.fn().mockResolvedValue(undefined) }),
      ...overrides,
    })
    return { publish, answerQuery, handler }
  }

  it('query 모드면 answerQuery 답을 완료 타입으로 발행한다', async () => {
    const { publish, answerQuery, handler } = setup()
    await handler({ sessionId: 's1', type: 'x_request', payload: { query: 'q', context: {} } })
    expect(answerQuery).toHaveBeenCalledWith('q', {})
    expect(publish).toHaveBeenCalledWith('s1', expect.objectContaining({
      type: 'x_complete', payload: { content: '답변' },
    }))
  })

  it('runMain이 AgentQuery 반환 + publishAgentQuery 미제공 시 error 발행', async () => {
    const { publish, handler } = setup({
      runMain: vi.fn().mockResolvedValue(new AgentQuery('developer', 'q', 'active_request')),
    })
    await handler({ sessionId: 's1', type: 'x_request', payload: { context: {} } })
    expect(publish).toHaveBeenCalledWith('s1', expect.objectContaining({ type: 'error' }))
  })

  it('publishAgentQuery 제공 시 AgentQuery를 라우팅한다', async () => {
    const publishAgentQuery = vi.fn().mockResolvedValue(undefined)
    const { handler } = setup({
      runMain: vi.fn().mockResolvedValue(new AgentQuery('developer', 'q', 'active_request')),
      publishAgentQuery,
    })
    await handler({ sessionId: 's1', type: 'x_request', payload: { context: {} } })
    expect(publishAgentQuery).toHaveBeenCalled()
  })
})

describe('makeCollaborationContext', () => {
  it('base와 완료/에러 발행 콜백을 만든다', async () => {
    const publish = vi.fn().mockResolvedValue(undefined)
    const { base, publishQueryAnswer, publishError } =
      makeCollaborationContext(publish, 'sess-1', 'design_complete')

    expect(base.sessionId).toBe('sess-1')
    expect(typeof base.messageId).toBe('string')

    await publishQueryAnswer('답변')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'sess-1', type: 'design_complete', payload: { content: '답변' },
    }))

    await publishError('오류')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error', payload: { content: '오류' },
    }))
  })
})

function deps(overrides: Partial<Parameters<typeof runCollaborativeHandle>[0]> = {}) {
  return {
    isAbort: false,
    query: undefined,
    context: {},
    answerQuery: vi.fn().mockResolvedValue('answer'),
    publishQueryAnswer: vi.fn().mockResolvedValue(undefined),
    runMain: vi.fn().mockResolvedValue({ publishResult: vi.fn().mockResolvedValue(undefined) }),
    publishAgentQuery: vi.fn().mockResolvedValue(undefined),
    publishError: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('runCollaborativeHandle', () => {
  it('abort면 아무것도 하지 않는다', async () => {
    const d = deps({ isAbort: true })
    await runCollaborativeHandle(d)
    expect(d.runMain).not.toHaveBeenCalled()
    expect(d.answerQuery).not.toHaveBeenCalled()
  })

  it('query 모드면 answerQuery로 답을 발행한다', async () => {
    const d = deps({ query: '재고 표시?' })
    await runCollaborativeHandle(d)
    expect(d.answerQuery).toHaveBeenCalledWith('재고 표시?', {})
    expect(d.publishQueryAnswer).toHaveBeenCalledWith('answer')
    expect(d.runMain).not.toHaveBeenCalled()
  })

  it('query 모드에서 answerQuery 실패 시 error를 발행한다', async () => {
    const d = deps({ query: 'q', answerQuery: vi.fn().mockRejectedValue(new Error('boom')) })
    await runCollaborativeHandle(d)
    expect(d.publishError).toHaveBeenCalledWith('boom')
  })

  it('정상 산출물이면 publishResult를 호출한다', async () => {
    const publishResult = vi.fn().mockResolvedValue(undefined)
    const d = deps({ runMain: vi.fn().mockResolvedValue({ publishResult }) })
    await runCollaborativeHandle(d)
    expect(publishResult).toHaveBeenCalled()
    expect(d.publishAgentQuery).not.toHaveBeenCalled()
  })

  it('runMain이 AgentQuery를 반환하면 publishAgentQuery를 호출한다', async () => {
    const aq = new AgentQuery('developer', '가능?', 'active_request')
    const d = deps({ runMain: vi.fn().mockResolvedValue(aq) })
    await runCollaborativeHandle(d)
    expect(d.publishAgentQuery).toHaveBeenCalledWith(aq)
  })

  it('runMain 예외 시 error를 발행한다', async () => {
    const d = deps({ runMain: vi.fn().mockRejectedValue(new Error('fail')) })
    await runCollaborativeHandle(d)
    expect(d.publishError).toHaveBeenCalledWith('fail')
  })
})
