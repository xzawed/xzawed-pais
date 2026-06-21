import type { Pool, PoolClient } from 'pg'
import { makeEnvelope, RiskClassificationSchema } from '@xzawed/agent-streams'
import type { RiskClassification } from '@xzawed/agent-streams'
import { RISK_APPROVED_EVENT, RISK_STREAM, RISK_PENDING, RISK_APPROVED } from './risk-classification.types.js'

/** ROLLBACK 자체 실패(연결 손상)해도 무시 — 원본 흐름 보존(OracleRepo·DispatchStore 패턴). */
async function safeRollback(client: PoolClient): Promise<void> {
  try { await client.query('ROLLBACK') } catch { /* 손상 연결: 미COMMIT tx는 DB 자동 폐기 */ }
}

interface ClassificationRow {
  workflow_id: string; project_id: string; version: number; status: string; risk: string; artifact: unknown
}

/**
 * P2r-2 리스크 분류 프로젝션 repo. 한 워크플로당 한 분류(재채점=upsert version++·status=pending 리셋).
 * approve는 risk_classifications UPDATE + manager_events(risk.approved) + manager_outbox를 **단일 tx**로
 * (트랜잭셔널 아웃박스 M5·OracleRepo.approve 패턴). 승인된 분류만 approvedForWorkflow로 노출(라우팅 확정 N6).
 */
export class RiskClassificationRepo {
  constructor(private readonly pool: Pool, private readonly now: () => number = () => Date.now()) {}

  /** 분류 영속(pending). 재채점 시 version++·status=pending·이전 승인 무효(재승인 필요 N6). */
  async upsert(input: { workflowId: string; classification: RiskClassification }): Promise<{ version: number }> {
    const c = input.classification
    const { rows } = await this.pool.query<{ version: number }>(
      `INSERT INTO risk_classifications (workflow_id, project_id, version, status, risk, artifact)
         VALUES ($1,$2,1,'pending',$3,$4)
       ON CONFLICT (workflow_id) DO UPDATE SET
         version = risk_classifications.version + 1, status = 'pending',
         risk = EXCLUDED.risk, artifact = EXCLUDED.artifact, project_id = EXCLUDED.project_id,
         approved_at = NULL, approved_by = NULL
       RETURNING version`,
      [input.workflowId, c.projectId, c.risk, JSON.stringify(c)],
    )
    const row = rows[0]
    if (!row) throw new Error('upsert: no row returned')
    return { version: row.version }
  }

  /** 사람 승인(N6): SELECT FOR UPDATE → (status≠pending이면 null) → 아티팩트 audit 갱신 + status=approved +
   *  risk.approved 이벤트(아웃박스). 라우팅 확정. */
  async approve(workflowId: string, approvedBy: string): Promise<{ eventId: string } | null> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const sel = await client.query<{ project_id: string; version: number; status: string; artifact: unknown }>(
        `SELECT project_id, version, status, artifact FROM risk_classifications WHERE workflow_id = $1 FOR UPDATE`,
        [workflowId],
      )
      const row = sel.rows[0]
      if (!row || row.status !== RISK_PENDING) { await safeRollback(client); return null }
      const artifact = RiskClassificationSchema.parse(row.artifact)
      const approvedAt = new Date(this.now()).toISOString()
      const updated: RiskClassification = { ...artifact, audit: { ...artifact.audit, approvedBy, approvedAt } }
      await client.query(
        `UPDATE risk_classifications SET status = $2, approved_at = NOW(), approved_by = $3, artifact = $4 WHERE workflow_id = $1`,
        [workflowId, RISK_APPROVED, approvedBy, JSON.stringify(updated)],
      )
      const env = makeEnvelope(
        { correlationId: workflowId, causationId: null, workflowId, stepId: `${RISK_APPROVED_EVENT}:${workflowId}`, attemptId: row.version },
        this.now(),
      )
      const payload = { workflowId, projectId: row.project_id, risk: artifact.risk, version: row.version, modelRouting: artifact.modelRouting }
      await client.query(
        `INSERT INTO manager_events
           (event_id, session_id, event_type, payload, correlation_id, causation_id, idempotency_key, actor, occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [env.eventId, workflowId, RISK_APPROVED_EVENT, JSON.stringify(payload),
          env.correlationId, env.causationId, env.idempotencyKey, approvedBy, env.occurredAt],
      )
      await client.query(
        `INSERT INTO manager_outbox (event_id, stream, message) VALUES ($1,$2,$3)`,
        [env.eventId, RISK_STREAM, JSON.stringify({ envelope: env, type: RISK_APPROVED_EVENT, payload })],
      )
      await client.query('COMMIT')
      return { eventId: env.eventId }
    } catch (err) {
      await safeRollback(client); throw err
    } finally {
      client.release()
    }
  }

  /** 워크플로의 분류 + 상태/버전(미존재→null). 아티팩트는 RiskClassification으로 재검증. */
  async getByWorkflow(workflowId: string): Promise<{ status: string; version: number; classification: RiskClassification } | null> {
    const { rows } = await this.pool.query<ClassificationRow>(`SELECT * FROM risk_classifications WHERE workflow_id = $1`, [workflowId])
    const row = rows[0]
    if (!row) return null
    return { status: row.status, version: row.version, classification: RiskClassificationSchema.parse(row.artifact) }
  }

  /** N6: **승인된** 분류만 반환(라우팅 확정 입력). pending/미존재면 null — P2r-4 라우팅 소비가 사용. */
  async approvedForWorkflow(workflowId: string): Promise<RiskClassification | null> {
    const { rows } = await this.pool.query<{ artifact: unknown }>(
      `SELECT artifact FROM risk_classifications WHERE workflow_id = $1 AND status = $2`,
      [workflowId, RISK_APPROVED],
    )
    const row = rows[0]
    return row ? RiskClassificationSchema.parse(row.artifact) : null
  }
}
