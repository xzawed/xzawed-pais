import type { FastifyPluginAsync } from 'fastify'
import { readinessResult, redisPingProbe, loopProbe, pgProbe, type ReadinessProbe } from '../health/readiness.js'

/**
 * 프로브 재료를 **접근자**로 받는다.
 *
 * `healthRoutes` 등록이 `projectGateway` 생성보다 **앞**이고, 게다가 그 생성은
 * `if (dbPool)` 안이라 아예 없을 수도 있다. 접근자는 요청 시점에 평가되므로 두 문제가
 * 함께 사라진다 — 없으면 `undefined` 이고 그것은 미구성이지 장애가 아니다.
 *
 * 필드가 전부 선택인 이유: 각 프로브는 독립이고, 주지 않은 것은 검사 대상이 아니다.
 */
export interface HealthDeps {
  redis?: () => { ping(): Promise<unknown> }
  /** `undefined` = DB 풀이 없어 게이트웨이가 생성되지 않음(미구성). `false` = 루프 정지(장애). */
  gatewayRunning?: () => boolean | undefined
  pool?: () => { query(sql: string): Promise<unknown> } | null
}

export const healthRoutes: FastifyPluginAsync<HealthDeps> = async (app, deps) => {
  // liveness. 본문 형태를 바꾸지 않는다 — E2E 와 기존 테스트가 이 모양을 본다.
  app.get('/health', async () => ({ status: 'ok', timestamp: Date.now() }))

  // readiness. 의존이 실제로 살아 있는가. `fail` 이 하나라도 있으면 503.
  app.get('/health/ready', async (_req, reply) => {
    const probes: ReadinessProbe[] = []
    const redis = deps.redis
    if (redis) probes.push(redisPingProbe({ ping: () => redis().ping() }))
    if (deps.gatewayRunning) probes.push(loopProbe('projectGateway', deps.gatewayRunning))
    if (deps.pool) probes.push(pgProbe(deps.pool))

    const { statusCode, body } = await readinessResult('xzawedOrchestrator', probes)
    return reply.code(statusCode).send(body)
  })
}
