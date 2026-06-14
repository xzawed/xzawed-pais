import type { Pool, PoolClient } from 'pg'
import { makeEnvelope } from '@xzawed/agent-streams'
import {
  WP_VERIFIED_EVENT, GATE_PASSED_EVENT, GATE_BLOCKED_EVENT, RELEASE_GATE_STREAM, RELEASE_GATE_ACTOR,
  type ChannelOutcome, type ReleaseGateResult,
} from './release-gate.types.js'

/** ROLLBACK 자체 실패(연결 손상)해도 무시 — 원본 흐름 보존(OracleRepo·AdvisoryRepo 패턴). */
async function safeRollback(client: PoolClient): Promise<void> {
  try { await client.query('ROLLBACK') } catch { /* 손상 연결: 미COMMIT tx는 DB 자동 폐기 */ }
}

/**
 * P5-1 릴리스 게이트 증거 영속(append 프로젝션). recordEvidence는 wp_verification_results +
 * manager_events(wp.verified) + manager_outbox를 **단일 tx**(트랜잭셔널 아웃박스 M5/M7·AdvisoryRepo.recordFindings 패턴)로 적재한다.
 * 멱등 (wf,wpId,attempt,channel) ON CONFLICT DO NOTHING(M6). 빈 outcomes면 no-op.
 */
export class ReleaseGateRepo {
  constructor(private readonly pool: Pool, private readonly now: () => number = () => Date.now()) {}

  /** develop_code/run_tests/build_project WP의 채널 outcome을 단일 tx로 영속(M5/M7). 멱등(M6). */
  async recordEvidence(workflowId: string, wpId: string, attempt: number, outcomes: ChannelOutcome[]): Promise<void> {
    if (outcomes.length === 0) return
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const env = makeEnvelope(
        { correlationId: workflowId, causationId: null, workflowId, stepId: `${WP_VERIFIED_EVENT}:${wpId}`, attemptId: attempt },
        this.now(),
      )
      const payload = { wpId, attempt, outcomes }
      // manager_events: 진실원천(event_id UNIQUE per call). idempotency_key는 소비자 dedup용(events에 unique 없음
      // — risk/decision/advisory 패턴). ON CONFLICT는 투영 테이블에만.
      await client.query(
        `INSERT INTO manager_events
           (event_id, session_id, event_type, payload, correlation_id, causation_id, idempotency_key, actor, occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [env.eventId, workflowId, WP_VERIFIED_EVENT, JSON.stringify(payload),
          env.correlationId, env.causationId, env.idempotencyKey, RELEASE_GATE_ACTOR, env.occurredAt],
      )
      await client.query(
        `INSERT INTO manager_outbox (event_id, stream, message) VALUES ($1,$2,$3)`,
        [env.eventId, RELEASE_GATE_STREAM, JSON.stringify({ envelope: env, type: WP_VERIFIED_EVENT, payload })],
      )
      for (const o of outcomes) {
        await client.query(
          `INSERT INTO wp_verification_results (workflow_id, wp_id, attempt, channel, outcome, event_id)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (workflow_id, wp_id, attempt, channel) DO NOTHING`,
          [workflowId, wpId, attempt, o.channel, o.outcome, env.eventId],
        )
      }
      await client.query('COMMIT')
    } catch (err) {
      await safeRollback(client); throw err
    } finally {
      client.release()
    }
  }

  /** 게이트 결과를 단일 tx로 영속 + gate.passed/blocked 발행. 동일 (wf,version) 재평가는 ON CONFLICT → null(이중 emit 차단·M6). */
  async recordGate(workflowId: string, gateVersion: string, result: ReleaseGateResult): Promise<{ eventId: string } | null> {
    const eventType = result.status === 'passed' ? GATE_PASSED_EVENT : GATE_BLOCKED_EVENT
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const ins = await client.query(
        `INSERT INTO release_gates (workflow_id, gate_version, status, per_wp, blocking_reasons, event_id)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (workflow_id, gate_version) DO NOTHING
         RETURNING id`,
        [workflowId, gateVersion, result.status, JSON.stringify(result.perWp), JSON.stringify(result.blockingReasons), null],
      )
      if (ins.rowCount === 0) { await safeRollback(client); return null }
      const env = makeEnvelope(
        { correlationId: workflowId, causationId: null, workflowId, stepId: `${eventType}:${gateVersion}`, attemptId: 0 },
        this.now(),
      )
      const payload = { workflowId, gateVersion, status: result.status, perWp: result.perWp, blockingReasons: result.blockingReasons }
      await client.query(
        `INSERT INTO manager_events
           (event_id, session_id, event_type, payload, correlation_id, causation_id, idempotency_key, actor, occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [env.eventId, workflowId, eventType, JSON.stringify(payload),
          env.correlationId, env.causationId, env.idempotencyKey, RELEASE_GATE_ACTOR, env.occurredAt],
      )
      await client.query(
        `INSERT INTO manager_outbox (event_id, stream, message) VALUES ($1,$2,$3)`,
        [env.eventId, RELEASE_GATE_STREAM, JSON.stringify({ envelope: env, type: eventType, payload })],
      )
      await client.query(`UPDATE release_gates SET event_id = $1 WHERE workflow_id = $2 AND gate_version = $3`, [env.eventId, workflowId, gateVersion])
      await client.query('COMMIT')
      return { eventId: env.eventId }
    } catch (err) {
      await safeRollback(client); throw err
    } finally {
      client.release()
    }
  }

  /** 워크플로의 증거를 wpId→ChannelOutcome[]로. 게이트 평가 입력. */
  async evidenceForWorkflow(workflowId: string): Promise<Map<string, ChannelOutcome[]>> {
    const { rows } = await this.pool.query<{ wp_id: string; channel: string; outcome: string }>(
      `SELECT DISTINCT ON (wp_id, channel) wp_id, channel, outcome
   FROM wp_verification_results WHERE workflow_id = $1
  ORDER BY wp_id, channel, attempt DESC`,
      [workflowId],
    )
    const out = new Map<string, ChannelOutcome[]>()
    for (const r of rows) {
      const list = out.get(r.wp_id) ?? []
      list.push({ channel: r.channel as ChannelOutcome['channel'], outcome: r.outcome as ChannelOutcome['outcome'] })
      out.set(r.wp_id, list)
    }
    return out
  }
}
