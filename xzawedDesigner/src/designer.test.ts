import { vi, describe, it, expect, beforeEach } from 'vitest'
import { AgentQuery } from '@xzawed/agent-streams'
import { Designer } from './designer.js'
import type { ManagerToDesignerMessage } from './types.js'

const mockPublish = vi.fn().mockResolvedValue(undefined)
const mockProducer = { publish: mockPublish }

const mockGenerateDesign = vi.fn()
const mockAnswerQuery = vi.fn()
const mockRunner = { generateDesign: mockGenerateDesign, answerQuery: mockAnswerQuery }

// 러너가 **실제로 내는 모양**이다 — `source` 는 S5.2b 이후 필수 필드다. 이것을 빼고 테스트하면
// 프로덕션이 낼 수 없는 입력에 대해서만 초록이 된다(S5.2a 가 정확히 그 틈에서 오판했다).
const defaultDesignResult = {
  components: [{ name: 'LoginForm', description: 'form', props: {} }],
  uiSpec: { type: 'mockup_viewer' as const, title: 'Login', content: 'login page' },
  source: 'llm' as const,
}

/** 러너의 파싱 실패 폴백이 내는 모양(`claude/runner.ts` fallback 과 같다). */
const fallbackDesignResult = {
  components: [{ name: 'Component', description: 'login form', props: { children: 'React.ReactNode' } }],
  uiSpec: { type: 'mockup_viewer' as const, title: 'login form', content: 'login form' },
  source: 'fallback' as const,
}

function makeRequest(overrides?: Partial<ManagerToDesignerMessage['payload']>): ManagerToDesignerMessage {
  return {
    sessionId: 'sess-1',
    messageId: 'msg-1',
    timestamp: Date.now(),
    type: 'design_request',
    payload: {
      intent: 'login form',
      context: {},
      ...overrides,
    },
  }
}

let designer: Designer

beforeEach(() => {
  vi.resetAllMocks()
  mockPublish.mockResolvedValue(undefined)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  designer = new Designer(mockProducer as any, mockRunner as any)
})

describe('Designer.handle', () => {
  it('publishes design_complete with components and uiSpec', async () => {
    mockGenerateDesign.mockResolvedValueOnce(defaultDesignResult)
    await designer.handle(makeRequest())
    expect(mockPublish).toHaveBeenCalledWith('sess-1', expect.objectContaining({
      type: 'design_complete',
      payload: expect.objectContaining({
        components: defaultDesignResult.components,
        uiSpec: defaultDesignResult.uiSpec,
      }),
    }))
  })

  it('returns immediately on abort without publishing', async () => {
    const abort: ManagerToDesignerMessage = {
      sessionId: 'sess-1', messageId: 'msg-2', timestamp: Date.now(),
      type: 'abort',
      payload: { intent: '', context: {} },
    }
    await designer.handle(abort)
    expect(mockPublish).not.toHaveBeenCalled()
    expect(mockGenerateDesign).not.toHaveBeenCalled()
  })

  it('publishes error when runner throws', async () => {
    mockGenerateDesign.mockRejectedValueOnce(new Error('Claude timeout'))
    await designer.handle(makeRequest())
    expect(mockPublish).toHaveBeenCalledWith('sess-1', expect.objectContaining({
      type: 'error',
      payload: expect.objectContaining({ content: 'Claude timeout' }),
    }))
  })

  it('passes targetFramework and designSystem to runner', async () => {
    mockGenerateDesign.mockResolvedValueOnce(defaultDesignResult)
    await designer.handle(makeRequest({ targetFramework: 'vue', designSystem: 'material' }))
    expect(mockGenerateDesign).toHaveBeenCalledWith(
      'login form', {}, 'vue', 'material', undefined
    )
  })

  it('uses react/tailwind defaults when framework/system absent', async () => {
    mockGenerateDesign.mockResolvedValueOnce(defaultDesignResult)
    await designer.handle(makeRequest())
    expect(mockGenerateDesign).toHaveBeenCalledWith(
      'login form', {}, 'react', 'tailwind', undefined
    )
  })

  it('AgentQuery 반환 시 agent_query를 발행한다', async () => {
    mockGenerateDesign.mockResolvedValueOnce(
      new AgentQuery('developer', '재고 표시 가능?', 'active_request'),
    )
    await designer.handle(makeRequest())
    expect(mockPublish).toHaveBeenCalledWith('sess-1', expect.objectContaining({
      type: 'agent_query',
      payload: expect.objectContaining({
        to: 'developer', question: '재고 표시 가능?', kind: 'active_request',
      }),
    }))
  })

  it('query 입력 시 answerQuery로 답하고 design_complete를 발행한다', async () => {
    mockAnswerQuery.mockResolvedValueOnce('가능합니다, 5초 폴링 권장')
    await designer.handle(makeRequest({ query: '재고 표시 가능?' }))
    expect(mockAnswerQuery).toHaveBeenCalledWith('재고 표시 가능?', {})
    expect(mockPublish).toHaveBeenCalledWith('sess-1', expect.objectContaining({
      type: 'design_complete',
      payload: expect.objectContaining({ content: '가능합니다, 5초 폴링 권장' }),
    }))
  })

  it('design_complete content mentions component count', async () => {
    mockGenerateDesign.mockResolvedValueOnce(defaultDesignResult)
    await designer.handle(makeRequest())
    const call = mockPublish.mock.calls[0]
    expect(call[1].payload.content).toContain('1 component')
  })
})

describe('Designer.handle — 설계 수행 집계(S5.2b)', () => {
  it('design_complete 에 designed 집계를 싣는다', async () => {
    mockGenerateDesign.mockResolvedValueOnce(defaultDesignResult)
    await designer.handle(makeRequest())
    expect(mockPublish.mock.calls[0]?.[1].payload.designed).toEqual({ source: 'llm', components: 1 })
  })

  it('폴백 결과는 source=fallback 으로 실린다 — 소비자가 성공과 구분할 수 있다', async () => {
    mockGenerateDesign.mockResolvedValueOnce(fallbackDesignResult)
    await designer.handle(makeRequest())
    expect(mockPublish.mock.calls[0]?.[1].payload.designed).toEqual({ source: 'fallback', components: 1 })
  })

  it('designed.components 는 실제 발행 배열 길이와 같다', async () => {
    mockGenerateDesign.mockResolvedValueOnce({
      ...defaultDesignResult,
      components: [
        { name: 'A', description: 'a', props: {} },
        { name: 'B', description: 'b', props: {} },
        { name: 'C', description: 'c', props: {} },
      ],
    })
    await designer.handle(makeRequest())
    const payload = mockPublish.mock.calls[0]?.[1].payload
    expect(payload.designed.components).toBe(payload.components.length)
    expect(payload.designed.components).toBe(3)
  })

  it('폴백과 성공은 컴포넌트 수가 같아 designed 없이는 구분되지 않는다', async () => {
    mockGenerateDesign.mockResolvedValueOnce(defaultDesignResult)
    await designer.handle(makeRequest())
    const ok = mockPublish.mock.calls[0]?.[1].payload
    mockPublish.mockClear()
    mockGenerateDesign.mockResolvedValueOnce(fallbackDesignResult)
    await designer.handle(makeRequest())
    const bad = mockPublish.mock.calls[0]?.[1].payload
    expect(bad.components.length).toBe(ok.components.length)
    expect(bad.designed.source).not.toBe(ok.designed.source)
  })
})
