import type { FastifyInstance } from 'fastify'
import { readinessResult, type ReadinessProbe } from './readiness.js'

/**
 * 헬스 라우트 2개를 등록한다.
 *
 * **왜 shared 에 있나.** 이 20줄을 서비스마다 두면 서비스명 문자열만 다른 사본이
 * 8벌 생긴다. jscpd 는 그것을 서로 다르다고 보지만 **SonarCloud CPD 는 문자열
 * 리터럴을 정규화해서 비교하므로 동일한 사본으로 센다** — 실측으로 확인했다.
 * 마커로 덮는 대신 합치는 것이 맞고, 소비처 8곳은 전부 이 라이브러리를 의존한다.
 *
 * **fastify 는 타입으로만 쓴다**(`devDependencies`). `import type` 은 컴파일 시
 * 지워지므로 런타임 의존이 늘지 않고, 이 함수를 부르는 쪽은 전부 이미 Fastify 로
 * 서버를 띄운다. `readiness.ts` 는 여전히 Fastify 를 모른다 — 판정과 전송을
 * 갈라 두면 판정을 HTTP 없이 테스트할 수 있다.
 *
 * Orchestrator 만 이 라이브러리를 의존하지 않아 자기 라우트를 따로 등록한다.
 */
export interface HealthRouteOptions {
  service: string
  probes?: readonly ReadinessProbe[]
  /**
   * liveness 응답 본문. 기본은 `{ status: 'ok', service }`.
   *
   * 이미 다른 형태를 내보내고 있던 서비스가 그 형태를 지키기 위해 넘긴다 —
   * 본문을 통일하려고 기존 계약을 바꾸면 이 슬라이스의 범위를 넘는다.
   */
  liveness?: () => unknown
}

export function registerHealthRoutes(app: FastifyInstance, opts: HealthRouteOptions): void {
  const { service, probes = [], liveness } = opts

  // liveness. 이벤트 루프가 응답 가능한가만 말한다 — 의존 상태를 섞지 않는다.
  app.get('/health', async () => (liveness ? liveness() : { status: 'ok', service }))

  // readiness. 의존이 실제로 살아 있는가. fail 이 하나라도 있으면 503 이다.
  app.get('/health/ready', async (_req, reply) => {
    const { statusCode, body } = await readinessResult(service, probes)
    return reply.code(statusCode).send(body)
  })
}
