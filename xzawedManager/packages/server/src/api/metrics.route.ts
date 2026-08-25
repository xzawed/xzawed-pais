import type { FastifyPluginAsync } from 'fastify'
import {
  collectDlqMetrics, collectPelMetrics, TOP_N,
  type MetricsRedis, type DlqMetrics, type PelMetrics,
} from '../observability/redis-metrics.js'

/**
 * `GET /metrics` — Prometheus text exposition(S3.3 / 수용 기준 L2-8).
 *
 * **접근자로 받는다.** `healthRoute` 와 같은 이유 — 라우트 등록이 Redis 배선보다 앞설 수 있어
 * 값으로 주면 그 시점에 아직 없다.
 *
 * **Redis 가 없거나 죽어도 200 을 준다.** `/metrics` 는 헬스체크가 아니다. 여기서 500 을 내면
 * 스크레이퍼가 지표를 통째로 잃고, 정작 "Redis 가 죽었다"는 사실도 못 본다 — 대신
 * `pais_redis_up 0` 으로 **그 사실 자체를 지표로** 노출한다(readiness 는 `/health/ready` 몫이다).
 *
 * **실패 시 DLQ·PEL 계열은 0 이 아니라 사라진다. 0 으로 채우지 마라.** 못 읽은 것을 0 으로 내면
 * "DLQ 가 비었다"는 **진짜 거짓**이고, 쌓이는 중에 Redis 가 끊기면 경보가 조용히 해제된다.
 * 계열이 없어지는 것도 경보 입장에서는 불편하지만(`pais_dlq_messages_total > 0` 이 resolve 된다),
 * 그건 규칙 쪽에서 `or pais_redis_up == 0` 으로 다루는 문제다 — 숫자를 지어내서 풀 문제가 아니다.
 * Grok 반증이 이 자리를 지적했고, 판단은 "침묵 > 거짓"으로 고정한다.
 */
export interface MetricsDeps {
  redis?: () => MetricsRedis | null | undefined
}

const CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8'

/** Prometheus 라벨 값 이스케이프 — 역슬래시·따옴표·개행(그 순서여야 한다). */
function escapeLabel(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

function renderDlq(m: DlqMetrics): string[] {
  return [
    '# HELP pais_dlq_streams DLQ 스트림 수(깊이 0 포함).',
    '# TYPE pais_dlq_streams gauge',
    `pais_dlq_streams ${m.streams}`,
    '# HELP pais_dlq_messages_total DLQ 전체 적재량. truncated=1 이면 하한이다.',
    '# TYPE pais_dlq_messages_total gauge',
    `pais_dlq_messages_total ${m.total}`,
    `# HELP pais_dlq_messages 스트림별 DLQ 적재량(상위 ${TOP_N}).`,
    '# TYPE pais_dlq_messages gauge',
    ...m.top.map((r) => `pais_dlq_messages{stream="${escapeLabel(r.stream)}"} ${r.depth}`),
    '# HELP pais_dlq_stream_errors 개별 DLQ 스트림 조회 실패 수(0이 아니면 truncated 도 1).',
    '# TYPE pais_dlq_stream_errors gauge',
    `pais_dlq_stream_errors ${m.errors}`,
    '# HELP pais_dlq_scan_truncated 1이면 전부 보지 못했다(상한·왕복 초과·스트림별 실패). 합계는 하한.',
    '# TYPE pais_dlq_scan_truncated gauge',
    `pais_dlq_scan_truncated ${m.truncated ? 1 : 0}`,
  ]
}

function renderPel(m: PelMetrics): string[] {
  return [
    '# HELP pais_consumer_groups 관측된 소비자 그룹 수.',
    '# TYPE pais_consumer_groups gauge',
    `pais_consumer_groups ${m.groups}`,
    '# HELP pais_pending_messages_total 전체 PEL 깊이. truncated=1 이면 하한이다.',
    '# TYPE pais_pending_messages_total gauge',
    `pais_pending_messages_total ${m.total}`,
    `# HELP pais_pending_messages 그룹별 PEL 깊이(상위 ${TOP_N}).`,
    '# TYPE pais_pending_messages gauge',
    ...m.top.map((r) => `pais_pending_messages{stream="${escapeLabel(r.stream)}",group="${escapeLabel(r.group)}"} ${r.pending}`),
    '# HELP pais_pel_stream_errors 그룹 조회·해석 실패 수(0이 아니면 truncated 도 1).',
    '# TYPE pais_pel_stream_errors gauge',
    `pais_pel_stream_errors ${m.errors}`,
    '# HELP pais_pel_scan_truncated 1이면 전부 보지 못했다(상한·왕복 초과·스트림별 실패). 합계는 하한.',
    '# TYPE pais_pel_scan_truncated gauge',
    `pais_pel_scan_truncated ${m.truncated ? 1 : 0}`,
  ]
}

/** Redis 접근 가능 여부 자체를 지표로 — 미구성(접근자 없음)과 장애(수집 throw)를 나눈다. */
function renderUp(up: 0 | 1): string[] {
  return [
    '# HELP pais_redis_up 1이면 이번 수집에서 Redis 를 읽었다. 0이면 미구성이거나 수집 실패다.',
    '# TYPE pais_redis_up gauge',
    `pais_redis_up ${up}`,
  ]
}

export const metricsRoute: FastifyPluginAsync<MetricsDeps> = async (app, deps) => {
  app.get('/metrics', async (_req, reply) => {
    const redis = deps.redis?.()
    if (!redis) {
      return reply.type(CONTENT_TYPE).send([...renderUp(0), ''].join('\n'))
    }
    try {
      // 순차 수집이다. 둘 다 SCAN 을 돌리므로 병렬로 던지면 같은 Redis 에 부하만 겹친다.
      const dlq = await collectDlqMetrics(redis)
      const pel = await collectPelMetrics(redis)
      return reply.type(CONTENT_TYPE).send([...renderUp(1), ...renderDlq(dlq), ...renderPel(pel), ''].join('\n'))
    } catch (err) {
      // 수집 실패를 500 으로 바꾸지 않는다 — 스크레이퍼가 지표를 통째로 잃는다.
      app.log.warn({ err }, '[metrics] Redis 지표 수집 실패')
      return reply.type(CONTENT_TYPE).send([...renderUp(0), ''].join('\n'))
    }
  })
}
