import { vi, describe, it, expect, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'

/**
 * 라우트 자체의 판정은 `api/__tests__/health.route.test.ts` 가 스텁으로 본다.
 * 여기서 보는 것은 **배선**이다 — `buildServer` 가 실제로 넘기는 접근자 세 개가
 * 실서버에서 평가되는가.
 *
 * 스텁 테스트만 있으면 접근자를 잘못 배선해도(예: 게이트웨이 대신 항상 true 를
 * 돌려주는 함수) 전부 초록이다. 그 구멍을 막는 것이 이 파일의 전부다.
 */

vi.mock('../db/pool.js', () => ({
  getPool: vi.fn(() => null),
  closePool: vi.fn(async () => undefined),
}))

import { buildServer } from '../server.js'

/**
 * **아무도 들을 수 없는 주소여야 한다.** 이 테스트는 `checks.redis.status === 'fail'` 을 단언하므로
 * "이 포트가 죽어 있다"에 의존한다 — 개발자가 그 포트에 무언가를 띄우면 CI 는 초록인데 로컬만
 * 빨개진다. 실제로 물렸다: 임시 Redis probe 를 6399 에 띄워 두고 이 실패를 **master 회귀로**
 * 오독할 뻔했다(같은 커밋이 CI 에서는 초록이었다).
 *
 * 포트 1 은 특권 포트라 비루트 프로세스가 바인드할 수 없고 Redis 기본값도 아니다 — 임의의
 * "안 쓸 것 같은" 높은 포트보다 훨씬 강한 보장이다.
 */
const DEAD_REDIS = 'redis://127.0.0.1:1'

const CONFIG = {
  port: 0,
  redisUrl: DEAD_REDIS,
  managerUrl: 'http://localhost:3001',
  claudeMode: 'cli' as const,
  mode: 'local' as const,
  auth: 'none' as const,
  allowedOrigins: [],
  trustProxy: false,
  claudeModel: 'test',
  serveWeb: false,
}

let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

describe('buildServer — 헬스 배선', () => {
  it('DB 가 없으면 게이트웨이도 없다 — 미구성이지 장애가 아니다', async () => {
    app = await buildServer(CONFIG, { async *send() { yield { type: 'done' as const, content: '' } } })
    const res = await app.inject({ method: 'GET', url: '/health/ready' })
    const body = JSON.parse(res.body)

    // `projectGateway` 는 `if (dbPool)` 안에서만 생성되므로 여기서는 존재하지 않는다.
    expect(body.checks.projectGateway.status).toBe('not_configured')
    expect(body.checks.db.status).toBe('not_configured')
    // Redis 는 실제로 친다 — 이 환경에는 없으므로 fail 이고, 따라서 503 이다.
    expect(body.checks.redis.status).toBe('fail')
    expect(res.statusCode).toBe(503)
  })

  it('/health 는 의존과 무관하게 200 이다', async () => {
    app = await buildServer(CONFIG, { async *send() { yield { type: 'done' as const, content: '' } } })
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).status).toBe('ok')
  })
})
