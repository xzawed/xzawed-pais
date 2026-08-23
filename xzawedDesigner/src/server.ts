import Fastify from 'fastify'
import { readinessResult, type ReadinessProbe } from '@xzawed/agent-streams'

const SERVICE = 'xzawedDesigner'

/**
 * `probes` 가 비면 readiness 는 항상 ready 다. 기본값을 둔 이유는 기존 호출부
 * (테스트 포함)가 인자 없이 부르기 때문이다 — 배선은 index.ts 가 한다.
 */
// jscpd:ignore-start
// replicated-block: agent-health-server
// 에이전트 7종의 헬스 라우트는 `SERVICE` 상수만 다르고 나머지가 같다. 서비스끼리
// import 할 수 없으므로(M3) 복제가 유일한 선택이고, 동일성은
// `scripts/check-replicated-blocks.js` 가 강제한다 — 한 곳만 고치면 어떤 에이전트는
// readiness 를 다르게 답한다.
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
// jscpd:ignore-end
