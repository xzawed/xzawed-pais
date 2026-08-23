import { describe, it, expect, afterEach } from 'vitest'
import { createServer } from './server.js'

describe('createServer', () => {
  const app = createServer()

  afterEach(async () => {
    await app.close()
  })

  it('GET /health가 200과 status:ok를 반환한다', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.status).toBe('ok')
    expect(body.service).toBe('xzawedPlanner')
  })
})

describe('createServer — /health/ready', () => {
  it('프로브가 전부 ok 면 200 ready', async () => {
    const app = createServer([
      { name: 'redis', run: async () => 'ok' },
      { name: 'dispatcher', run: async () => 'ok' },
    ])
    try {
      const res = await app.inject({ method: 'GET', url: '/health/ready' })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.status).toBe('ready')
      expect(body.service).toBe('xzawedPlanner')
    } finally {
      await app.close()
    }
  })

  it('디스패처가 멈춰 있으면 503 — Redis 는 PONG 이어도 그렇다', async () => {
    // 이 케이스가 이 슬라이스의 존재 이유다. 기동 시점에 Redis 가 죽어 있으면
    // `xgroup CREATE` 가 루프 밖에서 throw 해 디스패처가 영구 정지하는데,
    // ioredis 는 계속 재연결하므로 나중에 ping 은 PONG 을 준다.
    const app = createServer([
      { name: 'redis', run: async () => 'ok' },
      { name: 'dispatcher', run: async () => 'fail' },
    ])
    try {
      const res = await app.inject({ method: 'GET', url: '/health/ready' })
      expect(res.statusCode).toBe(503)
      const body = JSON.parse(res.body)
      expect(body.status).toBe('not_ready')
      expect(body.checks.redis.status).toBe('ok')
      expect(body.checks.dispatcher.status).toBe('fail')
    } finally {
      await app.close()
    }
  })

  it('/health 는 의존과 무관하게 200 을 유지한다 — liveness 와 분리', async () => {
    // 둘을 섞으면 "크래시·행"과 "의존 장애"를 구분할 수 없다.
    const app = createServer([{ name: 'redis', run: async () => 'fail' }])
    try {
      const live = await app.inject({ method: 'GET', url: '/health' })
      const ready = await app.inject({ method: 'GET', url: '/health/ready' })
      expect(live.statusCode).toBe(200)
      expect(ready.statusCode).toBe(503)
    } finally {
      await app.close()
    }
  })
})
