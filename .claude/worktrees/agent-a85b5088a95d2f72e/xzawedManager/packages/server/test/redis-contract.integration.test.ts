import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Redis } from 'ioredis'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'

const REDIS_URL = process.env['REDIS_URL'] ?? ''
const hasRedis = REDIS_URL !== ''

// Planner의 ManagerToPlannerMessageSchema를 테스트에서 재정의
// xzawedPlanner는 Manager 의존성이 아니므로 import 불가
const ManagerToPlannerMessageSchema = z.object({
  sessionId: z.string(),
  messageId: z.string(),
  timestamp: z.number(),
  type: z.enum(['plan_request', 'abort']),
  payload: z.object({
    intent: z.string(),
    context: z.record(z.unknown()),
    priority: z.enum(['normal', 'high']),
  }),
})

function makeManagerMessage(
  sessionId: string,
  overrides?: Partial<{
    type: 'plan_request' | 'abort'
    payload: Record<string, unknown>
  }>,
): string {
  return JSON.stringify({
    sessionId,
    messageId: randomUUID(),
    timestamp: Date.now(),
    type: overrides?.type ?? 'plan_request',
    payload: overrides?.payload ?? {
      intent: 'contract test',
      context: {},
      priority: 'normal',
    },
  })
}

describe.skipIf(!hasRedis)('Manager → Planner Redis 메시지 계약', () => {
  let redis: Redis
  const usedKeys: string[] = []

  beforeAll(() => {
    redis = new Redis(REDIS_URL)
  })

  afterAll(async () => {
    if (usedKeys.length > 0) await redis.del(...usedKeys)
    await redis.quit()
  })

  it('plan_request 메시지가 Planner 스키마를 통과한다', async () => {
    const sessionId = randomUUID()
    const streamKey = `manager:to-planner:${sessionId}`
    usedKeys.push(streamKey)

    const raw = makeManagerMessage(sessionId)
    await redis.xadd(streamKey, '*', 'data', raw)

    const entries = await redis.xrange(streamKey, '-', '+') as [string, string[]][]
    expect(entries.length).toBe(1)

    const dataIdx = entries[0][1].indexOf('data')
    const payload = entries[0][1][dataIdx + 1]
    const parsed = ManagerToPlannerMessageSchema.safeParse(JSON.parse(payload))

    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.type).toBe('plan_request')
      expect(parsed.data.payload.intent).toBe('contract test')
    }
  })

  it('abort 메시지의 빈 payload가 Planner 스키마 동작을 검증한다', async () => {
    const sessionId = randomUUID()
    const streamKey = `manager:to-planner:${sessionId}`
    usedKeys.push(streamKey)

    // abort 메시지는 payload가 {} (빈 객체)
    // ManagerToPlannerMessageSchema의 payload는 intent/context/priority가 required이므로
    // 스키마 파싱 실패 — 이것이 현재 계약 상태의 버그를 드러낸다
    const raw = makeManagerMessage(sessionId, { type: 'abort', payload: {} })
    await redis.xadd(streamKey, '*', 'data', raw)

    const entries = await redis.xrange(streamKey, '-', '+') as [string, string[]][]
    expect(entries.length).toBe(1)

    const dataIdx = entries[0][1].indexOf('data')
    const payload = entries[0][1][dataIdx + 1]
    const parsed = ManagerToPlannerMessageSchema.safeParse(JSON.parse(payload))

    // BUG: abort payload schema mismatch — payload가 {}이므로 intent/context/priority 검증 실패
    expect(parsed.success).toBe(false)
  })

  it('intent 누락 메시지는 Planner 스키마를 통과하지 않는다', async () => {
    const sessionId = randomUUID()
    const streamKey = `manager:to-planner:${sessionId}`
    usedKeys.push(streamKey)

    const raw = makeManagerMessage(sessionId, {
      type: 'plan_request',
      payload: { context: {}, priority: 'normal' },
    })
    await redis.xadd(streamKey, '*', 'data', raw)

    const entries = await redis.xrange(streamKey, '-', '+') as [string, string[]][]
    expect(entries.length).toBe(1)

    const dataIdx = entries[0][1].indexOf('data')
    const payload = entries[0][1][dataIdx + 1]
    const parsed = ManagerToPlannerMessageSchema.safeParse(JSON.parse(payload))

    expect(parsed.success).toBe(false)
  })
})
