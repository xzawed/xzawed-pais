import { describe, it, expect, vi } from 'vitest'
import { RedisEventBus } from '../streams/event-bus.js'

function makeRedis(xaddResult: string | null = '1-0') {
  return { xadd: vi.fn().mockResolvedValue(xaddResult) }
}

describe('RedisEventBus', () => {
  it('일반 발행: stream에 JSON 직렬화 후 xadd한다', async () => {
    const redis = makeRedis()
    const bus = new RedisEventBus(redis as never)
    const id = await bus.publish('a:to-manager:s1', { type: 'x', payload: { n: 1 } })
    expect(redis.xadd).toHaveBeenCalledWith('a:to-manager:s1', '*', 'data', '{"type":"x","payload":{"n":1}}')
    expect(id).toBe('1-0')
  })

  it('maxlen 옵션 시 approximate MAXLEN으로 xadd한다', async () => {
    const redis = makeRedis()
    const bus = new RedisEventBus(redis as never)
    await bus.publish('w:to-manager:s1', { type: 'evt' }, { maxlen: 1000 })
    expect(redis.xadd).toHaveBeenCalledWith(
      'w:to-manager:s1', 'MAXLEN', '~', '1000', '*', 'data', '{"type":"evt"}',
    )
  })

  it('xadd 결과(null 포함)를 그대로 반환한다', async () => {
    const bus = new RedisEventBus(makeRedis(null) as never)
    expect(await bus.publish('s', {})).toBeNull()
  })

  it('메시지를 변형 없이 그대로 직렬화한다(중첩·undefined 필드 표준 JSON 의미)', async () => {
    const redis = makeRedis()
    const bus = new RedisEventBus(redis as never)
    const message = {
      sessionId: 's1', type: 'plan_complete',
      payload: { steps: [{ id: 'a' }, { id: 'b' }], note: undefined, uiSpec: { type: 'form', fields: [] } },
    }
    await bus.publish('planner:to-manager:s1', message)
    // EventBus는 전송 전용 — JSON.stringify와 동일(undefined 필드 strip), 변형/이중직렬화 없음
    expect(redis.xadd).toHaveBeenCalledWith(
      'planner:to-manager:s1', '*', 'data', JSON.stringify(message),
    )
    const sentData = (redis.xadd as ReturnType<typeof vi.fn>).mock.calls[0][3] as string
    expect(JSON.parse(sentData)).toEqual({
      sessionId: 's1', type: 'plan_complete',
      payload: { steps: [{ id: 'a' }, { id: 'b' }], uiSpec: { type: 'form', fields: [] } },
    })
  })
})
