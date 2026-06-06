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

describe('RedisEventBus — 소비 전송 포트', () => {
  function makePipeline() {
    const ops: Array<() => Promise<unknown>> = []
    const p = {
      xack: vi.fn().mockImplementation(() => { ops.push(() => Promise.resolve(1)); return p }),
      exec: vi.fn().mockImplementation(() => Promise.resolve(ops.map(() => [null, 1]))),
    }
    return p
  }
  function makeRedis(overrides: Record<string, unknown> = {}) {
    return {
      xgroup: vi.fn().mockResolvedValue('OK'),
      xreadgroup: vi.fn().mockResolvedValue(null),
      xack: vi.fn().mockResolvedValue(1),
      xautoclaim: vi.fn().mockResolvedValue(['0-0', [], []]),
      pipeline: vi.fn().mockImplementation(makePipeline),
      ...overrides,
    }
  }

  it('ensureGroup: xgroup CREATE(MKSTREAM)를 호출한다', async () => {
    const redis = makeRedis()
    await new RedisEventBus(redis as never).ensureGroup('s:1', 'grp')
    expect(redis.xgroup).toHaveBeenCalledWith('CREATE', 's:1', 'grp', '$', 'MKSTREAM')
  })

  it('ensureGroup: BUSYGROUP 오류는 무시한다', async () => {
    const redis = makeRedis({ xgroup: vi.fn().mockRejectedValue(new Error('BUSYGROUP exists')) })
    await expect(new RedisEventBus(redis as never).ensureGroup('s:1', 'grp')).resolves.toBeUndefined()
  })

  it('ensureGroup: BUSYGROUP 외 오류는 전파한다', async () => {
    const redis = makeRedis({ xgroup: vi.fn().mockRejectedValue(new Error('WRONGTYPE')) })
    await expect(new RedisEventBus(redis as never).ensureGroup('s:1', 'grp')).rejects.toThrow('WRONGTYPE')
  })

  it('readGroup: xreadgroup을 올바른 인자로 호출하고 결과를 반환한다', async () => {
    const reply = [['s:1', [['1-0', ['data', '{}']]]]]
    const redis = makeRedis({ xreadgroup: vi.fn().mockResolvedValue(reply) })
    const out = await new RedisEventBus(redis as never).readGroup('s:1', 'grp', 'c1', { count: 10, blockMs: 1000 })
    expect(redis.xreadgroup).toHaveBeenCalledWith(
      'GROUP', 'grp', 'c1', 'COUNT', '10', 'BLOCK', '1000', 'STREAMS', 's:1', '>',
    )
    expect(out).toBe(reply)
  })

  it('readGroup: 타임아웃(xreadgroup null)이면 null을 그대로 반환한다', async () => {
    const redis = makeRedis({ xreadgroup: vi.fn().mockResolvedValue(null) })
    const out = await new RedisEventBus(redis as never).readGroup('s:1', 'grp', 'c1', { count: 10, blockMs: 1000 })
    expect(out).toBeNull()
  })

  it('ack: pipeline로 일괄 xack한다', async () => {
    const redis = makeRedis()
    await new RedisEventBus(redis as never).ack('s:1', 'grp', ['1-0', '2-0'])
    const pipe = (redis.pipeline as ReturnType<typeof vi.fn>).mock.results[0].value
    expect(pipe.xack).toHaveBeenCalledWith('s:1', 'grp', '1-0')
    expect(pipe.xack).toHaveBeenCalledWith('s:1', 'grp', '2-0')
    expect(pipe.exec).toHaveBeenCalled()
  })

  it('ack: pipeline 미지원 시 개별 xack로 폴백한다', async () => {
    const redis = makeRedis()
    delete (redis as Record<string, unknown>)['pipeline']
    await new RedisEventBus(redis as never).ack('s:1', 'grp', ['1-0', '2-0'])
    expect(redis.xack).toHaveBeenCalledWith('s:1', 'grp', '1-0')
    expect(redis.xack).toHaveBeenCalledWith('s:1', 'grp', '2-0')
  })

  it('autoclaim: xautoclaim을 올바른 인자로 호출하고 결과를 반환한다', async () => {
    const reply = ['0-0', [['2-0', ['data', '{}']]], []]
    const redis = makeRedis({ xautoclaim: vi.fn().mockResolvedValue(reply) })
    const out = await new RedisEventBus(redis as never).autoclaim('s:1', 'grp', 'c1', { minIdleMs: 300000, count: 10 })
    expect(redis.xautoclaim).toHaveBeenCalledWith('s:1', 'grp', 'c1', 300000, '0-0', 'COUNT', '10')
    expect(out).toBe(reply)
  })

  it('readGroupMulti: 다중 STREAMS 인자로 xreadgroup을 호출하고 결과를 반환한다', async () => {
    const reply = [['w:s1', [['1-0', ['data', '{}']]]], ['w:s2', [['2-0', ['data', '{}']]]]]
    const redis = makeRedis({ xreadgroup: vi.fn().mockResolvedValue(reply) })
    const out = await new RedisEventBus(redis as never).readGroupMulti(
      ['w:s1', 'w:s2'], 'grp', 'c1', ['>', '>'], { count: 50, blockMs: 3000 },
    )
    expect(redis.xreadgroup).toHaveBeenCalledWith(
      'GROUP', 'grp', 'c1', 'COUNT', '50', 'BLOCK', '3000', 'STREAMS', 'w:s1', 'w:s2', '>', '>',
    )
    expect(out).toBe(reply)
  })

  it('readGroupMulti: 타임아웃(null)이면 null을 그대로 반환한다', async () => {
    const redis = makeRedis({ xreadgroup: vi.fn().mockResolvedValue(null) })
    const out = await new RedisEventBus(redis as never).readGroupMulti(['w:s1'], 'grp', 'c1', ['>'], { count: 50, blockMs: 3000 })
    expect(out).toBeNull()
  })

  it('readGroupMulti: streams/ids 길이 불일치는 throw한다(STREAMS 무음 실패 방지)', async () => {
    const redis = makeRedis()
    await expect(
      new RedisEventBus(redis as never).readGroupMulti(['w:s1', 'w:s2'], 'grp', 'c1', ['>'], { count: 50, blockMs: 3000 }),
    ).rejects.toThrow('length mismatch')
    expect(redis.xreadgroup).not.toHaveBeenCalled()
  })
})

describe('RedisEventBus — 요청-응답(RequestReplyPort)', () => {
  it('streamTip: xrevrange로 최신 엔트리 ID를 반환한다', async () => {
    const redis = { xrevrange: vi.fn().mockResolvedValue([['5-0', ['data', '{}']]]) }
    const id = await new RedisEventBus(redis as never).streamTip('o:to-m:s1')
    expect(redis.xrevrange).toHaveBeenCalledWith('o:to-m:s1', '+', '-', 'COUNT', '1')
    expect(id).toBe('5-0')
  })

  it('streamTip: 빈 스트림이면 0-0을 반환한다(publish 전 캡처 폴백)', async () => {
    const redis = { xrevrange: vi.fn().mockResolvedValue([]) }
    expect(await new RedisEventBus(redis as never).streamTip('o:to-m:s1')).toBe('0-0')
  })

  it('readFrom: 비그룹 xread BLOCK으로 fromId 이후를 읽고 결과를 반환한다', async () => {
    const reply = [['o:to-m:s1', [['6-0', ['data', '{}']]]]]
    const redis = { xread: vi.fn().mockResolvedValue(reply) }
    const out = await new RedisEventBus(redis as never).readFrom('o:to-m:s1', '5-0', { count: 10, blockMs: 5000 })
    expect(redis.xread).toHaveBeenCalledWith('COUNT', '10', 'BLOCK', '5000', 'STREAMS', 'o:to-m:s1', '5-0')
    expect(out).toBe(reply)
  })

  it('readFrom: 타임아웃(null)이면 null을 그대로 반환한다', async () => {
    const redis = { xread: vi.fn().mockResolvedValue(null) }
    expect(await new RedisEventBus(redis as never).readFrom('o:to-m:s1', '0-0', { count: 5, blockMs: 1000 })).toBeNull()
  })
})
