import Fastify from 'fastify'
import { readinessResult, type ReadinessProbe } from '@xzawed/agent-streams'

const SERVICE = 'xzawedDesigner'

/**
 * `probes` 가 비면 readiness 는 항상 ready 다. 기본값을 둔 이유는 기존 호출부
 * (테스트 포함)가 인자 없이 부르기 때문이다 — 배선은 index.ts 가 한다.
 */
export function createServer(probes: readonly ReadinessProbe[] = []) {
  const app = Fastify({ logger: false })

  // liveness. 이벤트 루프가 응답 가능한가만 말한다 — 의존 상태를 섞지 않는다.
  app.get('/health', async () => ({
    status: 'ok',
    service: SERVICE,
  }))

  // readiness. 의존이 실제로 살아 있는가. fail 이 하나라도 있으면 503 이다.
  app.get('/health/ready', async (_req, reply) => {
    const { statusCode, body } = await readinessResult(SERVICE, probes)
    return reply.code(statusCode).send(body)
  })

  return app
}
