import { describe, it, expect } from 'vitest'
import { EventEnvelopeSchema, makeEnvelope } from '../types/event-envelope.js'

describe('makeEnvelope', () => {
  it('eventId(uuid)·idempotencyKey·occurredAt을 생성한다', () => {
    const env = makeEnvelope({ correlationId: 'c1', workflowId: 'wf1', stepId: 's1', attemptId: 0 }, 1700000000000)
    expect(env.eventId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(env.idempotencyKey).toBe('wf1:s1:0')
    expect(env.occurredAt).toBe(1700000000000)
    expect(env.correlationId).toBe('c1')
    expect(env.causationId).toBeNull()
  })

  it('causationId를 전달하면 보존하고 멱등 키를 구성한다', () => {
    const env = makeEnvelope({ correlationId: 'c1', causationId: 'e0', workflowId: 'wf', stepId: 's', attemptId: 2 })
    expect(env.causationId).toBe('e0')
    expect(env.idempotencyKey).toBe('wf:s:2')
  })

  it('생성한 봉투는 스키마 검증을 통과한다', () => {
    const env = makeEnvelope({ correlationId: 'c', workflowId: 'w', stepId: 's', attemptId: 1 })
    expect(EventEnvelopeSchema.safeParse(env).success).toBe(true)
  })

  it('동일 (workflowId,stepId,attemptId)는 동일 idempotencyKey를 만든다(멱등)', () => {
    const a = makeEnvelope({ correlationId: 'x', workflowId: 'w', stepId: 's', attemptId: 3 })
    const b = makeEnvelope({ correlationId: 'y', workflowId: 'w', stepId: 's', attemptId: 3 })
    expect(a.idempotencyKey).toBe(b.idempotencyKey)
    expect(a.eventId).not.toBe(b.eventId)
  })
})

describe('EventEnvelopeSchema', () => {
  it('필수 필드 누락·잘못된 uuid를 거부한다', () => {
    expect(EventEnvelopeSchema.safeParse({ eventId: 'not-a-uuid' }).success).toBe(false)
  })

  it('attemptId 음수를 거부한다', () => {
    const env = makeEnvelope({ correlationId: 'c', workflowId: 'w', stepId: 's', attemptId: 0 })
    expect(EventEnvelopeSchema.safeParse({ ...env, attemptId: -1 }).success).toBe(false)
  })

  it('causationId는 null을 허용한다(루트 이벤트)', () => {
    const env = makeEnvelope({ correlationId: 'c', workflowId: 'w', stepId: 's', attemptId: 0 })
    expect(EventEnvelopeSchema.safeParse({ ...env, causationId: null }).success).toBe(true)
  })
})
