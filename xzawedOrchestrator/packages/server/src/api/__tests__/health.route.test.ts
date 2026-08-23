import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'
import { healthRoutes } from '../health.route.js'

/**
 * readiness 는 의존이 실제로 살아 있는가를 말한다. `/health` 는 그대로 liveness 다.
 *
 * **핵심은 루프 프로브다.** 기동 시점에 Redis 가 죽어 있으면 그룹 생성이 소비 루프
 * **밖**에서 throw 해 게이트웨이가 영구 정지하는데, ioredis 는 계속 재연결하므로
 * 나중에 `ping()` 은 PONG 을 준다 — Redis ping 만으로는 그 상태를 못 잡는다.
 */

const okRedis = { ping: async () => 'PONG' }
const okPool = { query: async () => ({ rows: [] }) }

describe('GET /health/ready — xzawedOrchestrator', () => {
  it('의존이 전부 살아 있으면 200 ready', async () => {
    const app = Fastify()
    await app.register(healthRoutes, {
      redis: () => okRedis,
      gatewayRunning: () => true,
      pool: () => okPool,
    })
    try {
      const res = await app.inject({ method: 'GET', url: '/health/ready' })
      expect(res.statusCode).toBe(200)
      const b = JSON.parse(res.body)
      expect(b.status).toBe('ready')
      expect(b.service).toBe('xzawedOrchestrator')
    } finally { await app.close() }
  })

  it('루프가 멈춰 있으면 503 — Redis 는 PONG 이어도 그렇다', async () => {
    const app = Fastify()
    await app.register(healthRoutes, {
      redis: () => okRedis,
      gatewayRunning: () => false,
      pool: () => okPool,
    })
    try {
      const res = await app.inject({ method: 'GET', url: '/health/ready' })
      expect(res.statusCode).toBe(503)
      const b = JSON.parse(res.body)
      expect(b.checks.redis.status).toBe('ok')
      expect(b.checks.projectGateway.status).toBe('fail')
    } finally { await app.close() }
  })

  it('DB 가 미구성이면 그것만으로 실패하지 않는다', async () => {
    // prod compose 는 Manager 에 DATABASE_URL 을 주지 않는다. 미구성을 실패로 세면
    // Launcher 가 실제로 배포하는 구성에서 영구 unhealthy 가 된다.
    const app = Fastify()
    await app.register(healthRoutes, {
      redis: () => okRedis,
      gatewayRunning: () => true,
      pool: () => null,
    })
    try {
      const res = await app.inject({ method: 'GET', url: '/health/ready' })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body).checks.db.status).toBe('not_configured')
    } finally { await app.close() }
  })

  it('DB 질의가 실패하면 503', async () => {
    const app = Fastify()
    await app.register(healthRoutes, {
      redis: () => okRedis,
      gatewayRunning: () => true,
      pool: () => ({ query: async () => { throw new Error('Cannot use a pool after calling end on the pool') } }),
    })
    try {
      const res = await app.inject({ method: 'GET', url: '/health/ready' })
      expect(res.statusCode).toBe(503)
      expect(JSON.parse(res.body).checks.db.error).toContain('after calling end')
    } finally { await app.close() }
  })

  it('게이트웨이가 배선되지 않았으면 미구성 — 장애가 아니다', async () => {
    const app = Fastify()
    await app.register(healthRoutes, {
      redis: () => okRedis,
      gatewayRunning: () => undefined,
      pool: () => null,
    })
    try {
      const res = await app.inject({ method: 'GET', url: '/health/ready' })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body).checks.projectGateway.status).toBe('not_configured')
    } finally { await app.close() }
  })

  it('/health 는 의존과 무관하게 200 을 유지한다', async () => {
    const app = Fastify()
    await app.register(healthRoutes, {
      redis: () => ({ ping: async () => { throw new Error('down') } }),
      gatewayRunning: () => false,
    })
    try {
      const live = await app.inject({ method: 'GET', url: '/health' })
      const ready = await app.inject({ method: 'GET', url: '/health/ready' })
      expect(live.statusCode).toBe(200)
      expect(ready.statusCode).toBe(503)
    } finally { await app.close() }
  })

  it('의존을 하나도 주지 않으면 ready — 기존 호출부 호환', async () => {
    const app = Fastify()
    await app.register(healthRoutes)
    try {
      const res = await app.inject({ method: 'GET', url: '/health/ready' })
      expect(res.statusCode).toBe(200)
    } finally { await app.close() }
  })
})
