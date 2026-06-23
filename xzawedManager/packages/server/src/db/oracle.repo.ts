import type { Pool, PoolClient } from 'pg'
import { makeEnvelope } from '@xzawed/agent-streams'
import type { ApprovedOracleView } from '@xzawed/agent-streams'
import {
  OracleScenarioSchema, OracleGoldenSchema, OracleInvariantSchema, coveredCriteria, oracleIdFor,
  ORACLE_PENDING, ORACLE_APPROVED, ORACLE_APPROVED_EVENT, ORACLE_ACTOR, ORACLE_STREAM, SCENARIO_APPROVED,
} from './oracle.types.js'
import type { Oracle, OracleScenario, OracleInvariant, OracleGolden } from './oracle.types.js'

interface OracleRow {
  oracle_id: string; workflow_id: string; story_id: string; version: number
  status: string; scenarios: OracleScenario[]; coverage: Record<string, string[]>
  invariants: OracleInvariant[]; golden_refs: OracleGolden[]
}

/** ROLLBACK 자체 실패(연결 손상)해도 무시 — 원본 흐름 보존(DispatchStore 패턴). */
async function safeRollback(client: PoolClient): Promise<void> {
  try { await client.query('ROLLBACK') } catch { /* 손상 연결: 미COMMIT tx는 DB 자동 폐기 */ }
}

/**
 * Oracle 프로젝션 repo. approve는 oracles UPDATE + manager_events(oracle.approved) + manager_outbox를
 * 단일 tx로(트랜잭셔널 아웃박스 M5, DispatchStore.recordDispatch 패턴). approvedByWorkflow가 satisfied-set 입력 제공.
 */
export class OracleRepo {
  constructor(private readonly pool: Pool, private readonly now: () => number = () => Date.now()) {}

  async upsert(oracle: Oracle): Promise<void> {
    await this.pool.query(
      `INSERT INTO oracles (oracle_id, workflow_id, story_id, version, status, scenarios, invariants, golden_refs, coverage)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (oracle_id) DO UPDATE SET
         version = oracles.version + 1, status = EXCLUDED.status,
         scenarios = EXCLUDED.scenarios, invariants = EXCLUDED.invariants,
         golden_refs = EXCLUDED.golden_refs, coverage = EXCLUDED.coverage`,
      [oracle.oracleId, oracle.workflowId, oracle.storyId, oracle.version, oracle.status,
        JSON.stringify(oracle.scenarios), JSON.stringify(oracle.invariants), JSON.stringify(oracle.goldenRefs),
        JSON.stringify(oracle.coverage)],
    )
  }

  /** P3-2 초안 영속(멱등): oracleId=oracleIdFor(wf,storyId)로 pending INSERT. ON CONFLICT는 pending일 때만 덮어씀
   *  (version 불변→재시도/재분해 인플레 방지·blocker#6; approved/superseded는 WHERE로 보존·D1 oracleId 단일출처). */
  async upsertDraft(input: { workflowId: string; storyId: string; scenarios: OracleScenario[]; coverage: Record<string, string[]> }): Promise<void> {
    const oracleId = oracleIdFor(input.workflowId, input.storyId)
    await this.pool.query(
      `INSERT INTO oracles (oracle_id, workflow_id, story_id, version, status, scenarios, coverage)
         VALUES ($1,$2,$3,1,'pending',$4,$5)
       ON CONFLICT (oracle_id) DO UPDATE SET
         scenarios = EXCLUDED.scenarios, coverage = EXCLUDED.coverage, status = 'pending'
         WHERE oracles.status = 'pending'`,
      [oracleId, input.workflowId, input.storyId, JSON.stringify(input.scenarios), JSON.stringify(input.coverage)],
    )
  }

  async listByWorkflow(workflowId: string, status?: string): Promise<OracleRow[]> {
    const { rows } = status
      ? await this.pool.query<OracleRow>(`SELECT * FROM oracles WHERE workflow_id = $1 AND status = $2`, [workflowId, status])
      : await this.pool.query<OracleRow>(`SELECT * FROM oracles WHERE workflow_id = $1`, [workflowId])
    return rows
  }

  async approvedByWorkflow(workflowId: string): Promise<ApprovedOracleView[]> {
    // ORDER BY story_id, version: story당 approved가 다중이면 oracleSatisfiedSet의 last-wins가
    // 최고 version을 결정론적으로 선택(승인이 이전 버전 supersede하는 §6 불변식의 결정론 보강).
    const { rows } = await this.pool.query<OracleRow>(
      `SELECT story_id, scenarios, coverage FROM oracles WHERE workflow_id = $1 AND status = $2
       ORDER BY story_id, version`,
      [workflowId, ORACLE_APPROVED],
    )
    return rows.map((r) => ({
      storyId: r.story_id,
      coveredCriteria: coveredCriteria(OracleScenarioSchema.array().parse(r.scenarios), r.coverage),
    }))
  }

  /** P4b-2: 특정 story의 approved 오라클(최신 version)에서 human_approved 시나리오 + coverage 반환.
   *  conformance author가 인코딩할 베이스라인. 승인 행 없음·human_approved 0개면 null(→ 검증 skip). */
  async approvedOracleForStory(
    workflowId: string, storyId: string,
  ): Promise<{ scenarios: OracleScenario[]; coverage: Record<string, string[]> } | null> {
    const { rows } = await this.pool.query<{ scenarios: OracleScenario[]; coverage: Record<string, string[]> }>(
      `SELECT scenarios, coverage FROM oracles
       WHERE workflow_id = $1 AND story_id = $2 AND status = $3
       ORDER BY version DESC LIMIT 1`,
      [workflowId, storyId, ORACLE_APPROVED],
    )
    const row = rows[0]
    if (!row) return null
    const approved = OracleScenarioSchema.array().parse(row.scenarios).filter((s) => s.status === SCENARIO_APPROVED)
    if (approved.length === 0) return null
    return { scenarios: approved, coverage: row.coverage ?? {} }
  }

  /** P4 impact: 특정 story의 approved 오라클(최신 version)에서 golden_refs 반환.
   *  golden-differential author가 인코딩할 베이스라인. 승인 행 없음·golden 0개면 null(→ impact skip). */
  async approvedGoldensForStory(workflowId: string, storyId: string): Promise<OracleGolden[] | null> {
    const { rows } = await this.pool.query<{ golden_refs: OracleGolden[] }>(
      `SELECT golden_refs FROM oracles
       WHERE workflow_id = $1 AND story_id = $2 AND status = $3
       ORDER BY version DESC LIMIT 1`,
      [workflowId, storyId, ORACLE_APPROVED],
    )
    const row = rows[0]
    if (!row) return null
    const goldens = OracleGoldenSchema.array().parse(row.golden_refs ?? [])
    return goldens.length > 0 ? goldens : null
  }

  /** P4 property: 특정 story의 approved 오라클(최신 version)에서 human_approved invariants 반환.
   *  property author가 인코딩할 베이스라인. 승인 행 없음·human_approved 0개면 null(→ property skip). 읽기만(N7). */
  async approvedInvariantsForStory(workflowId: string, storyId: string): Promise<OracleInvariant[] | null> {
    const { rows } = await this.pool.query<{ invariants: OracleInvariant[] }>(
      `SELECT invariants FROM oracles
       WHERE workflow_id = $1 AND story_id = $2 AND status = $3
       ORDER BY version DESC LIMIT 1`,
      [workflowId, storyId, ORACLE_APPROVED],
    )
    const row = rows[0]
    if (!row) return null
    const invariants = OracleInvariantSchema.array().parse(row.invariants ?? []).filter((i) => i.status === SCENARIO_APPROVED)
    return invariants.length > 0 ? invariants : null
  }

  /** C3: per-workflow 배치 승인 — pending 오라클 전부 approve(drafted→human_approved+oracle.approved). 성공 카운트. */
  async approvePendingByWorkflow(workflowId: string, approvedBy: string): Promise<{ approved: number }> {
    const pending = await this.listByWorkflow(workflowId, ORACLE_PENDING)
    let approved = 0
    for (const row of pending) {
      const r = await this.approve(row.oracle_id, approvedBy)
      if (r !== null) approved++
    }
    return { approved }
  }

  /** 승인: SELECT FOR UPDATE → (status≠pending이면 null·blocker#8) → drafted 시나리오 human_approved 전이 →
   *  UPDATE(status=approved) + oracle.approved 이벤트(아웃박스). drafted 없으면 전이 no-op(회귀 0). */
  async approve(oracleId: string, approvedBy: string): Promise<{ eventId: string } | null> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const sel = await client.query<{ workflow_id: string; story_id: string; version: number; status: string; scenarios: unknown }>(
        `SELECT workflow_id, story_id, version, status, scenarios FROM oracles WHERE oracle_id = $1 FOR UPDATE`,
        [oracleId],
      )
      const row = sel.rows[0]
      if (!row || row.status !== ORACLE_PENDING) { await safeRollback(client); return null }
      const transitioned = OracleScenarioSchema.array().parse(row.scenarios)
        .map((s) => (s.status === 'drafted' ? { ...s, status: SCENARIO_APPROVED } : s))
      await client.query(
        `UPDATE oracles SET status = $2, scenarios = $3, approved_at = NOW(), approved_by = $4 WHERE oracle_id = $1`,
        [oracleId, ORACLE_APPROVED, JSON.stringify(transitioned), approvedBy],
      )
      const env = makeEnvelope(
        { correlationId: row.workflow_id, causationId: null, workflowId: row.workflow_id,
          stepId: `${ORACLE_APPROVED_EVENT}:${oracleId}`, attemptId: row.version },
        this.now(),
      )
      const payload = { oracleId, workflowId: row.workflow_id, storyId: row.story_id, version: row.version }
      await client.query(
        `INSERT INTO manager_events
           (event_id, session_id, event_type, payload, correlation_id, causation_id, idempotency_key, actor, occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [env.eventId, row.workflow_id, ORACLE_APPROVED_EVENT, JSON.stringify(payload),
          env.correlationId, env.causationId, env.idempotencyKey, ORACLE_ACTOR, env.occurredAt],
      )
      await client.query(
        `INSERT INTO manager_outbox (event_id, stream, message) VALUES ($1,$2,$3)`,
        [env.eventId, ORACLE_STREAM, JSON.stringify({ envelope: env, type: ORACLE_APPROVED_EVENT, payload })],
      )
      await client.query('COMMIT')
      return { eventId: env.eventId }
    } catch (err) {
      await safeRollback(client)
      throw err
    } finally {
      client.release()
    }
  }
}
