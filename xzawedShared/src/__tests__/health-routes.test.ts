import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'
import { registerHealthRoutes } from '../health/routes.js'
import type { ReadinessProbe } from '../health/readiness.js'

/**
 * 라우트 등록기는 8개 소비처가 공유하는 유일한 사본이다. 여기서 형태가 깨지면
 * 에이전트 7종과 Manager 의 헬스체크가 **동시에** 깨진다.
 */
async function get(url: string, probes: readonly ReadinessProbe[] = [], liveness?: () => unknown) {
  const app = Fastify({ logger: false })
  registerHealthRoutes(app, liveness ? { service: 'svc', probes, liveness } : { service: 'svc', probes })
  try {
    const res = await app.inject({ method: 'GET', url })
    return { code: res.statusCode, body: JSON.parse(res.body) }
  } finally {
    await app.close()
  }
}

const ok: ReadinessProbe = { name: 'redis', run: async () => 'ok' }
const bad: ReadinessProbe = { name: 'loop', run: async () => 'fail' }

describe('registerHealthRoutes', () => {
  it('liveness 기본 본문은 status·service 다', async () => {
    const { code, body } = await get('/health')
    expect(code).toBe(200)
    expect(body).toEqual({ status: 'ok', service: 'svc' })
  })

  it('liveness 본문을 넘기면 그것을 쓴다 — 기존 계약을 지키기 위한 탈출구', async () => {
    // Manager 의 `/health` 는 `{status:'ok'}` 만 낸다. 공유 등록기로 옮기면서 본문을
    // 통일하면 그 서비스의 기존 단언이 깨진다.
    const { body } = await get('/health', [], () => ({ status: 'ok' }))
    expect(body).toEqual({ status: 'ok' })
  })

  it('프로브가 전부 ok 면 200 ready', async () => {
    const { code, body } = await get('/health/ready', [ok])
    expect(code).toBe(200)
    expect(body.status).toBe('ready')
    expect(body.service).toBe('svc')
    expect(body.checks.redis.status).toBe('ok')
  })

  it('fail 이 하나라도 있으면 503 이고 본문은 그대로 실린다', async () => {
    const { code, body } = await get('/health/ready', [ok, bad])
    expect(code).toBe(503)
    expect(body.status).toBe('not_ready')
    expect(body.checks.loop.status).toBe('fail')
  })

  it('프로브를 주지 않으면 ready — 검사할 것이 없는 것은 장애가 아니다', async () => {
    const { code, body } = await get('/health/ready')
    expect(code).toBe(200)
    expect(body.checks).toEqual({})
  })

  it('의존이 죽어도 /health 는 200 을 유지한다 — liveness 와 readiness 를 섞지 않는다', async () => {
    const app = Fastify({ logger: false })
    registerHealthRoutes(app, { service: 'svc', probes: [bad] })
    try {
      expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200)
      expect((await app.inject({ method: 'GET', url: '/health/ready' })).statusCode).toBe(503)
    } finally {
      await app.close()
    }
  })
})
