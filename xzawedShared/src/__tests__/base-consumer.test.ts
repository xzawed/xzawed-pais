import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import { BaseConsumer } from '../streams/base-consumer.js'

const MessageSchema = z.object({
  id: z.string(),
  value: z.number(),
})

type Message = z.infer<typeof MessageSchema>

const validMsg: Message = { id: 'msg-1', value: 42 }

function makeRedis(overrides: Record<string, unknown> = {}) {
  // pipeline mock: exec()가 xack 결과 배열을 반환한다
  const makePipeline = () => {
    const ops: Array<() => Promise<unknown>> = []
    const p = {
      xack: vi.fn().mockImplementation(() => { ops.push(() => Promise.resolve(1)); return p }),
      exec: vi.fn().mockImplementation(() => Promise.resolve(ops.map(() => [null, 1]))),
    }
    return p
  }
  return {
    xgroup: vi.fn().mockResolvedValue('OK'),
    xreadgroup: vi.fn().mockResolvedValue(null),
    xack: vi.fn().mockResolvedValue(1),
    xautoclaim: vi.fn().mockResolvedValue(['0-0', [], []]),
    quit: vi.fn().mockResolvedValue('OK'),
    pipeline: vi.fn().mockImplementation(makePipeline),
    ...overrides,
  }
}

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

    it('핸들러가 예외를 던져도 xack를 실행한다', async () => {
      const redis = makeRedis()
      const handler = vi.fn().mockRejectedValue(new Error('handler error'))
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
      expect(redis.pipeline).toHaveBeenCalled()
      const pipelineInstance = (redis.pipeline as ReturnType<typeof vi.fn>).mock.results[0].value
      expect(pipelineInstance.xack).toHaveBeenCalledWith('prefix:sess-1', 'grp', '1-0')
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
      const pipelineInstance = (redis.pipeline as ReturnType<typeof vi.fn>).mock.results[0].value
      expect(pipelineInstance.xack).toHaveBeenCalledWith('prefix:sess-1', 'grp', '1-0')
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
})
