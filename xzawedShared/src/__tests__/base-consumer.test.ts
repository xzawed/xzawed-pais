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
  return {
    xgroup: vi.fn().mockResolvedValue('OK'),
    xreadgroup: vi.fn().mockResolvedValue(null),
    xack: vi.fn().mockResolvedValue(1),
    ...overrides,
  }
}

describe('BaseConsumer', () => {
  let noopSleep: (ms: number) => Promise<void>

  beforeEach(() => {
    noopSleep = vi.fn().mockResolvedValue(undefined) as unknown as (ms: number) => Promise<void>
  })

  describe('start / stop', () => {
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
      expect(redis.xack).toHaveBeenCalledWith('prefix:sess-1', 'grp', '1-0')
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
      expect(redis.xack).toHaveBeenCalledWith('prefix:sess-1', 'grp', '1-0')
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
      expect(redis.xack).toHaveBeenCalledWith('prefix:sess-1', 'grp', '1-0')
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
      expect(redis.xack).toHaveBeenCalledWith('prefix:sess-1', 'grp', '1-0')
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
      expect(redis.xack).toHaveBeenCalledWith('prefix:sess-1', 'grp', '1-0')
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
      expect(redis.xack).toHaveBeenCalledWith('prefix:sess-1', 'grp', '1-0')
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
})
