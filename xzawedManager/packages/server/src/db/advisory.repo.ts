import type { Pool, PoolClient } from 'pg'
import { makeEnvelope } from '@xzawed/agent-streams'
import { AdvisoryFindingSchema, ADVISORY_FOUND_EVENT, ADVISORY_STREAM, ADVISORY_ACTOR } from './advisory.types.js'
import type { AdvisoryFinding } from './advisory.types.js'

/** ROLLBACK 자체 실패(연결 손상)해도 무시 — 원본 흐름 보존(OracleRepo·RiskClassificationRepo 패턴). */
async function safeRollback(client: PoolClient): Promise<void> {
  try { await client.query('ROLLBACK') } catch { /* 손상 연결: 미COMMIT tx는 DB 자동 폐기 */ }
}

interface FindingRow {
  rank: number; title: string; rationale: string; severity: string; source_lens: string
}

/**
 * P4 advisory 채널 영속(append 프로젝션). recordFindings는 advisory_findings + manager_events(wp.advisory.found)
 * + manager_outbox를 **단일 tx**(트랜잭셔널 아웃박스 M5/M7·RiskClassificationRepo.approve 패턴)로 적재한다.
 * 멱등 (wf,wpId,attempt,rank) ON CONFLICT DO NOTHING(M6). 빈 findings면 no-op. N3: 게이트(verifyWp)와 무관.
 */
export class AdvisoryRepo {
  constructor(private readonly pool: Pool, private readonly now: () => number = () => Date.now()) {}

  async recordFindings(workflowId: string, wpId: string, attempt: number, findings: AdvisoryFinding[]): Promise<void> {
    if (findings.length === 0) return
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const env = makeEnvelope(
        { correlationId: workflowId, causationId: null, workflowId, stepId: `${ADVISORY_FOUND_EVENT}:${wpId}`, attemptId: attempt },
        this.now(),
      )
      const payload = { wpId, attempt, findings }
      // manager_events: 진실원천(event_id UNIQUE per call). idempotency_key는 소비자 dedup용(events에 unique 없음
      // — risk/decision 패턴). ON CONFLICT는 투영 테이블에만.
      await client.query(
        `INSERT INTO manager_events
           (event_id, session_id, event_type, payload, correlation_id, causation_id, idempotency_key, actor, occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [env.eventId, workflowId, ADVISORY_FOUND_EVENT, JSON.stringify(payload),
          env.correlationId, env.causationId, env.idempotencyKey, ADVISORY_ACTOR, env.occurredAt],
      )
      await client.query(
        `INSERT INTO manager_outbox (event_id, stream, message) VALUES ($1,$2,$3)`,
        [env.eventId, ADVISORY_STREAM, JSON.stringify({ envelope: env, type: ADVISORY_FOUND_EVENT, payload })],
      )
      for (const finding of findings) {
        await client.query(
          `INSERT INTO advisory_findings
             (workflow_id, wp_id, attempt, rank, title, rationale, severity, source_lens, event_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (workflow_id, wp_id, attempt, rank) DO NOTHING`,
          [workflowId, wpId, attempt, finding.rank, finding.title, finding.rationale, finding.severity, finding.sourceLens, env.eventId],
        )
      }
      await client.query('COMMIT')
    } catch (err) {
      await safeRollback(client); throw err
    } finally {
      client.release()
    }
  }

  /** 워크플로의 advisory 발견(조회용·후속 API/UI). wp_id, attempt, rank 순. */
  async findingsByWorkflow(workflowId: string): Promise<AdvisoryFinding[]> {
    const { rows } = await this.pool.query<FindingRow>(
      `SELECT rank, title, rationale, severity, source_lens
         FROM advisory_findings WHERE workflow_id = $1 ORDER BY wp_id, attempt, rank`,
      [workflowId],
    )
    return rows.map((r) => AdvisoryFindingSchema.parse({
      rank: r.rank, title: r.title, rationale: r.rationale, severity: r.severity, sourceLens: r.source_lens,
    }))
  }
}
