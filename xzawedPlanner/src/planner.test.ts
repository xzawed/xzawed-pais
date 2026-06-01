import { vi, describe, it, expect, beforeEach } from 'vitest'
import { Planner } from './planner.js'
import { ClarificationNeeded } from './claude/runner.js'
import type { ManagerToPlannerMessage } from './types.js'

const planRequest = (override?: Partial<ManagerToPlannerMessage>): ManagerToPlannerMessage => ({
  sessionId: 'sess-1',
  messageId: 'msg-1',
  timestamp: 1000,
  type: 'plan_request',
  payload: {
    intent: '로그인 기능 구현',
    context: {},
    priority: 'normal',
  },
  ...override,
})

const mockSteps = [
  {
    id: 'step-1',
    title: '로그인 컴포넌트',
    description: '로그인 폼 컴포넌트 작성',
    agentType: 'developer' as const,
    dependencies: [],
    estimatedMinutes: 30,
  },
]

describe('Planner', () => {
  let producer: { publish: ReturnType<typeof vi.fn> }
  let runner: { generatePlan: ReturnType<typeof vi.fn> }
  let planner: Planner

  beforeEach(() => {
    producer = { publish: vi.fn().mockResolvedValue(undefined) }
    runner = { generatePlan: vi.fn() }
    planner = new Planner(producer as any, runner as any)
  })

  it('plan_request 수신 시 plan_complete를 발행한다', async () => {
    runner.generatePlan.mockResolvedValue({ steps: mockSteps, estimatedTime: '30 minutes' })
    await planner.handle(planRequest())

    expect(producer.publish).toHaveBeenCalledOnce()
    const [sessionId, msg] = producer.publish.mock.calls[0]
    expect(sessionId).toBe('sess-1')
    expect(msg.type).toBe('plan_complete')
    expect(msg.payload.steps).toEqual(mockSteps)
    expect(msg.payload.estimatedTime).toBe('30 minutes')
    expect(msg.payload.content).toContain('1단계')
  })

  it('ClarificationNeeded 시 info_request를 발행한다', async () => {
    const clarification = new ClarificationNeeded(
      '어떤 프레임워크를 사용할까요?',
      [{ id: 'fw', label: '프레임워크', type: 'select', options: ['React', 'Vue'], required: true }]
    )
    runner.generatePlan.mockResolvedValue(clarification)
    await planner.handle(planRequest())

    expect(producer.publish).toHaveBeenCalledOnce()
    const [, msg] = producer.publish.mock.calls[0]
    expect(msg.type).toBe('info_request')
    expect(msg.payload.content).toBe('어떤 프레임워크를 사용할까요?')
    expect(msg.payload.uiSpec?.type).toBe('form')
    expect(msg.payload.uiSpec?.fields).toHaveLength(1)
  })

  it('abort 메시지는 무시한다', async () => {
    await planner.handle(planRequest({ type: 'abort' }))
    expect(producer.publish).not.toHaveBeenCalled()
    expect(runner.generatePlan).not.toHaveBeenCalled()
  })

  it('runner 오류 시 error 메시지를 발행한다', async () => {
    runner.generatePlan.mockRejectedValue(new Error('Claude 연결 실패'))
    await planner.handle(planRequest())

    expect(producer.publish).toHaveBeenCalledOnce()
    const [, msg] = producer.publish.mock.calls[0]
    expect(msg.type).toBe('error')
    expect(msg.payload.content).toContain('Claude 연결 실패')
  })

  it('plan_complete 메시지에 sessionId와 timestamp가 포함된다', async () => {
    runner.generatePlan.mockResolvedValue({ steps: mockSteps, estimatedTime: '1 hour' })
    await planner.handle(planRequest())

    const [, msg] = producer.publish.mock.calls[0]
    expect(msg.sessionId).toBe('sess-1')
    expect(typeof msg.messageId).toBe('string')
    expect(typeof msg.timestamp).toBe('number')
  })

  it('runner는 intent, context, priority를 전달받는다', async () => {
    runner.generatePlan.mockResolvedValue({ steps: mockSteps, estimatedTime: '1 hour' })
    const msg = planRequest({
      payload: { intent: '결제 기능', context: { currency: 'KRW' }, priority: 'high' },
    })
    await planner.handle(msg)

    expect(runner.generatePlan).toHaveBeenCalledWith('결제 기능', { currency: 'KRW' }, 'high', undefined)
  })
})
