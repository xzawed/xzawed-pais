import type { FastifyPluginAsync } from 'fastify'
import { readinessResult, redisPingProbe, loopProbe, pgProbe, type ReadinessProbe } from '@xzawed/agent-streams'

/**
 * 프로브 재료를 **접근자**로 받는다.
 *
 * `healthRoute` 등록이 `sessionGateway` 생성보다 **앞**이라 값을 직접 넘기면 그 시점에
 * 아직 없다. 접근자는 요청 시점에 평가되므로 그 순서 문제가 사라진다.
 *
 * 필드가 전부 선택인 이유: 각 프로브는 독립이고, 주지 않은 것은 검사 대상이 아니다.
 * 하나도 주지 않으면 readiness 는 항상 ready 다(기존 호출부 호환).
 */
export interface HealthDeps {
  redis?: () => { ping(): Promise<unknown> }
  /** `undefined` = 배선되지 않음(미구성). `false` = 배선됐는데 루프가 죽음(장애). */
  gatewayRunning?: () => boolean | undefined
  pool?: () => { query(sql: string): Promise<unknown> } | null
}

export const healthRoute: FastifyPluginAsync<HealthDeps> = async (app, deps) => {
  // liveness. 이벤트 루프가 응답 가능한가만 말한다.
  // 본문 형태를 바꾸지 않는다 — `test/api/health.test.ts` 가 `toEqual` 로 단언한다.
  app.get('/health', async () => ({ status: 'ok' }))

  // readiness. 의존이 실제로 살아 있는가. `fail` 이 하나라도 있으면 503.
  app.get('/health/ready', async (_req, reply) => {
    const probes: ReadinessProbe[] = []
    const redis = deps.redis
    if (redis) probes.push(redisPingProbe({ ping: () => redis().ping() }))
    if (deps.gatewayRunning) probes.push(loopProbe('sessionGateway', deps.gatewayRunning))
    if (deps.pool) probes.push(pgProbe(deps.pool))

    const { statusCode, body } = await readinessResult('xzawedManager', probes)
    return reply.code(statusCode).send(body)
  })
}
