import { describe, it, expect } from 'vitest'
import { ManagerToPlannerMessageSchema } from './types.js'

const validPlanRequest = {
  sessionId: 'sess-1',
  messageId: 'msg-1',
  timestamp: 1000,
  type: 'plan_request',
  payload: {
    intent: '로그인 페이지를 만들어라',
    context: {},
    priority: 'normal',
  },
}

describe('ManagerToPlannerMessageSchema', () => {
  it('유효한 plan_request 메시지를 파싱한다', () => {
    const result = ManagerToPlannerMessageSchema.safeParse(validPlanRequest)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe('plan_request')
      expect(result.data.payload.priority).toBe('normal')
    }
  })

  it('abort 타입을 파싱한다', () => {
    const result = ManagerToPlannerMessageSchema.safeParse({
      ...validPlanRequest,
      type: 'abort',
    })
    expect(result.success).toBe(true)
  })

  it('알 수 없는 type은 거부한다', () => {
    const result = ManagerToPlannerMessageSchema.safeParse({
      ...validPlanRequest,
      type: 'unknown_type',
    })
    expect(result.success).toBe(false)
  })

  it('priority가 normal | high 이외이면 거부한다', () => {
    const result = ManagerToPlannerMessageSchema.safeParse({
      ...validPlanRequest,
      payload: { ...validPlanRequest.payload, priority: 'low' },
    })
    expect(result.success).toBe(false)
  })

  it('payload.intent가 없으면 거부한다', () => {
    const { intent: _, ...payloadWithout } = validPlanRequest.payload
    const result = ManagerToPlannerMessageSchema.safeParse({
      ...validPlanRequest,
      payload: payloadWithout,
    })
    expect(result.success).toBe(false)
  })

  it('context는 임의의 객체를 허용한다', () => {
    const result = ManagerToPlannerMessageSchema.safeParse({
      ...validPlanRequest,
      payload: { ...validPlanRequest.payload, context: { framework: 'react', version: 18 } },
    })
    expect(result.success).toBe(true)
  })
})
