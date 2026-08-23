import type { Redis } from 'ioredis'
import type { SessionDispatcher } from '../streams/session-dispatcher.js'

/**
 * 실검사 readiness.
 *
 * 9개 서비스의 `/health` 는 정적 200 이고 그대로 둔다(liveness — 이벤트 루프가 응답
 * 가능한가). 의존 장애는 `/health/ready` 가 말한다. 둘을 분리해야 "크래시·행"과
 * "의존 장애"가 구분된다.
 *
 * **Redis ping 만으로는 이 과제가 지목한 실패를 못 잡는다.** 기동 시점에 Redis 가 죽어
 * 있으면 `SessionDispatcher.start()` 의 `xgroup CREATE` 가 `while` 루프 **밖**에서 throw 해
 * `start()` 가 reject 되고 호출부의 `.catch(console.error)` 가 로그만 남긴다 — 디스패처는
 * 영구 정지한다. 그동안 ioredis 는 계속 재연결하므로 Redis 가 돌아오면 `ping()` 은 PONG 을
 * 준다. **살아 있지만 귀머거리**인 상태다. 그래서 루프 가동 여부를 별도 프로브로 노출한다.
 *
 * **이 모듈은 Fastify 를 모른다.** `xzawedShared` 에 fastify 의존이 없고(8개 소비 패키지에
 * 새로 심지 않는다), 그래서 라우트를 등록하지 않고 `{ statusCode, body }` 만 돌려준다.
 *
 * **막지 못하는 것.** "Redis 가 살아 있고 루프가 돈다"는 "이 서비스가 메시지를 실제로
 * 처리한다"와 다르다. `xreadgroup` 이 NOGROUP·권한 오류로 계속 실패해도 소비 루프는
 * catch 후 백오프 재시도라 `running` 은 true 로 남는다. 마지막 성공 시각을 노출하는 것이
 * 정직한 해법이고 그 자리는 `/metrics`(S3.3)다 — 이 모듈은 그것을 주장하지 않는다.
 */

// jscpd:ignore-start
// replicated-block: readiness-core
// Orchestrator 는 @xzawed/agent-streams 를 의존하지 않아(8개 소비처 중 유일) 공유 경로가
// 없다. 복제 말고 선택이 없으므로 scripts/check-replicated-blocks.js 가 동일성을 강제한다.
export type CheckStatus = 'ok' | 'fail' | 'not_configured'

export interface CheckResult {
  status: CheckStatus
  ms: number
  error?: string
}

export interface ReadinessReport {
  status: 'ready' | 'not_ready'
  service: string
  checks: Record<string, CheckResult>
}

export interface ReadinessProbe {
  name: string
  run: () => Promise<CheckStatus>
}

/**
 * 프로브 하나의 예산. `docker-compose.prod.yml` 의 healthcheck `timeout: 5s` 가 상한이다.
 * 1초면 최악에도 4초 여유가 남는다.
 *
 * 이 예산이 없으면 안 된다 — ioredis 는 `enableOfflineQueue` 기본 true 라 장기 정지
 * 상태에서 `ping()` 거부에 실측 약 8초가 걸리고, pg 는 `connectionTimeoutMillis` 가 없어
 * 풀이 포화되면 무한 대기한다(실측 6029ms 뒤 완료).
 */
export const DEFAULT_PROBE_TIMEOUT_MS = 1_000

const MAX_ERROR_CHARS = 120

/** 프로브를 예산으로 감싼다. throw·hang 모두 fail 로 환원하고 **절대 던지지 않는다.** */
async function runOne(probe: ReadinessProbe, timeoutMs: number): Promise<CheckResult> {
  const started = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const status = await Promise.race([
      probe.run(),
      new Promise<never>((_, reject) => {
        // `unref()` 를 걸지 않는다 — 매달린 프로브 구간에서 프로세스가 조기 종료해
        // "unsettled top-level await" 로 죽는다. finally 의 clearTimeout 으로 충분하다.
        timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
    return { status, ms: Date.now() - started }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { status: 'fail', ms: Date.now() - started, error: message.slice(0, MAX_ERROR_CHARS) }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** 프로브를 **병렬로** 돌린다. 직렬이면 예산을 프로브 수만큼 곱해 쓴다. */
export async function runProbes(
  probes: readonly ReadinessProbe[],
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS,
): Promise<Record<string, CheckResult>> {
  const results = await Promise.all(probes.map((p) => runOne(p, timeoutMs)))
  const checks: Record<string, CheckResult> = {}
  probes.forEach((p, i) => { checks[p.name] = results[i]! })
  return checks
}

/**
 * `fail` 이 하나라도 있으면 `not_ready`.
 *
 * **`not_configured` 는 실패로 세지 않는다.** `docker-compose.prod.yml` 은 Manager 에
 * `DATABASE_URL` 을 주지 않는데(Launcher 가 배포하는 파일이 그것이다), 미구성을 실패로
 * 세면 그 구성에서 Manager 가 영구 unhealthy 가 된다.
 */
export function summarize(service: string, checks: Record<string, CheckResult>): ReadinessReport {
  const failed = Object.values(checks).some((c) => c.status === 'fail')
  return { status: failed ? 'not_ready' : 'ready', service, checks }
}

/** 라우트가 부르는 유일한 진입점. */
export async function readinessResult(
  service: string,
  probes: readonly ReadinessProbe[],
  timeoutMs?: number,
): Promise<{ statusCode: 200 | 503; body: ReadinessReport }> {
  const body = summarize(service, await runProbes(probes, timeoutMs))
  return { statusCode: body.status === 'ready' ? 200 : 503, body }
}

/** Redis 도달성. **반드시 예산으로 감싸야 한다** — 위 DEFAULT_PROBE_TIMEOUT_MS 주석 참조. */
export function redisPingProbe(
  redis: { ping(): Promise<unknown> },
  name = 'redis',
): ReadinessProbe {
  return { name, run: async () => { await redis.ping(); return 'ok' } }
}

/**
 * 소비 루프가 실제로 도는가. **이 프로브가 이 모듈의 존재 이유다** — Redis ping 이
 * PONG 이어도 루프가 죽어 있을 수 있다.
 *
 * `undefined` 는 "배선되지 않았다"이지 장애가 아니다(Orchestrator 의 projectGateway 는
 * DB 풀이 없으면 생성조차 되지 않는다).
 */
export function loopProbe(name: string, isRunning: () => boolean | undefined): ReadinessProbe {
  return {
    name,
    run: async () => {
      const running = isRunning()
      if (running === undefined) return 'not_configured'
      return running ? 'ok' : 'fail'
    },
  }
}

/** pg 3상태. 풀이 없으면 미구성이고, 있으면 실제로 질의한다. */
export function pgProbe(
  getPool: () => { query(sql: string): Promise<unknown> } | null | undefined,
  name = 'db',
): ReadinessProbe {
  return {
    name,
    run: async () => {
      const pool = getPool()
      if (!pool) return 'not_configured'
      await pool.query('SELECT 1')
      return 'ok'
    },
  }
}

/**
 * 라우트가 넘긴 재료로 프로브 배열을 만든다. **주지 않은 것은 검사 대상이 아니다.**
 *
 * 배열은 등록 시점에 만들어도 된다 — 각 프로브가 붙잡는 것은 값이 아니라 접근자라
 * 실제 평가는 요청 시점에 일어난다. 게이트웨이가 라우트 등록보다 늦게 생겨도 되는
 * 이유가 이것이다.
 */
export interface ProbeDeps {
  // `| undefined` 를 명시하는 이유: 소비처마다 `exactOptionalPropertyTypes` 설정이 달라
  // (Manager 는 켜져 있다) 선택 필드에 `undefined` 를 실어 넘기는 호출이 거부된다.
  redis?: (() => { ping(): Promise<unknown> }) | undefined
  /** 소비 루프. `isRunning()` 이 `undefined` 면 배선되지 않은 것이고 장애가 아니다. */
  loop?: { name: string; isRunning: () => boolean | undefined } | undefined
  pool?: (() => { query(sql: string): Promise<unknown> } | null) | undefined
}

export function buildProbes(deps: ProbeDeps): ReadinessProbe[] {
  const probes: ReadinessProbe[] = []
  const redis = deps.redis
  if (redis) probes.push(redisPingProbe({ ping: () => redis().ping() }))
  if (deps.loop) probes.push(loopProbe(deps.loop.name, deps.loop.isRunning))
  if (deps.pool) probes.push(pgProbe(deps.pool))
  return probes
}
// jscpd:ignore-end

/**
 * 에이전트 7종용 조립. `SessionDispatcher` 타입을 알아야 해서 복제 블록 **밖**에 둔다
 * (Orchestrator 사본은 그 타입을 모른다).
 */
export function agentReadinessProbes(redis: Redis, dispatcher: SessionDispatcher): ReadinessProbe[] {
  return [
    redisPingProbe(redis),
    loopProbe('dispatcher', () => dispatcher.isRunning()),
  ]
}
