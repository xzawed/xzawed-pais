import { describe, it, expect, vi } from 'vitest'
import { AgentQuery } from '../types/agent-query.js'
import { runCollaborativeHandle, makeCollaborationContext } from '../streams/collaboration.js'

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
