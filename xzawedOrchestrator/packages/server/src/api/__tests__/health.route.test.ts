import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'
import { healthRoutes, type HealthDeps } from '../health.route.js'

/**
 * readiness 는 의존이 실제로 살아 있는가를 말한다. `/health` 는 그대로 liveness 다.
 *
 * Orchestrator 는 `projectGateway` 가 `if (dbPool)` 안에서 생성되므로 **아예 없을 수도
 * 있다.** 그래서 세 상태(`ok`·`fail`·`not_configured`)가 전부 실재하는 조합이고,
 * 아래 표는 그 조합이 어떤 HTTP 코드로 접히는지를 고정한다.
 */

const alive = { ping: async () => 'PONG' }
const dead = { ping: async () => { throw new Error('ECONNREFUSED') } }
const pool = { query: async () => ({ rows: [] }) }

interface ReadinessBody {
  status: string
  service: string
  checks: Record<string, { status: string; ms: number; error?: string }>
}

async function call(deps: HealthDeps, url: string) {
  const app = Fastify()
  await app.register(healthRoutes, deps)
  try {
    const res = await app.inject({ method: 'GET', url })
    return { code: res.statusCode, body: JSON.parse(res.body) as ReadinessBody }
  } finally {
    await app.close()
  }
}

describe('GET /health/ready — xzawedOrchestrator', () => {
  const cases: Array<[string, HealthDeps, number, Record<string, string>]> = [
    [
      '의존이 전부 살아 있으면 ready',
      { redis: () => alive, gatewayRunning: () => true, pool: () => pool },
      200,
      { redis: 'ok', projectGateway: 'ok', db: 'ok' },
    ],
    [
      '루프가 멈춰 있으면 not_ready — Redis 는 PONG 이어도 그렇다',
      { redis: () => alive, gatewayRunning: () => false, pool: () => pool },
      503,
      { redis: 'ok', projectGateway: 'fail', db: 'ok' },
    ],
    [
      'DB 풀이 없으면 게이트웨이도 없다 — 둘 다 미구성이지 장애가 아니다',
      { redis: () => alive, gatewayRunning: () => undefined, pool: () => null },
      200,
      { redis: 'ok', projectGateway: 'not_configured', db: 'not_configured' },
    ],
    [
      'Redis 가 죽으면 not_ready',
      { redis: () => dead, gatewayRunning: () => true, pool: () => pool },
      503,
      { redis: 'fail', projectGateway: 'ok', db: 'ok' },
    ],
  ]

  it.each(cases)('%s', async (_label, deps, expected, checks) => {
    const { code, body } = await call(deps, '/health/ready')
    expect(code).toBe(expected)
    for (const [name, status] of Object.entries(checks)) {
      expect(body.checks[name].status, name).toBe(status)
    }
  })

  it('실패한 프로브는 오류 사유를 싣는다', async () => {
    const { body } = await call({ redis: () => dead }, '/health/ready')
    expect(body.checks.redis.error).toContain('ECONNREFUSED')
  })

  it('/health 는 의존이 다 죽어도 200 이다 — liveness 와 readiness 를 섞지 않는다', async () => {
    const broken: HealthDeps = { redis: () => dead, gatewayRunning: () => false }
    expect((await call(broken, '/health')).code).toBe(200)
    expect((await call(broken, '/health/ready')).code).toBe(503)
  })

  it('의존을 하나도 주지 않으면 ready — 기존 호출부 호환', async () => {
    const { code, body } = await call({}, '/health/ready')
    expect(code).toBe(200)
    expect(body.checks).toEqual({})
  })
})
