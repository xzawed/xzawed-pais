import type { Pool, PoolClient } from 'pg'
import { makeEnvelope } from '@xzawed/agent-streams'
import {
  DecisionRequestSchema, HumanDecisionSchema, SignOffSchema,
  DECISION_PENDING, DECISION_RESOLVED, DECISION_EXPIRED, DECISION_SUPERSEDED,
  DECISION_REQUESTED_EVENT, DECISION_RECORDED_EVENT, SIGNOFF_RECORDED_EVENT,
  DECISION_EXPIRED_EVENT, DECISION_SUPERSEDED_EVENT, DECISION_ACTOR, DECISION_STREAM,
} from './decision.types.js'
import type { DecisionRequest, HumanDecision, SignOff } from './decision.types.js'

/** ROLLBACK 자체 실패(연결 손상)해도 무시 — 원본 흐름 보존(OracleRepo·DispatchStore 패턴). */
async function safeRollback(client: PoolClient): Promise<void> {
  try { await client.query('ROLLBACK') } catch { /* 손상 연결: 미COMMIT tx는 DB 자동 폐기 */ }
}

interface RequestRow {
  request_id: string; type: string; workflow_id: string; wp_id: string | null
  correlation_id: string; context: unknown; severity: string; status: string
  language: string; expires_at: Date | string | null; project_id: string | null
}
interface DecisionRow {
  decision_id: string; request_id: string; decided_by: string; authority: string | null
  choice: string; justification: string | null; routed_to: string | null
}

function rowToRequest(r: RequestRow): DecisionRequest {
  return DecisionRequestSchema.parse({
    requestId: r.request_id, type: r.type, workflowId: r.workflow_id, wpId: r.wp_id,
    correlationId: r.correlation_id, context: r.context ?? {}, severity: r.severity,
    // pg는 TIMESTAMPTZ를 Date로 반환 — 스키마(string|null)에 맞춰 ISO 정규화(B1: expires_at 첫 비-null 읽기 경로 노출).
    status: r.status, language: r.language,
    expiresAt: r.expires_at instanceof Date ? r.expires_at.toISOString() : r.expires_at,
    projectId: r.project_id,
  })
}
function rowToDecision(r: DecisionRow): HumanDecision {
  return HumanDecisionSchema.parse({
    decisionId: r.decision_id, requestId: r.request_id, decidedBy: r.decided_by,
    authority: r.authority, choice: r.choice, justification: r.justification, routedTo: r.routed_to,
  })
}

/**
 * M9 결정 영속 repo. 사람 행동(decision/signoff)·생명주기 전이(request/expire/supersede)를 프로젝션 표 +
 * manager_events + manager_outbox **단일 tx**로 적재(트랜잭셔널 아웃박스 M5·OracleRepo.approve 패턴).
 * human_decisions·sign_offs는 코드 규약 INSERT만(불변·부인방지 M9). 모든 쓰기는 ON CONFLICT DO NOTHING으로 멱등(M6).
 */
export class DecisionRepo {
  constructor(private readonly pool: Pool, private readonly now: () => number = () => Date.now()) {}

  /** 결정 요청 생성(PENDING). 동일 request_id 재생은 no-op(멱등·이벤트 미적재). */
  async createRequest(req: {
    requestId: string; type: DecisionRequest['type']; workflowId: string; correlationId: string
    wpId?: string | null; context?: DecisionRequest['context']; severity?: DecisionRequest['severity']
    language?: string; expiresAt?: string | null; projectId?: string | null
  }): Promise<{ eventId: string } | null> {
    const parsed = DecisionRequestSchema.parse({ ...req, status: DECISION_PENDING })
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const ins = await client.query(
        `INSERT INTO decision_requests
           (request_id, type, workflow_id, wp_id, correlation_id, context, severity, status, language, expires_at, project_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (request_id) DO NOTHING`,
        [parsed.requestId, parsed.type, parsed.workflowId, parsed.wpId, parsed.correlationId,
          JSON.stringify(parsed.context), parsed.severity, parsed.status, parsed.language, parsed.expiresAt, parsed.projectId],
      )
      if (ins.rowCount === 0) { await safeRollback(client); return null }
      const eventId = await this.appendEvent(client, {
        eventType: DECISION_REQUESTED_EVENT, workflowId: parsed.workflowId, correlationId: parsed.correlationId,
        causationId: null, stepKey: parsed.requestId, actor: DECISION_ACTOR,
        payload: { requestId: parsed.requestId, type: parsed.type, workflowId: parsed.workflowId, severity: parsed.severity },
      })
      await client.query('COMMIT')
      return { eventId }
    } catch (err) {
      await safeRollback(client); throw err
    } finally {
      client.release()
    }
  }

  /** 사람 결정 기록(불변). PENDING 요청만 결정 가능(§2) → RESOLVED 전이. 중복 decision_id는 no-op(M6). */
  async recordDecision(dec: {
    decisionId: string; requestId: string; decidedBy: string; choice: HumanDecision['choice']
    authority?: string | null; justification?: string | null; routedTo?: HumanDecision['routedTo']
  }): Promise<{ eventId: string } | null> {
    const d = HumanDecisionSchema.parse(dec)
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const sel = await client.query<{ workflow_id: string; correlation_id: string; status: string }>(
        `SELECT workflow_id, correlation_id, status FROM decision_requests WHERE request_id = $1 FOR UPDATE`,
        [d.requestId],
      )
      const row = sel.rows[0]
      if (!row || row.status !== DECISION_PENDING) { await safeRollback(client); return null }
      const ins = await client.query(
        `INSERT INTO human_decisions
           (decision_id, request_id, decided_by, authority, choice, justification, routed_to, correlation_id, causation_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (decision_id) DO NOTHING`,
        [d.decisionId, d.requestId, d.decidedBy, d.authority, d.choice, d.justification, d.routedTo, row.correlation_id, d.requestId],
      )
      if (ins.rowCount === 0) { await safeRollback(client); return null }
      await client.query(
        `UPDATE decision_requests SET status = $2, resolved_at = NOW() WHERE request_id = $1`,
        [d.requestId, DECISION_RESOLVED],
      )
      const eventId = await this.appendEvent(client, {
        eventType: DECISION_RECORDED_EVENT, workflowId: row.workflow_id, correlationId: row.correlation_id,
        causationId: d.requestId, stepKey: d.decisionId, actor: d.decidedBy,
        payload: { decisionId: d.decisionId, requestId: d.requestId, choice: d.choice, routedTo: d.routedTo, decidedBy: d.decidedBy },
      })
      await client.query('COMMIT')
      return { eventId }
    } catch (err) {
      await safeRollback(client); throw err
    } finally {
      client.release()
    }
  }

  /** 사인오프 기록(불변·비부인 N2). 참조 결정이 존재해야 함. 중복 signoff_id는 no-op(M6). */
  async recordSignOff(so: {
    signoffId: string; decisionId: string; scope: string; approver: string
    risk?: string; reason?: string | null; authorityLevel?: string | null; expiresAt?: string | null; techDebtRef?: string | null
  }): Promise<{ eventId: string } | null> {
    const s: SignOff = SignOffSchema.parse(so)
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const sel = await client.query<{ workflow_id: string; correlation_id: string }>(
        `SELECT dr.workflow_id, dr.correlation_id FROM human_decisions hd
           JOIN decision_requests dr ON hd.request_id = dr.request_id
         WHERE hd.decision_id = $1 FOR UPDATE`,
        [s.decisionId],
      )
      const row = sel.rows[0]
      if (!row) { await safeRollback(client); return null }
      const ins = await client.query(
        `INSERT INTO sign_offs
           (signoff_id, decision_id, scope, risk, reason, approver, authority_level, tech_debt_ref, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (signoff_id) DO NOTHING`,
        [s.signoffId, s.decisionId, s.scope, s.risk, s.reason, s.approver, s.authorityLevel, s.techDebtRef, s.expiresAt],
      )
      if (ins.rowCount === 0) { await safeRollback(client); return null }
      const eventId = await this.appendEvent(client, {
        eventType: SIGNOFF_RECORDED_EVENT, workflowId: row.workflow_id, correlationId: row.correlation_id,
        causationId: s.decisionId, stepKey: s.signoffId, actor: s.approver,
        payload: { signoffId: s.signoffId, decisionId: s.decisionId, scope: s.scope, risk: s.risk, approver: s.approver },
      })
      await client.query('COMMIT')
      return { eventId }
    } catch (err) {
      await safeRollback(client); throw err
    } finally {
      client.release()
    }
  }

  /** 타임아웃 만료(EXPIRED) — 자동 통과 아님, 에스컬레이션 신호 발행(M8). PENDING만 전이. */
  async expireRequest(requestId: string): Promise<{ eventId: string } | null> {
    return this.transition(requestId, DECISION_EXPIRED, DECISION_EXPIRED_EVENT)
  }

  /** 상위 변경으로 무효(SUPERSEDED). PENDING만 전이. */
  async supersedeRequest(requestId: string): Promise<{ eventId: string } | null> {
    return this.transition(requestId, DECISION_SUPERSEDED, DECISION_SUPERSEDED_EVENT)
  }

  async getRequest(requestId: string): Promise<DecisionRequest | null> {
    const { rows } = await this.pool.query<RequestRow>(`SELECT * FROM decision_requests WHERE request_id = $1`, [requestId])
    const row = rows[0]
    return row ? rowToRequest(row) : null
  }

  async pendingByWorkflow(workflowId: string): Promise<DecisionRequest[]> {
    const { rows } = await this.pool.query<RequestRow>(
      `SELECT * FROM decision_requests WHERE workflow_id = $1 AND status = $2 ORDER BY created_at`,
      [workflowId, DECISION_PENDING],
    )
    return rows.map(rowToRequest)
  }

  async pendingByProject(projectId: string): Promise<DecisionRequest[]> {
    const { rows } = await this.pool.query<RequestRow>(
      `SELECT * FROM decision_requests WHERE project_id = $1 AND status = $2 ORDER BY created_at`,
      [projectId, DECISION_PENDING],
    )
    return rows.map(rowToRequest)
  }

  /**
   * B1: 만료된 PENDING 결정의 requestId 조회(sweep 입력). now는 ms epoch → to_timestamp 변환.
   * expires_at IS NOT NULL로 레거시(만료 미설정) 행 제외(소급 만료 0). strictly-before(<)·UTC.
   */
  async expiredPendingRequests(now: number, limit: number): Promise<string[]> {
    const { rows } = await this.pool.query<{ request_id: string }>(
      `SELECT request_id FROM decision_requests
        WHERE status = 'PENDING' AND expires_at IS NOT NULL AND expires_at < to_timestamp($1 / 1000.0)
        ORDER BY expires_at ASC
        LIMIT $2`,
      [now, limit],
    )
    return rows.map((r) => r.request_id)
  }

  /**
   * P5-2b: 해당 workflow에 scope='release' 사인오프가 존재하는지. sign_offs ⋈ human_decisions ⋈ decision_requests
   * 조인으로 워크플로 매칭. 존재 = 사람이 degraded 릴리스를 명시 수용(비부인 M9). deploy 게이트 우회 근거.
   */
  async hasApprovedReleaseSignoff(workflowId: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ ok: number }>(
      `SELECT 1 AS ok
         FROM sign_offs s
         JOIN human_decisions h ON h.decision_id = s.decision_id
         JOIN decision_requests r ON r.request_id = h.request_id
        WHERE r.workflow_id = $1 AND s.scope = 'release'
        LIMIT 1`,
      [workflowId],
    )
    return rows.length > 0
  }

  /** N2: 이 WP가 degraded_dispatch 사인오프로 승인됐는지(scope 매칭·wp_id 격리). hasApprovedReleaseSignoff 패턴 + wp_id·type 필터. */
  async hasApprovedDegradedDispatch(workflowId: string, wpId: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ ok: number }>(
      `SELECT 1 AS ok
         FROM sign_offs s
         JOIN human_decisions h ON h.decision_id = s.decision_id
         JOIN decision_requests r ON r.request_id = h.request_id
        WHERE r.workflow_id = $1 AND r.wp_id = $2 AND r.type = 'degraded_dispatch' AND s.scope = 'degraded_dispatch'
        LIMIT 1`,
      [workflowId, wpId],
    )
    return rows.length > 0
  }

  async decisionsForRequest(requestId: string): Promise<HumanDecision[]> {
    const { rows } = await this.pool.query<DecisionRow>(
      `SELECT * FROM human_decisions WHERE request_id = $1 ORDER BY decided_at`,
      [requestId],
    )
    return rows.map(rowToDecision)
  }

  /** PENDING → toStatus 전이 + 생명주기 이벤트(아웃박스). 비-PENDING·미존재면 null·이벤트 미적재. */
  private async transition(requestId: string, toStatus: string, eventType: string): Promise<{ eventId: string } | null> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const sel = await client.query<{ workflow_id: string; correlation_id: string; status: string }>(
        `SELECT workflow_id, correlation_id, status FROM decision_requests WHERE request_id = $1 FOR UPDATE`,
        [requestId],
      )
      const row = sel.rows[0]
      if (!row || row.status !== DECISION_PENDING) { await safeRollback(client); return null }
      await client.query(`UPDATE decision_requests SET status = $2 WHERE request_id = $1`, [requestId, toStatus])
      const eventId = await this.appendEvent(client, {
        eventType, workflowId: row.workflow_id, correlationId: row.correlation_id,
        causationId: requestId, stepKey: requestId, actor: DECISION_ACTOR,
        payload: { requestId, status: toStatus, workflowId: row.workflow_id },
      })
      await client.query('COMMIT')
      return { eventId }
    } catch (err) {
      await safeRollback(client); throw err
    } finally {
      client.release()
    }
  }

  /** manager_events(진실원천) + manager_outbox(M5)를 호출 tx에 적재. eventId 반환. */
  private async appendEvent(client: PoolClient, e: {
    eventType: string; workflowId: string; correlationId: string; causationId: string | null
    stepKey: string; actor: string; payload: Record<string, unknown>
  }): Promise<string> {
    const env = makeEnvelope(
      { correlationId: e.correlationId, causationId: e.causationId, workflowId: e.workflowId, stepId: `${e.eventType}:${e.stepKey}`, attemptId: 0 },
      this.now(),
    )
    await client.query(
      `INSERT INTO manager_events
         (event_id, session_id, event_type, payload, correlation_id, causation_id, idempotency_key, actor, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [env.eventId, e.workflowId, e.eventType, JSON.stringify(e.payload),
        env.correlationId, env.causationId, env.idempotencyKey, e.actor, env.occurredAt],
    )
    await client.query(
      `INSERT INTO manager_outbox (event_id, stream, message) VALUES ($1,$2,$3)`,
      [env.eventId, DECISION_STREAM, JSON.stringify({ envelope: env, type: e.eventType, payload: e.payload })],
    )
    return env.eventId
  }
}
