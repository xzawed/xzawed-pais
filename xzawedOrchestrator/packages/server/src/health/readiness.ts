/**
 * 실검사 readiness — **`xzawedShared/src/health/readiness.ts` 의 복제본이다.**
 *
 * Orchestrator 는 `@xzawed/agent-streams` 를 의존하지 않는다(소비처 8곳 중 유일하게).
 * 그래서 계약을 복제하는 것 말고 선택이 없고, 동일성은
 * `scripts/check-replicated-blocks.js` 가 `readiness-core` 로 강제한다 —
 * 한쪽만 고치면 두 판정 의미론이 갈라진다.
 *
 * 이 파일에 고칠 것이 생기면 shared 원본을 먼저 고치고 마커 구간을 그대로 옮긴다.
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
// jscpd:ignore-end
