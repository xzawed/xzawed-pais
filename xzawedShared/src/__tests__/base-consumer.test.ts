import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import { BaseConsumer, defaultDedupKey } from '../streams/base-consumer.js'

const MessageSchema = z.object({
  id: z.string(),
  value: z.number(),
})

type Message = z.infer<typeof MessageSchema>

const validMsg: Message = { id: 'msg-1', value: 42 }

/** xadd 호출 인자에서 'data' 필드 값(JSON)을 추출·파싱한다 — MAXLEN 등 인자 위치 변화에 robust. */
function dlqPayloadOf(call: unknown[]): Record<string, unknown> {
  return JSON.parse(call[call.indexOf('data') + 1] as string)
}

function makeRedis(overrides: Record<string, unknown> = {}) {
  // pipeline mock: exec()가 xack 결과 배열을 반환한다
  const makePipeline = () => {
    const ops: Array<() => Promise<unknown>> = []
    const p = {
      xack: vi.fn().mockImplementation(() => { ops.push(() => Promise.resolve(1)); return p }),
      exec: vi.fn().mockImplementation(function () { return Promise.resolve(ops.map(() => [null, 1])) }),
    }
    return p
  }
  return {
    xgroup: vi.fn().mockResolvedValue('OK'),
    xreadgroup: vi.fn().mockResolvedValue(null),
    xack: vi.fn().mockResolvedValue(1),
    xautoclaim: vi.fn().mockResolvedValue(['0-0', [], []]),
    xadd: vi.fn().mockResolvedValue('1-0'),
    set: vi.fn().mockResolvedValue('OK'),
    quit: vi.fn().mockResolvedValue('OK'),
    pipeline: vi.fn().mockImplementation(makePipeline),
    ...overrides,
  }
}

describe('defaultDedupKey', () => {
  it('envelope.idempotencyKey가 있으면 우선 사용한다', () => {
    expect(defaultDedupKey({ messageId: 'm1', envelope: { idempotencyKey: 'wf:s:0' } })).toBe('wf:s:0')
  })
  it('envelope가 없으면 messageId로 폴백한다', () => {
    expect(defaultDedupKey({ messageId: 'm1' })).toBe('m1')
  })
  it('messageId·envelope 둘 다 없으면 null을 반환한다(dedup skip)', () => {
    expect(defaultDedupKey({ id: 'x', value: 1 })).toBeNull()
  })
  it('빈 문자열 키는 무시하고 null로 본다', () => {
    expect(defaultDedupKey({ messageId: '', envelope: { idempotencyKey: '' } })).toBeNull()
  })
})

describe('BaseConsumer', () => {
  let noopSleep: (ms: number) => Promise<void>

  beforeEach(() => {
    noopSleep = vi.fn().mockResolvedValue(undefined) as unknown as (ms: number) => Promise<void>
  })

  describe('start / stop', () => {
    it('이미 running 중에 start()를 다시 호출하면 에러를 던진다', async () => {
      const redis = makeRedis({
        xreadgroup: vi.fn().mockReturnValue(new Promise(() => {})),
      })
      const consumer = new BaseConsumer(redis as any, async () => {}, 'test-group', 'test-consumer', 'test:stream', MessageSchema)

      // 첫 번째 start (백그라운드 실행 — never-resolve이므로 루프에 머묾)
      consumer.start('sess-1').catch(() => {})

      // 첫 번째 start가 running 상태를 설정할 시간을 주기 위해 잠시 대기
      await new Promise((r) => setTimeout(r, 0))

      // 두 번째 start — 에러를 던져야 함
      await expect(consumer.start('sess-2')).rejects.toThrow('already running')

      consumer.stop()
    })

    it('start 호출 시 consumer group을 생성한다', async () => {
      const redis = makeRedis()
      const consumer = new BaseConsumer(redis as any, vi.fn(), 'grp', 'c1', 'prefix', MessageSchema, noopSleep)

      let calls = 0
      redis.xreadgroup.mockImplementation(async () => {
        if (calls++ === 0) consumer.stop()
        return null
      })

      await consumer.start('sess-1')
      expect(redis.xgroup).toHaveBeenCalledWith('CREATE', 'prefix:sess-1', 'grp', '$', 'MKSTREAM')
    })

    it('stop() 후 루프가 종료된다', async () => {
      const redis = makeRedis()
      const consumer = new BaseConsumer(redis as any, vi.fn(), 'grp', 'c1', 'prefix', MessageSchema, noopSleep)
      let readCalls = 0

      redis.xreadgroup.mockImplementation(async () => {
        readCalls++
        consumer.stop()
        return null
      })

      await consumer.start('sess-1')
      expect(readCalls).toBe(1)
    })

    it('BUSYGROUP 오류는 무시하고 계속 실행한다', async () => {
      const redis = makeRedis({
        xgroup: vi.fn().mockRejectedValueOnce(new Error('BUSYGROUP Consumer Group name already exists')),
      })
      const consumer = new BaseConsumer(redis as any, vi.fn(), 'grp', 'c1', 'prefix', MessageSchema, noopSleep)

      let calls = 0
      redis.xreadgroup.mockImplementation(async () => {
        if (calls++ === 0) consumer.stop()
        return null
      })

      await expect(consumer.start('sess-1')).resolves.not.toThrow()
    })

    it('BUSYGROUP 외 xgroup 오류는 전파한다', async () => {
      const redis = makeRedis({
        xgroup: vi.fn().mockRejectedValue(new Error('WRONGTYPE error')),
      })
      const consumer = new BaseConsumer(redis as any, vi.fn(), 'grp', 'c1', 'prefix', MessageSchema, noopSleep)

      await expect(consumer.start('sess-1')).rejects.toThrow('WRONGTYPE error')
    })
  })

  describe('메시지 처리', () => {
    it('유효한 메시지를 수신해 핸들러를 호출하고 xack한다', async () => {
      const redis = makeRedis()
      const handler = vi.fn().mockResolvedValue(undefined)
      const consumer = new BaseConsumer(redis as any, handler, 'grp', 'c1', 'prefix', MessageSchema, noopSleep)

      let calls = 0
      redis.xreadgroup.mockImplementation(async () => {
        if (calls++ === 0) {
          return [['prefix:sess-1', [['1-0', ['data', JSON.stringify(validMsg)]]]]]
        }
        consumer.stop()
        return null
      })

      await consumer.start('sess-1')
      expect(handler).toHaveBeenCalledWith(validMsg)
      // pipeline.xack가 호출돼야 하며 pipeline.exec로 일괄 처리됨
      expect(redis.pipeline).toHaveBeenCalled()
      const pipelineInstance = (redis.pipeline as ReturnType<typeof vi.fn>).mock.results[0].value
      expect(pipelineInstance.xack).toHaveBeenCalledWith('prefix:sess-1', 'grp', '1-0')
      expect(pipelineInstance.exec).toHaveBeenCalled()
    })

    it('pipeline 미지원 클라이언트는 개별 xack로 폴백한다', async () => {
      // pipeline 메서드가 없는 클라이언트(ioredis 호환 mock 등) 시뮬레이션
      const redis = makeRedis()
      delete (redis as Record<string, unknown>)['pipeline']
      const handler = vi.fn().mockResolvedValue(undefined)
      const consumer = new BaseConsumer(redis as any, handler, 'grp', 'c1', 'prefix', MessageSchema, noopSleep)

      let calls = 0
      redis.xreadgroup.mockImplementation(async () => {
        if (calls++ === 0) {
          return [['prefix:sess-1', [['1-0', ['data', JSON.stringify(validMsg)]]]]]
        }
        consumer.stop()
        return null
      })

      await consumer.start('sess-1')
      expect(handler).toHaveBeenCalledWith(validMsg)
      // pipeline이 없으므로 redis.xack가 직접 호출됨
      expect(redis.xack).toHaveBeenCalledWith('prefix:sess-1', 'grp', '1-0')
    })

    it('핸들러가 maxDeliveries회 실패하면 DLQ로 격리하고 xack한다', async () => {
      const redis = makeRedis()
      const handler = vi.fn().mockRejectedValue(new Error('handler error'))
      const consumer = new BaseConsumer(redis as any, handler, 'grp', 'c1', 'prefix', MessageSchema, noopSleep)

      let calls = 0
      redis.xreadgroup.mockImplementation(async () => {
        if (calls++ === 0) return [['prefix:sess-1', [['1-0', ['data', JSON.stringify(validMsg)]]]]]
        consumer.stop()
        return null
      })

      await consumer.start('sess-1')
      expect(handler).toHaveBeenCalledTimes(3) // 기본 maxDeliveries
      const dlqCall = redis.xadd.mock.calls.find((c) => c[0] === 'prefix:sess-1:dlq')
      expect(dlqCall).toBeTruthy()
      const dlqPayload = dlqPayloadOf(dlqCall!)
      expect(dlqPayload.reason).toBe('handler_failed')
      expect(dlqPayload.attempts).toBe(3)
      expect(dlqPayload.sourceStream).toBe('prefix:sess-1')
      expect(dlqPayload.original).toBe(JSON.stringify(validMsg)) // 원본 보존
      expect(dlqPayload.error).toBe('handler error')
      expect(typeof dlqPayload.failedAt).toBe('number')
      // 백오프: 시도 1·2 실패 후 sleep(500, 1000), 마지막 시도 3 후엔 sleep 없음
      expect(noopSleep).toHaveBeenCalledTimes(2)
      expect(noopSleep).toHaveBeenNthCalledWith(1, 500)
      expect(noopSleep).toHaveBeenNthCalledWith(2, 1000)
      const pipelineInstance = (redis.pipeline as ReturnType<typeof vi.fn>).mock.results[0].value
      expect(pipelineInstance.xack).toHaveBeenCalledWith('prefix:sess-1', 'grp', '1-0')
    })

    it('maxDeliveries<=0이어도 최소 1회 시도하고 실패 시 DLQ한다(손실 방지)', async () => {
      const redis = makeRedis()
      const handler = vi.fn().mockRejectedValue(new Error('fail'))
      const consumer = new BaseConsumer(
        redis as any, handler, 'grp', 'c1', 'prefix', MessageSchema, noopSleep, true, 0,
      )

      let calls = 0
      redis.xreadgroup.mockImplementation(async () => {
        if (calls++ === 0) return [['prefix:sess-1', [['1-0', ['data', JSON.stringify(validMsg)]]]]]
        consumer.stop()
        return null
      })

      await consumer.start('sess-1')
      expect(handler).toHaveBeenCalledTimes(1) // 클램프로 최소 1회
      expect(redis.xadd).toHaveBeenCalledTimes(1) // 손실 없이 DLQ
    })

    it('일시 실패 후 성공하면 재시도하고 DLQ로 보내지 않는다', async () => {
      const redis = makeRedis()
      const handler = vi.fn()
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValueOnce(undefined)
      const consumer = new BaseConsumer(redis as any, handler, 'grp', 'c1', 'prefix', MessageSchema, noopSleep)

      let calls = 0
      redis.xreadgroup.mockImplementation(async () => {
        if (calls++ === 0) return [['prefix:sess-1', [['1-0', ['data', JSON.stringify(validMsg)]]]]]
        consumer.stop()
        return null
      })

      await consumer.start('sess-1')
      expect(handler).toHaveBeenCalledTimes(2)
      expect(redis.xadd).not.toHaveBeenCalled()
    })

    it('maxDeliveries=1이면 재시도 없이 즉시 DLQ한다', async () => {
      const redis = makeRedis()
      const handler = vi.fn().mockRejectedValue(new Error('fail'))
      const consumer = new BaseConsumer(
        redis as any, handler, 'grp', 'c1', 'prefix', MessageSchema, noopSleep, true, 1,
      )

      let calls = 0
      redis.xreadgroup.mockImplementation(async () => {
        if (calls++ === 0) return [['prefix:sess-1', [['1-0', ['data', JSON.stringify(validMsg)]]]]]
        consumer.stop()
        return null
      })

      await consumer.start('sess-1')
      expect(handler).toHaveBeenCalledTimes(1)
      expect(redis.xadd).toHaveBeenCalledTimes(1)
    })

    it('스키마 검증 실패 시 핸들러를 호출하지 않고 xack한다', async () => {
      const redis = makeRedis()
      const handler = vi.fn()
      const consumer = new BaseConsumer(redis as any, handler, 'grp', 'c1', 'prefix', MessageSchema, noopSleep)

      let calls = 0
      redis.xreadgroup.mockImplementation(async () => {
        if (calls++ === 0) {
          return [['prefix:sess-1', [['1-0', ['data', JSON.stringify({ invalid: true })]]]]]
        }
        consumer.stop()
        return null
      })

      await consumer.start('sess-1')
      expect(handler).not.toHaveBeenCalled()
      const dlqCall = redis.xadd.mock.calls.find((c) => c[0] === 'prefix:sess-1:dlq')
      expect(dlqCall).toBeTruthy()
      const dlqPayload = dlqPayloadOf(dlqCall!)
      expect(dlqPayload.reason).toBe('invalid_schema')
      expect(dlqPayload.attempts).toBe(0) // 비재시도성
      const pipelineInstance = (redis.pipeline as ReturnType<typeof vi.fn>).mock.results[0].value
      expect(pipelineInstance.xack).toHaveBeenCalledWith('prefix:sess-1', 'grp', '1-0')
    })

    it('JSON 파싱 실패 시 xack하고 skip한다', async () => {
      const redis = makeRedis()
      const handler = vi.fn()
      const consumer = new BaseConsumer(redis as any, handler, 'grp', 'c1', 'prefix', MessageSchema, noopSleep)

      let calls = 0
      redis.xreadgroup.mockImplementation(async () => {
        if (calls++ === 0) {
          return [['prefix:sess-1', [['1-0', ['data', 'not-valid-json']]]]]
        }
        consumer.stop()
        return null
      })

      await consumer.start('sess-1')
      expect(handler).not.toHaveBeenCalled()
      const dlqCall = redis.xadd.mock.calls.find((c) => c[0] === 'prefix:sess-1:dlq')
      expect(dlqCall).toBeTruthy()
      const dlqPayload = dlqPayloadOf(dlqCall!)
      expect(dlqPayload.reason).toBe('invalid_schema')
      expect(dlqPayload.attempts).toBe(0) // 비재시도성
      const pipelineInstance = (redis.pipeline as ReturnType<typeof vi.fn>).mock.results[0].value
      expect(pipelineInstance.xack).toHaveBeenCalledWith('prefix:sess-1', 'grp', '1-0')
    })

    it('data 필드가 없는 메시지는 xack하고 skip한다', async () => {
      const redis = makeRedis()
      const handler = vi.fn()
      const consumer = new BaseConsumer(redis as any, handler, 'grp', 'c1', 'prefix', MessageSchema, noopSleep)

      let calls = 0
      redis.xreadgroup.mockImplementation(async () => {
        if (calls++ === 0) {
          return [['prefix:sess-1', [['1-0', ['other', 'field']]]]]
        }
        consumer.stop()
        return null
      })

      await consumer.start('sess-1')
      expect(handler).not.toHaveBeenCalled()
      expect(redis.xadd).not.toHaveBeenCalled() // 구조적 결함은 DLQ 미발행(보존할 페이로드 없음)
      const pipelineInstance = (redis.pipeline as ReturnType<typeof vi.fn>).mock.results[0].value
      expect(pipelineInstance.xack).toHaveBeenCalledWith('prefix:sess-1', 'grp', '1-0')
    })

    it('data 필드 값이 undefined인 경우 xack하고 skip한다', async () => {
      const redis = makeRedis()
      const handler = vi.fn()
      const consumer = new BaseConsumer(redis as any, handler, 'grp', 'c1', 'prefix', MessageSchema, noopSleep)

      let calls = 0
      redis.xreadgroup.mockImplementation(async () => {
        if (calls++ === 0) {
          // fields array: ['data'] with no following value
          return [['prefix:sess-1', [['1-0', ['data']]]]]
        }
        consumer.stop()
        return null
      })

      await consumer.start('sess-1')
      expect(handler).not.toHaveBeenCalled()
      expect(redis.xadd).not.toHaveBeenCalled()
      const pipelineInstance = (redis.pipeline as ReturnType<typeof vi.fn>).mock.results[0].value
      expect(pipelineInstance.xack).toHaveBeenCalledWith('prefix:sess-1', 'grp', '1-0')
    })

    it('10MiB 초과 메시지는 xack하고 skip한다', async () => {
      const redis = makeRedis()
      const handler = vi.fn()
      const consumer = new BaseConsumer(redis as any, handler, 'grp', 'c1', 'prefix', MessageSchema, noopSleep)

      const hugePayload = 'x'.repeat(11 * 1024 * 1024)
      let calls = 0
      redis.xreadgroup.mockImplementation(async () => {
        if (calls++ === 0) {
          return [['prefix:sess-1', [['1-0', ['data', hugePayload]]]]]
        }
        consumer.stop()
        return null
      })

      await consumer.start('sess-1')
      expect(handler).not.toHaveBeenCalled()
      expect(redis.xadd).not.toHaveBeenCalled()
      const pipelineInstance = (redis.pipeline as ReturnType<typeof vi.fn>).mock.results[0].value
      expect(pipelineInstance.xack).toHaveBeenCalledWith('prefix:sess-1', 'grp', '1-0')
    })

    it('배치 중간의 poison 메시지가 나머지 메시지 처리를 막지 않는다', async () => {
      const redis = makeRedis()
      const good: Message = { id: 'good', value: 1 }
      const handler = vi.fn().mockImplementation(async (m: Message) => {
        if (m.id === 'bad') throw new Error('poison')
      })
      const consumer = new BaseConsumer(
        redis as any, handler, 'grp', 'c1', 'prefix', MessageSchema, noopSleep, true, 1,
      )

      let calls = 0
      redis.xreadgroup.mockImplementation(async () => {
        if (calls++ === 0) return [['prefix:sess-1', [
          ['1-0', ['data', JSON.stringify({ id: 'bad', value: 0 })]],
          ['2-0', ['data', JSON.stringify(good)]],
        ]]]
        consumer.stop()
        return null
      })

      await consumer.start('sess-1')
      expect(handler).toHaveBeenCalledWith(good) // poison 이후 메시지도 처리됨
      expect(redis.xadd).toHaveBeenCalledTimes(1) // poison만 DLQ
      const pipelineInstance = (redis.pipeline as ReturnType<typeof vi.fn>).mock.results[0].value
      expect(pipelineInstance.xack).toHaveBeenCalledWith('prefix:sess-1', 'grp', '1-0')
      expect(pipelineInstance.xack).toHaveBeenCalledWith('prefix:sess-1', 'grp', '2-0')
    })

    it('DLQ 발행(xadd)이 실패해도 throw 없이 배치를 계속한다', async () => {
      const redis = makeRedis({ xadd: vi.fn().mockRejectedValue(new Error('redis down')) })
      const handler = vi.fn().mockRejectedValue(new Error('poison'))
      const consumer = new BaseConsumer(
        redis as any, handler, 'grp', 'c1', 'prefix', MessageSchema, noopSleep, true, 1,
      )

      let calls = 0
      redis.xreadgroup.mockImplementation(async () => {
        if (calls++ === 0) return [['prefix:sess-1', [['1-0', ['data', JSON.stringify(validMsg)]]]]]
        consumer.stop()
        return null
      })

      await expect(consumer.start('sess-1')).resolves.not.toThrow()
      const pipelineInstance = (redis.pipeline as ReturnType<typeof vi.fn>).mock.results[0].value
      expect(pipelineInstance.xack).toHaveBeenCalledWith('prefix:sess-1', 'grp', '1-0') // DLQ 실패해도 ack
    })
  })

  describe('오류 처리 및 재시도', () => {
    it('xreadgroup 오류 시 지수 백오프로 재시도한다', async () => {
      const redis = makeRedis()
      const consumer = new BaseConsumer(redis as any, vi.fn(), 'grp', 'c1', 'prefix', MessageSchema, noopSleep)

      let calls = 0
      redis.xreadgroup.mockImplementation(async () => {
        calls++
        if (calls === 1) throw new Error('connection error')
        consumer.stop()
        return null
      })

      await consumer.start('sess-1')
      expect(redis.xreadgroup).toHaveBeenCalledTimes(2)
      expect(noopSleep).toHaveBeenCalledWith(1000)
    })

    it('stop() 후 오류 발생 시 재시도하지 않는다', async () => {
      const redis = makeRedis()
      const consumer = new BaseConsumer(redis as any, vi.fn(), 'grp', 'c1', 'prefix', MessageSchema, noopSleep)

      redis.xreadgroup.mockImplementation(async () => {
        consumer.stop()
        throw new Error('connection error')
      })

      await consumer.start('sess-1')
      expect(noopSleep).not.toHaveBeenCalled()
    })

    it('NOGROUP 오류 시 그룹을 재생성한다', async () => {
      const redis = makeRedis()
      const consumer = new BaseConsumer(redis as any, vi.fn(), 'grp', 'c1', 'prefix', MessageSchema, noopSleep)

      let calls = 0
      redis.xreadgroup.mockImplementation(async () => {
        calls++
        if (calls === 1) throw new Error('NOGROUP group does not exist')
        consumer.stop()
        return null
      })

      await consumer.start('sess-1')
      expect(redis.xgroup).toHaveBeenCalledTimes(2)
    })

    it('xreadgroup이 null 반환 시 다음 반복을 계속한다', async () => {
      const redis = makeRedis()
      const consumer = new BaseConsumer(redis as any, vi.fn(), 'grp', 'c1', 'prefix', MessageSchema, noopSleep)

      let calls = 0
      redis.xreadgroup.mockImplementation(async () => {
        if (calls++ >= 2) consumer.stop()
        return null
      })

      await consumer.start('sess-1')
      expect(redis.xreadgroup).toHaveBeenCalledTimes(3)
    })
  })

  describe('XAUTOCLAIM 재처리 (claimPendingMessages)', () => {
    it('start() 시 XAUTOCLAIM을 호출해 pending 메시지를 재처리한다', async () => {
      const redis = makeRedis()
      const handler = vi.fn().mockResolvedValue(undefined)
      const pendingMsg: Message = { id: 'pending-1', value: 99 }

      // xautoclaim이 pending 메시지 1건을 반환하도록 설정
      redis.xautoclaim.mockResolvedValueOnce([
        '0-0',
        [['2-0', ['data', JSON.stringify(pendingMsg)]]],
        [],
      ])

      const consumer = new BaseConsumer(redis as any, handler, 'grp', 'c1', 'prefix', MessageSchema, noopSleep)

      let readCalls = 0
      redis.xreadgroup.mockImplementation(async () => {
        if (readCalls++ === 0) consumer.stop()
        return null
      })

      await consumer.start('sess-1')

      expect(redis.xautoclaim).toHaveBeenCalledWith(
        'prefix:sess-1',
        'grp',
        'c1',
        300000, // 5 * 60 * 1000
        '0-0',
        'COUNT', '10',
      )
      expect(handler).toHaveBeenCalledWith(pendingMsg)
      // claimPendingMessages → processMessages → pipeline xack
      expect(redis.pipeline).toHaveBeenCalled()
      const pipelineInstance = (redis.pipeline as ReturnType<typeof vi.fn>).mock.results[0].value
      expect(pipelineInstance.xack).toHaveBeenCalledWith('prefix:sess-1', 'grp', '2-0')
    })

    it('reclaim된 poison 메시지도 maxDeliveries 후 DLQ로 격리한다(무한 reclaim 방지)', async () => {
      const redis = makeRedis()
      const handler = vi.fn().mockRejectedValue(new Error('poison'))
      const pendingMsg: Message = { id: 'pending-bad', value: 7 }
      redis.xautoclaim.mockResolvedValueOnce([
        '0-0',
        [['2-0', ['data', JSON.stringify(pendingMsg)]]],
        [],
      ])
      const consumer = new BaseConsumer(
        redis as any, handler, 'grp', 'c1', 'prefix', MessageSchema, noopSleep, true, 1,
      )

      let readCalls = 0
      redis.xreadgroup.mockImplementation(async () => {
        if (readCalls++ === 0) consumer.stop()
        return null
      })

      await consumer.start('sess-1')
      expect(handler).toHaveBeenCalledWith(pendingMsg)
      const dlqCall = redis.xadd.mock.calls.find((c) => c[0] === 'prefix:sess-1:dlq')
      expect(dlqCall).toBeTruthy()
      expect(dlqPayloadOf(dlqCall!).reason).toBe('handler_failed')
      // reclaim 메시지도 ack(PEL에서 제거 → 무한 reclaim 방지)
      const pipelineInstance = (redis.pipeline as ReturnType<typeof vi.fn>).mock.results[0].value
      expect(pipelineInstance.xack).toHaveBeenCalledWith('prefix:sess-1', 'grp', '2-0')
    })

    it('XAUTOCLAIM이 배열이 아닌 값을 반환해도 정상 실행된다 (invalid format)', async () => {
      const redis = makeRedis({
        xautoclaim: vi.fn().mockResolvedValueOnce(null),  // null 반환 — Array.isArray 검증 실패
      })
      const consumer = new BaseConsumer(redis as any, vi.fn(), 'grp', 'c1', 'prefix', MessageSchema, noopSleep)

      let calls = 0
      redis.xreadgroup.mockImplementation(async () => {
        if (calls++ === 0) consumer.stop()
        return null
      })

      await expect(consumer.start('sess-1')).resolves.not.toThrow()
    })

    it('XAUTOCLAIM이 result[1]이 배열이 아닌 경우 processMessages를 건너뛴다', async () => {
      const onMessage = vi.fn()
      const redis = makeRedis({
        xautoclaim: vi.fn().mockResolvedValueOnce(['cursor', 'not-an-array', []]),
      })
      const consumer = new BaseConsumer(redis as any, onMessage, 'grp', 'c1', 'prefix', MessageSchema, noopSleep)

      let calls = 0
      redis.xreadgroup.mockImplementation(async () => {
        if (calls++ === 0) consumer.stop()
        return null
      })

      await consumer.start('sess-1')
      expect(onMessage).not.toHaveBeenCalled()
    })

    it('XAUTOCLAIM이 에러를 던져도 start()가 정상 실행된다 (미지원 버전 호환)', async () => {
      const redis = makeRedis({
        xautoclaim: vi.fn().mockRejectedValue(new Error('ERR unknown command `XAUTOCLAIM`')),
      })
      const consumer = new BaseConsumer(redis as any, vi.fn(), 'grp', 'c1', 'prefix', MessageSchema, noopSleep)

      let calls = 0
      redis.xreadgroup.mockImplementation(async () => {
        if (calls++ === 0) consumer.stop()
        return null
      })

      await expect(consumer.start('sess-1')).resolves.not.toThrow()
    })
  })

  describe('ownsRedis 플래그 (close)', () => {
    it('ownsRedis=true(기본값)이면 close() 시 redis.quit()을 호출한다', async () => {
      const redis = makeRedis()
      // ownsRedis 기본값(true) 사용
      const consumer = new BaseConsumer(redis as any, vi.fn(), 'grp', 'c1', 'prefix', MessageSchema, noopSleep)

      await consumer.close()

      expect(redis.quit).toHaveBeenCalledTimes(1)
    })

    it('ownsRedis=false이면 close() 시 redis.quit()을 호출하지 않는다', async () => {
      const redis = makeRedis()
      const consumer = new BaseConsumer(
        redis as any, vi.fn(), 'grp', 'c1', 'prefix', MessageSchema, noopSleep,
        false, // ownsRedis = false
      )

      await consumer.close()

      expect(redis.quit).not.toHaveBeenCalled()
    })
  })

  describe('멱등 소비(dedup)', () => {
    const keyById = { key: (m: Message) => m.id } // {id,value} 스키마용 커스텀 추출기
    afterEach(() => vi.unstubAllEnvs())

    /** 단일 메시지를 1회 delivery하고 stop하는 xreadgroup mock. */
    function deliverOnce(redis: ReturnType<typeof makeRedis>, consumer: BaseConsumer<Message>, msg: unknown) {
      let calls = 0
      redis.xreadgroup.mockImplementation(async () => {
        if (calls++ === 0) return [['prefix:sess-1', [['1-0', ['data', JSON.stringify(msg)]]]]]
        consumer.stop(); return null
      })
    }

    it('신규 키는 SETNX 후 핸들러를 1회 호출한다', async () => {
      const redis = makeRedis() // set → 'OK'(신규)
      const handler = vi.fn().mockResolvedValue(undefined)
      const consumer = new BaseConsumer(
        redis as any, handler, 'grp', 'c1', 'prefix', MessageSchema, noopSleep, true, 3,
        { ...keyById, ttlSec: 100 },
      )
      let calls = 0
      redis.xreadgroup.mockImplementation(async () => {
        if (calls++ === 0) return [['prefix:sess-1', [['1-0', ['data', JSON.stringify(validMsg)]]]]]
        consumer.stop(); return null
      })
      await consumer.start('sess-1')
      expect(handler).toHaveBeenCalledWith(validMsg)
      expect(redis.set).toHaveBeenCalledWith('idem:prefix:sess-1:msg-1', '1', 'EX', 100, 'NX')
    })

    it('중복 키(SETNX null)면 핸들러를 호출하지 않고 ack한다', async () => {
      const redis = makeRedis({ set: vi.fn().mockResolvedValue(null) }) // 이미 존재
      const handler = vi.fn().mockResolvedValue(undefined)
      const consumer = new BaseConsumer(
        redis as any, handler, 'grp', 'c1', 'prefix', MessageSchema, noopSleep, true, 3, keyById,
      )
      let calls = 0
      redis.xreadgroup.mockImplementation(async () => {
        if (calls++ === 0) return [['prefix:sess-1', [['1-0', ['data', JSON.stringify(validMsg)]]]]]
        consumer.stop(); return null
      })
      await consumer.start('sess-1')
      expect(handler).not.toHaveBeenCalled()
      const pipelineInstance = (redis.pipeline as ReturnType<typeof vi.fn>).mock.results[0].value
      expect(pipelineInstance.xack).toHaveBeenCalledWith('prefix:sess-1', 'grp', '1-0') // skip+ack
    })

    it('키가 null(messageId·envelope 없음)이면 SETNX 없이 처리한다', async () => {
      const redis = makeRedis()
      const handler = vi.fn().mockResolvedValue(undefined)
      // 기본 추출기 사용 → {id,value}엔 messageId/envelope 없음 → null → dedup skip
      const consumer = new BaseConsumer(redis as any, handler, 'grp', 'c1', 'prefix', MessageSchema, noopSleep)
      let calls = 0
      redis.xreadgroup.mockImplementation(async () => {
        if (calls++ === 0) return [['prefix:sess-1', [['1-0', ['data', JSON.stringify(validMsg)]]]]]
        consumer.stop(); return null
      })
      await consumer.start('sess-1')
      expect(handler).toHaveBeenCalledWith(validMsg)
      expect(redis.set).not.toHaveBeenCalled()
    })

    it('SETNX가 throw하면 fail-open으로 처리를 계속한다', async () => {
      const redis = makeRedis({ set: vi.fn().mockRejectedValue(new Error('redis down')) })
      const handler = vi.fn().mockResolvedValue(undefined)
      const consumer = new BaseConsumer(
        redis as any, handler, 'grp', 'c1', 'prefix', MessageSchema, noopSleep, true, 3, keyById,
      )
      let calls = 0
      redis.xreadgroup.mockImplementation(async () => {
        if (calls++ === 0) return [['prefix:sess-1', [['1-0', ['data', JSON.stringify(validMsg)]]]]]
        consumer.stop(); return null
      })
      await consumer.start('sess-1')
      expect(handler).toHaveBeenCalledWith(validMsg) // fail-open
    })

    it('enabled=false면 키가 있어도 SETNX를 호출하지 않는다', async () => {
      const redis = makeRedis()
      const handler = vi.fn().mockResolvedValue(undefined)
      const consumer = new BaseConsumer(
        redis as any, handler, 'grp', 'c1', 'prefix', MessageSchema, noopSleep, true, 3,
        { ...keyById, enabled: false },
      )
      let calls = 0
      redis.xreadgroup.mockImplementation(async () => {
        if (calls++ === 0) return [['prefix:sess-1', [['1-0', ['data', JSON.stringify(validMsg)]]]]]
        consumer.stop(); return null
      })
      await consumer.start('sess-1')
      expect(handler).toHaveBeenCalledWith(validMsg)
      expect(redis.set).not.toHaveBeenCalled()
    })

    it('P1a 재시도는 dedup에 막히지 않는다(SETNX는 delivery당 1회)', async () => {
      const redis = makeRedis() // set → 'OK'
      const handler = vi.fn()
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValueOnce(undefined)
      const consumer = new BaseConsumer(
        redis as any, handler, 'grp', 'c1', 'prefix', MessageSchema, noopSleep, true, 3, keyById,
      )
      let calls = 0
      redis.xreadgroup.mockImplementation(async () => {
        if (calls++ === 0) return [['prefix:sess-1', [['1-0', ['data', JSON.stringify(validMsg)]]]]]
        consumer.stop(); return null
      })
      await consumer.start('sess-1')
      expect(handler).toHaveBeenCalledTimes(2) // 재시도 정상
      expect(redis.set).toHaveBeenCalledTimes(1) // dedup claim은 1회
      expect(redis.xadd).not.toHaveBeenCalled() // DLQ 아님
    })

    it('ttlSec 미지정 시 기본 86400으로 SETNX한다', async () => {
      const redis = makeRedis()
      const handler = vi.fn().mockResolvedValue(undefined)
      const consumer = new BaseConsumer(
        redis as any, handler, 'grp', 'c1', 'prefix', MessageSchema, noopSleep, true, 3, keyById,
      )
      let calls = 0
      redis.xreadgroup.mockImplementation(async () => {
        if (calls++ === 0) return [['prefix:sess-1', [['1-0', ['data', JSON.stringify(validMsg)]]]]]
        consumer.stop(); return null
      })
      await consumer.start('sess-1')
      expect(redis.set).toHaveBeenCalledWith('idem:prefix:sess-1:msg-1', '1', 'EX', 86400, 'NX')
    })

    it('명시 ttlSec:0이어도 최소 1로 클램프해 EX 0(Redis 거부)을 보내지 않는다', async () => {
      const redis = makeRedis()
      const consumer = new BaseConsumer(
        redis as any, vi.fn().mockResolvedValue(undefined), 'grp', 'c1', 'prefix', MessageSchema,
        noopSleep, true, 3, { ...keyById, ttlSec: 0 },
      )
      deliverOnce(redis, consumer, validMsg)
      await consumer.start('sess-1')
      const exArg = (redis.set as ReturnType<typeof vi.fn>).mock.calls[0][3]
      expect(exArg).toBeGreaterThanOrEqual(1)
    })

    it('같은 키 2회 delivery면 첫 번째만 처리하고 두 번째는 skip한다(핵심 멱등 보장)', async () => {
      const claimed = new Set<string>()
      const redis = makeRedis({
        set: vi.fn().mockImplementation((k: string) => {
          if (claimed.has(k)) return Promise.resolve(null) // 이미 존재 → 중복
          claimed.add(k); return Promise.resolve('OK')      // 신규 claim
        }),
      })
      const handler = vi.fn().mockResolvedValue(undefined)
      const consumer = new BaseConsumer(
        redis as any, handler, 'grp', 'c1', 'prefix', MessageSchema, noopSleep, true, 3, keyById,
      )
      let calls = 0
      redis.xreadgroup.mockImplementation(async () => {
        // 같은 stream 엔트리('1-0', 동일 메시지)를 두 배치에 걸쳐 재전달
        if (calls < 2) { calls++; return [['prefix:sess-1', [['1-0', ['data', JSON.stringify(validMsg)]]]]] }
        consumer.stop(); return null
      })
      await consumer.start('sess-1')
      expect(handler).toHaveBeenCalledTimes(1) // 첫 delivery만 처리
      expect(redis.set).toHaveBeenCalledTimes(2) // 두 delivery 모두 SETNX 시도(두 번째 null→skip)
    })

    it('기본 추출기: messageId 메시지가 SETNX 키로 흐른다(통합 경로)', async () => {
      const redis = makeRedis()
      const schema = z.object({ messageId: z.string(), value: z.number() })
      const consumer = new BaseConsumer(
        redis as any, vi.fn().mockResolvedValue(undefined), 'grp', 'c1', 'prefix', schema, noopSleep,
      )
      deliverOnce(redis, consumer as unknown as BaseConsumer<Message>, { messageId: 'mid-7', value: 1 })
      await consumer.start('sess-1')
      expect(redis.set).toHaveBeenCalledWith('idem:prefix:sess-1:mid-7', '1', 'EX', 86400, 'NX')
    })

    it('기본 추출기: envelope.idempotencyKey가 messageId보다 우선한다(통합 경로)', async () => {
      const redis = makeRedis()
      const schema = z.object({
        messageId: z.string(), envelope: z.object({ idempotencyKey: z.string() }), value: z.number(),
      })
      const consumer = new BaseConsumer(
        redis as any, vi.fn().mockResolvedValue(undefined), 'grp', 'c1', 'prefix', schema, noopSleep,
      )
      deliverOnce(redis, consumer as unknown as BaseConsumer<Message>,
        { messageId: 'mid-7', envelope: { idempotencyKey: 'wf:s:0' }, value: 1 })
      await consumer.start('sess-1')
      expect(redis.set).toHaveBeenCalledWith('idem:prefix:sess-1:wf:s:0', '1', 'EX', 86400, 'NX')
    })

    it('SHARED_IDEM_TTL_SEC 유효 정수면 그 값으로 SETNX한다(env 경로)', async () => {
      vi.stubEnv('SHARED_IDEM_TTL_SEC', '120')
      const redis = makeRedis()
      const consumer = new BaseConsumer(
        redis as any, vi.fn().mockResolvedValue(undefined), 'grp', 'c1', 'prefix', MessageSchema,
        noopSleep, true, 3, keyById, // ttlSec 미주입 → env에서 해석
      )
      deliverOnce(redis, consumer, validMsg)
      await consumer.start('sess-1')
      expect(redis.set).toHaveBeenCalledWith('idem:prefix:sess-1:msg-1', '1', 'EX', 120, 'NX')
    })

    it('SHARED_IDEM_TTL_SEC가 비숫자면 기본 86400으로 폴백한다(env NaN 방어)', async () => {
      vi.stubEnv('SHARED_IDEM_TTL_SEC', 'abc')
      const redis = makeRedis()
      const consumer = new BaseConsumer(
        redis as any, vi.fn().mockResolvedValue(undefined), 'grp', 'c1', 'prefix', MessageSchema,
        noopSleep, true, 3, keyById,
      )
      deliverOnce(redis, consumer, validMsg)
      await consumer.start('sess-1')
      expect(redis.set).toHaveBeenCalledWith('idem:prefix:sess-1:msg-1', '1', 'EX', 86400, 'NX')
    })

    it('SHARED_IDEMPOTENT_CONSUME=false면 dedup 미동작(env kill-switch)', async () => {
      vi.stubEnv('SHARED_IDEMPOTENT_CONSUME', 'false')
      const redis = makeRedis()
      const handler = vi.fn().mockResolvedValue(undefined)
      const consumer = new BaseConsumer(
        redis as any, handler, 'grp', 'c1', 'prefix', MessageSchema, noopSleep, true, 3, keyById,
      )
      deliverOnce(redis, consumer, validMsg)
      await consumer.start('sess-1')
      expect(redis.set).not.toHaveBeenCalled()
      expect(handler).toHaveBeenCalledWith(validMsg)
    })

    it('SHARED_IDEMPOTENT_CONSUME 미설정이면 기본 ON(env 기본값)', async () => {
      vi.stubEnv('SHARED_IDEMPOTENT_CONSUME', undefined)
      const redis = makeRedis()
      const consumer = new BaseConsumer(
        redis as any, vi.fn().mockResolvedValue(undefined), 'grp', 'c1', 'prefix', MessageSchema,
        noopSleep, true, 3, keyById,
      )
      deliverOnce(redis, consumer, validMsg)
      await consumer.start('sess-1')
      expect(redis.set).toHaveBeenCalled() // 기본 ON
    })
  })
})
