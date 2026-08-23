import Fastify from 'fastify'
import { registerHealthRoutes, type ReadinessProbe } from '@xzawed/agent-streams'

/**
 * `probes` 가 비면 readiness 는 항상 ready 다. 기본값을 둔 이유는 기존 호출부
 * (테스트 포함)가 인자 없이 부르기 때문이다 — 실제 배선은 index.ts 가 한다.
 *
 * 라우트 본문이 shared 에 있는 이유는 `health/routes.ts` 주석에 있다(요약: 서비스명만
 * 다른 사본 7벌을 SonarCloud CPD 는 동일한 것으로 센다).
 */
export function createServer(probes: readonly ReadinessProbe[] = []) {
  const app = Fastify({ logger: false })
  registerHealthRoutes((path, handler) => app.get(path, handler), { service: 'xzawedDeveloper', probes })
  return app
}
