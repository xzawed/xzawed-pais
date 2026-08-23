import { readinessResult, type ReadinessProbe } from './readiness.js'

/**
 * 헬스 라우트 2개를 등록한다.
 *
 * **왜 shared 에 있나.** 이 20줄을 서비스마다 두면 서비스명 문자열만 다른 사본이
 * 8벌 생긴다. jscpd 는 그것을 서로 다르다고 보지만 **SonarCloud CPD 는 문자열
 * 리터럴을 정규화해서 비교하므로 동일한 사본으로 센다** — 실측으로 확인했다.
 * 마커로 덮는 대신 합치는 것이 맞고, 소비처 8곳은 전부 이 라이브러리를 의존한다.
 *
 * **fastify 를 의존하지 않는다 — 타입으로도 쓰지 않는다.** `import type` 이면
 * 런타임에는 지워지지만 `devDependencies` 에는 남고, 그것은 각 서비스의 Dockerfile
 * `shared-build` 스테이지에서 실제로 설치된다. 그 스테이지는 **QEMU 로 emulate 된
 * linux/arm64** 에서도 돌기 때문에 설치 물량이 늘자 `pnpm install` 이
 * `signal 4 (Illegal instruction)` 으로 죽었다(exit 132). 그래서 아래처럼 쓰는
 * 만큼만 구조적으로 받는다.
 *
 * Orchestrator 만 이 라이브러리를 의존하지 않아 자기 라우트를 따로 등록한다.
 */
export interface HealthReply {
  code(statusCode: number): { send(payload: unknown): unknown }
}

/**
 * 앱이 아니라 **등록 함수**를 받는다. `FastifyInstance` 를 구조적으로 받으려 하면
 * `get` 이 오버로드(2인자·3인자)라 arity 가 맞지 않아 대입이 거부된다 — 호출부가
 * 한 줄 감싸면 그 문제가 사라진다.
 */
export type HealthRouteRegistrar = (
  path: string,
  handler: (request: unknown, reply: HealthReply) => Promise<unknown>,
) => unknown

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

export function registerHealthRoutes(get: HealthRouteRegistrar, opts: HealthRouteOptions): void {
  const { service, probes = [], liveness } = opts

  // liveness. 이벤트 루프가 응답 가능한가만 말한다 — 의존 상태를 섞지 않는다.
  get('/health', async () => (liveness ? liveness() : { status: 'ok', service }))

  // readiness. 의존이 실제로 살아 있는가. fail 이 하나라도 있으면 503 이다.
  get('/health/ready', async (_request, reply) => {
    const { statusCode, body } = await readinessResult(service, probes)
    return reply.code(statusCode).send(body)
  })
}
