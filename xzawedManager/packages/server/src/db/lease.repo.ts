import type { Pool, PoolClient } from 'pg'
import type { EventEnvelope } from '@xzawed/agent-streams'
import { appendWpEvent, wpEnvelope } from './dispatch.repo.js'
import {
  LEASE_ACTIVE, LEASE_ESCALATED, DISPATCHED_STATE, WP_DISPATCHED_EVENT, ESCALATED_STATE, WP_ESCALATED_EVENT,
} from '../streams/dispatch-constants.js'

export interface LeaseRecord {
  workflowId: string
  wpId: string
  attempt: number
  owner: string | null
  status: string
  expiresAt: number
  stepN: number
  eventId: string | null
}

interface LeaseRow {
  workflow_id: string
  wp_id: string
  attempt: number
  owner: string | null
  status: string
  expires_at: number | string
  step_n: number
  event_id: string | null
}

function mapLease(r: LeaseRow): LeaseRecord {
  return {
    workflowId: r.workflow_id, wpId: r.wp_id, attempt: r.attempt, owner: r.owner,
    status: r.status, expiresAt: Number(r.expires_at), stepN: r.step_n, eventId: r.event_id,
  }
}

export interface ReclaimInput {
  workflowId: string; wpId: string; nextAttempt: number; stepN: number; visibilityMs: number; causationId?: string | null
}
export interface EscalateInput {
  workflowId: string; wpId: string; attempt: number; stepN: number; causationId?: string | null
}
export type ReclaimResult = { status: 'reclaimed'; eventId: string; seq: number } | { status: 'skipped' }
export type EscalateResult = { status: 'escalated'; eventId: string; seq: number } | { status: 'skipped' }

const LEASE_COLS = 'workflow_id, wp_id, attempt, owner, status, expires_at, step_n, event_id'

interface AppendArgs {
  workflowId: string; wpId: string; attempt: number; stepN: number
  eventType: string; fromState: string; toState: string; reason: string
}

/**
 * lease 생명주기 저장소 — 만료 조회 + 원자 reclaim/escalate. reclaim/escalate는 dispatch.repo의
 * appendWpEvent(manager_events+wp_state_log+outbox)를 재사용해 단일 tx로 적재(M5). 미배선.
 */
export class LeaseStore {
  constructor(
    private readonly pool: Pool,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** 만료된 active lease(가시성 타임아웃 초과) 조회 — sweep용. */
  async expiredActiveLeases(now: number, limit = 100): Promise<LeaseRecord[]> {
    const { rows } = await this.pool.query<LeaseRow>(
      `SELECT ${LEASE_COLS} FROM wp_leases
        WHERE status = $1 AND expires_at < $2
        ORDER BY workflow_id, wp_id
        LIMIT $3`,
      [LEASE_ACTIVE, now, limit],
    )
    return rows.map(mapLease)
  }

  async getLease(workflowId: string, wpId: string): Promise<LeaseRecord | null> {
    const { rows } = await this.pool.query<LeaseRow>(
      `SELECT ${LEASE_COLS} FROM wp_leases WHERE workflow_id = $1 AND wp_id = $2`,
      [workflowId, wpId],
    )
    const r = rows[0]
    return r ? mapLease(r) : null
  }

  /**
   * reclaim: lease를 attempt++·새 만료·active로 갱신하고 wp.dispatched(attempt next)를 적재(재디스패치).
   * 동시 sweep 직렬화: reclaim은 status를 'active'로 유지하므로 status 가드만으로는 이중 reclaim을 못 막는다.
   * **attempt CAS**(`AND attempt = $expected`)로 직렬화 — 경쟁한 두 번째 reclaim은 attempt가 이미 증가해
   * 0행→skip(같은 attempt 중복 wp.dispatched 차단). event_id는 새 dispatch event로 갱신(provenance).
   */
  async recordReclaim(input: ReclaimInput): Promise<ReclaimResult> {
    const now = this.now()
    const env = wpEnvelope(input.workflowId, input.wpId, input.nextAttempt, now, input.causationId)
    const expiresAt = now + input.visibilityMs
    const expectedAttempt = input.nextAttempt - 1 // 재할당 전 attempt(CAS 기대값)
    const res = await this.transition(
      env,
      `UPDATE wp_leases SET attempt = $1, expires_at = $2, status = $3, event_id = $4, updated_at = NOW()
        WHERE workflow_id = $5 AND wp_id = $6 AND status = $7 AND attempt = $8
        RETURNING wp_id`,
      [input.nextAttempt, expiresAt, LEASE_ACTIVE, env.eventId, input.workflowId, input.wpId, LEASE_ACTIVE, expectedAttempt],
      {
        workflowId: input.workflowId, wpId: input.wpId, attempt: input.nextAttempt, stepN: input.stepN,
        eventType: WP_DISPATCHED_EVENT, fromState: DISPATCHED_STATE, toState: DISPATCHED_STATE, reason: 'reclaim',
      },
    )
    return res === null ? { status: 'skipped' } : { status: 'reclaimed', ...res }
  }

  /**
   * escalate: lease를 escalated로 갱신하고 wp.escalated(ESCALATED 전이)를 적재(상한 초과 사람 에스컬레이션).
   * status='active'→'escalated' 단방향 전이라, 경쟁한 두 번째 escalate는 status 가드로 0행→skip(직렬화).
   * lease.event_id는 갱신하지 않는다 — 마지막 dispatch provenance 보존(스키마 '유발 wp.dispatched').
   */
  async recordEscalation(input: EscalateInput): Promise<EscalateResult> {
    const now = this.now()
    const env = wpEnvelope(input.workflowId, input.wpId, input.attempt, now, input.causationId)
    const res = await this.transition(
      env,
      `UPDATE wp_leases SET status = $1, updated_at = NOW()
        WHERE workflow_id = $2 AND wp_id = $3 AND status = $4
        RETURNING wp_id`,
      [LEASE_ESCALATED, input.workflowId, input.wpId, LEASE_ACTIVE],
      {
        workflowId: input.workflowId, wpId: input.wpId, attempt: input.attempt, stepN: input.stepN,
        eventType: WP_ESCALATED_EVENT, fromState: DISPATCHED_STATE, toState: ESCALATED_STATE, reason: 'max_attempts',
      },
    )
    return res === null ? { status: 'skipped' } : { status: 'escalated', ...res }
  }

  /**
   * lease 전이 공통 tx: UPDATE(호출자가 동시 sweep 직렬화 가드를 WHERE에 포함 — reclaim은 attempt CAS,
   * escalate는 status 단방향 전이) → 0행이면 skip(null·다른 sweep이 선점) → appendWpEvent → COMMIT.
   * ROLLBACK 가드로 연결 손상 시 원본 오류 보존.
   */
  private async transition(
    env: EventEnvelope, updateSql: string, updateParams: unknown[], append: AppendArgs,
  ): Promise<{ eventId: string; seq: number } | null> {
    const client: PoolClient = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const upd = await client.query(updateSql, updateParams)
      if (upd.rows.length === 0) {
        try {
          await client.query('ROLLBACK')
        } catch {
          /* 빈 tx — 무시 */
        }
        return null
      }
      const res = await appendWpEvent(client, env, append)
      await client.query('COMMIT')
      return res
    } catch (err) {
      try {
        await client.query('ROLLBACK')
      } catch {
        /* 손상 연결 */
      }
      throw err
    } finally {
      client.release()
    }
  }
}
