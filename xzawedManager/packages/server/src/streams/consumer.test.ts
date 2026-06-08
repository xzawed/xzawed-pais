import { describe, it, expect } from 'vitest'
import { OrchestratorToManagerMessageSchema } from './consumer.js'

describe('OrchestratorToManagerMessageSchema — decompose_request', () => {
  it('유효한 decompose_request를 파싱', () => {
    const r = OrchestratorToManagerMessageSchema.safeParse({
      sessionId: 's', messageId: 'm', timestamp: 1, type: 'decompose_request', payload: { intent: 'build it' },
    })
    expect(r.success).toBe(true)
  })

  it('intent 빈 문자열은 거부', () => {
    const r = OrchestratorToManagerMessageSchema.safeParse({
      sessionId: 's', messageId: 'm', timestamp: 1, type: 'decompose_request', payload: { intent: '' },
    })
    expect(r.success).toBe(false)
  })

  it('기존 task_request도 여전히 파싱(회귀 0)', () => {
    const r = OrchestratorToManagerMessageSchema.safeParse({
      sessionId: 's', messageId: 'm', timestamp: 1, type: 'task_request',
      payload: { intent: 'x', context: {}, priority: 'normal' },
    })
    expect(r.success).toBe(true)
  })
})
