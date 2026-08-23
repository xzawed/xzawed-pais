import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'
import { healthRoute, type HealthDeps } from '../../src/api/health.route.js'

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const app = Fastify()
    await app.register(healthRoute)
    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ status: 'ok' })
  })
})

/**
 * readiness 는 의존이 실제로 살아 있는가를 말한다. `/health` 는 그대로 liveness 다.
 *
 * **핵심은 루프 프로브다.** 기동 시점에 Redis 가 죽어 있으면 그룹 생성이 소비 루프
 * **밖**에서 throw 해 게이트웨이가 영구 정지하는데, ioredis 는 계속 재연결하므로
 * 나중에 `ping()` 은 PONG 을 준다 — Redis ping 만으로는 그 상태를 못 잡는다.
 */

const okRedis = { ping: async () => 'PONG' }
const okPool = { query: async () => ({ rows: [] }) }

/** 등록 → 요청 → 종료. 케이스마다 이 6줄을 반복하면 그 반복 자체가 중복이 된다. */
async function hit(deps: HealthDeps, url = '/health/ready') {
  const app = Fastify()
  await app.register(healthRoute, deps)
  try {
    const res = await app.inject({ method: 'GET', url })
    return { code: res.statusCode, body: JSON.parse(res.body) }
  } finally {
    await app.close()
  }
}

describe('GET /health/ready — xzawedManager', () => {
  it('의존이 전부 살아 있으면 200 ready', async () => {
    const { code, body } = await hit({ redis: () => okRedis, gatewayRunning: () => true, pool: () => okPool })
    expect(code).toBe(200)
    expect(body.status).toBe('ready')
    expect(body.service).toBe('xzawedManager')
  })

  it('루프가 멈춰 있으면 503 — Redis 는 PONG 이어도 그렇다', async () => {
    const { code, body } = await hit({ redis: () => okRedis, gatewayRunning: () => false, pool: () => okPool })
    expect(code).toBe(503)
    expect(body.checks.redis.status).toBe('ok')
    expect(body.checks.sessionGateway.status).toBe('fail')
  })

  it('DB 가 미구성이면 그것만으로 실패하지 않는다', async () => {
    // prod compose 는 Manager 에 DATABASE_URL 을 주지 않는다. 미구성을 실패로 세면
    // Launcher 가 실제로 배포하는 구성에서 영구 unhealthy 가 된다.
    const { code, body } = await hit({ redis: () => okRedis, gatewayRunning: () => true, pool: () => null })
    expect(code).toBe(200)
    expect(body.checks.db.status).toBe('not_configured')
  })

  it('DB 질의가 실패하면 503', async () => {
    const dead = { query: async () => { throw new Error('Cannot use a pool after calling end on the pool') } }
    const { code, body } = await hit({ redis: () => okRedis, gatewayRunning: () => true, pool: () => dead })
    expect(code).toBe(503)
    expect(body.checks.db.error).toContain('after calling end')
  })

  it('게이트웨이가 배선되지 않았으면 미구성 — 장애가 아니다', async () => {
    const { code, body } = await hit({ redis: () => okRedis, gatewayRunning: () => undefined, pool: () => null })
    expect(code).toBe(200)
    expect(body.checks.sessionGateway.status).toBe('not_configured')
  })

  it('/health 는 의존과 무관하게 200 을 유지한다', async () => {
    const down: HealthDeps = { redis: () => ({ ping: async () => { throw new Error('down') } }), gatewayRunning: () => false }
    expect((await hit(down, '/health')).code).toBe(200)
    expect((await hit(down)).code).toBe(503)
  })

  it('의존을 하나도 주지 않으면 ready — 기존 호출부 호환', async () => {
    expect((await hit({})).code).toBe(200)
  })
})
