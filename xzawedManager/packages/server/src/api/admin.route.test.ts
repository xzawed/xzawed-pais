import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'
import type { DlqRedis } from '@xzawed/agent-streams'
import { adminRoute } from './admin.route.js'

/** routeToDlq 봉투 'data' 문자열. */
function dlqEntry(messageId: string, reason = 'handler_failed', sourceStream = 'manager:dispatched:main'): string {
  return JSON.stringify({
    original: JSON.stringify({ messageId, value: 1 }),
    reason,
    attempts: reason === 'handler_failed' ? 3 : 0,
    failedAt: 1,
    sourceStream,
  })
}

function fakeRedis(entries: Array<[string, string[]]> = []): DlqRedis & Record<string, ReturnType<typeof vi.fn>> {
  return {
    xrange: vi.fn().mockResolvedValue(entries),
    xadd: vi.fn().mockResolvedValue('1-0'),
    xdel: vi.fn().mockResolvedValue(1),
    del: vi.fn().mockResolvedValue(1),
  }
}

function appWith(redis: DlqRedis, extra: Record<string, unknown> = {}) {
  const app = Fastify()
  return app
    .register(adminRoute, { redisUrl: 'redis://x', getRedis: () => redis, ...extra })
    .then(() => app)
}

describe('adminRoute — POST /api/admin/dlq/redrive', () => {
  it('유효 본문이면 200·redrive 결과를 반환(실 redriveDlq 경유)', async () => {
    const redis = fakeRedis([['100-0', ['data', dlqEntry('m1')]]])
    const app = await appWith(redis)
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/dlq/redrive',
      payload: { sourceStream: 'manager:dispatched:main' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ read: 1, republished: 1, skipped: 0 })
    // 실 redriveDlq가 원 스트림으로 재발행
    expect(redis.xadd).toHaveBeenCalledWith('manager:dispatched:main', '*', 'data', JSON.stringify({ messageId: 'm1', value: 1 }))
  })

  it('count·reason을 redrive로 전달한다', async () => {
    const redis = fakeRedis([])
    const app = await appWith(redis)
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/dlq/redrive',
      payload: { sourceStream: 'manager:completions:main', count: 25, reason: 'handler_failed' },
    })
    expect(res.statusCode).toBe(200)
    expect(redis.xrange).toHaveBeenCalledWith('manager:completions:main:dlq', '-', '+', 'COUNT', 25)
  })

  it('sourceStream 누락이면 400', async () => {
    const app = await appWith(fakeRedis())
    const res = await app.inject({ method: 'POST', url: '/api/admin/dlq/redrive', payload: {} })
    expect(res.statusCode).toBe(400)
  })

  it('미지 reason이면 400', async () => {
    const app = await appWith(fakeRedis())
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/dlq/redrive',
      payload: { sourceStream: 's', reason: 'weird' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('count 범위 초과(>1000)면 400', async () => {
    const app = await appWith(fakeRedis())
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/dlq/redrive',
      payload: { sourceStream: 's', count: 5000 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('authHook 설정 시 preHandler로 적용된다(미인증 차단)', async () => {
    const authHook = vi.fn(async (_req: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
      reply.code(401).send({ error: 'unauthorized' })
    })
    const redis = fakeRedis()
    const app = await appWith(redis, { authHook })
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/dlq/redrive',
      payload: { sourceStream: 's' },
    })
    expect(res.statusCode).toBe(401)
    expect(authHook).toHaveBeenCalled()
    expect(redis.xrange).not.toHaveBeenCalled() // 핸들러 미도달
  })
})
