import type { Pool, PoolClient } from 'pg'
import { makeEnvelope } from '@xzawed/agent-streams'
import type { EventEnvelope } from '@xzawed/agent-streams'
import {
  DISPATCHED_STATE, WP_DISPATCHED_EVENT, DISPATCH_ACTOR, LEASE_ACTIVE, wpStepId,
} from '../streams/dispatch-constants.js'

export interface RecordDispatchInput {
  workflowId: string
  wpId: string
  /** topoSort.order 인덱스(결정론). 이벤트 payload·lease.step_n 표시용(N4). */
  stepN: number
  /** 전이 from_state(초기 디스패치=DRAFTED). */
  fromState: string
  /** lease 만료 = occurredAt + visibilityMs. */
  visibilityMs: number
  /** 디스패치 시도(0=최초). 멱등키 `{wf}:wp-${wpId}:${attempt}` 구성. */
  attempt?: number
  owner?: string | null
  /** 전이 to_state. 기본 'DISPATCHED'. */
  toState?: string
  causationId?: string | null
  reason?: string | null
}

export type RecordDispatchResult =
  | { status: 'recorded'; eventId: string; seq: number }
  | { status: 'deduped' } // 이미 lease 존재(동시/재진입) → 무적재(§8 #2)

/** WP 생명주기 봉투 — 멱등키를 WP id에 고정(§8 #1): `{wf}:wp-${wpId}:${attempt}`. */
export function wpEnvelope(
  workflowId: string, wpId: string, attempt: number, now: number, causationId?: string | null,
): EventEnvelope {
  return makeEnvelope(
    { correlationId: workflowId, causationId: causationId ?? null, workflowId, stepId: wpStepId(wpId), attemptId: attempt },
    now,
  )
}

export interface AppendWpEventInput {
  workflowId: string
  wpId: string
  attempt: number
  stepN: number
  eventType: string
  fromState: string
  toState: string
  reason?: string | null
}

/**
 * WP 생명주기 이벤트를 호출자 tx에 합류해 적재: manager_events(진실원천) + wp_state_log(전이, RETURNING seq)
 * + manager_outbox(M5). recordDispatch(5a)·recordReclaim/recordEscalation(5b) 공유(contract-drift 회피).
 * 봉투는 호출자가 만들어 lease 행과 event_id를 공유한다.
 */
export async function appendWpEvent(
  client: PoolClient, env: EventEnvelope, input: AppendWpEventInput,
): Promise<{ eventId: string; seq: number }> {
  const payload = { wpId: input.wpId, stepN: input.stepN, attempt: input.attempt }
  const message = { envelope: env, type: input.eventType, payload }
  await client.query(
    `INSERT INTO manager_events
       (event_id, session_id, event_type, payload, correlation_id, causation_id, idempotency_key, actor, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      env.eventId, input.workflowId, input.eventType, JSON.stringify(payload),
      env.correlationId, env.causationId, env.idempotencyKey, DISPATCH_ACTOR, env.occurredAt,
    ],
  )
  const { rows } = await client.query<{ seq: number | string }>(
    `INSERT INTO wp_state_log (workflow_id, wp_id, from_state, to_state, event_id, reason, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING seq`,
    [input.workflowId, input.wpId, input.fromState, input.toState, env.eventId, input.reason ?? null, env.occurredAt],
  )
  const row = rows[0]
  if (!row) throw new Error('appendWpEvent: no row returned')
  await client.query(
    `INSERT INTO manager_outbox (event_id, stream, message) VALUES ($1,$2,$3)`,
    [env.eventId, `manager:events:${input.workflowId}`, JSON.stringify(message)],
  )
  return { eventId: env.eventId, seq: Number(row.seq) }
}

/**
 * WP 디스패치 원자 적재 — wp_leases(가시성 lease·dedup 게이트) + manager_events + wp_state_log
 * (DRAFTED→DISPATCHED) + manager_outbox를 단일 tx로. lease ON CONFLICT DO NOTHING이 동시/재진입 중복을
 * 차단(§8 #2). 봉투 멱등키는 WP+attempt 고정(§8 #1). 기존 OutboxRelay가 manager:events:{wf}로 발행.
 */
export class DispatchStore {
  constructor(
    private readonly pool: Pool,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async recordDispatch(input: RecordDispatchInput): Promise<RecordDispatchResult> {
    const { workflowId, wpId, stepN, fromState } = input
    const attempt = input.attempt ?? 0
    const now = this.now()
    const expiresAt = now + input.visibilityMs
    const env = wpEnvelope(workflowId, wpId, attempt, now, input.causationId)

    const client: PoolClient = await this.pool.connect()
    try {
      await client.query('BEGIN')
      // lease 획득(dedup 게이트): 이미 lease면 ON CONFLICT 0행 → deduped. event_id로 dispatch event 공유.
      const lease = await client.query(
        `INSERT INTO wp_leases (workflow_id, wp_id, attempt, owner, status, expires_at, step_n, event_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (workflow_id, wp_id) DO NOTHING
         RETURNING wp_id`,
        [workflowId, wpId, attempt, input.owner ?? null, LEASE_ACTIVE, expiresAt, stepN, env.eventId],
      )
      if (lease.rows.length === 0) {
        // 빈 tx(ON CONFLICT 0행) 폐기. ROLLBACK 실패(연결 손상)해도 deduped는 정상 결과라
        // 예외로 변질시키지 않는다(catch 분기와 동일 fail-safe·빈 tx는 DB가 자동 폐기).
        try {
          await client.query('ROLLBACK')
        } catch {
          /* 빈 tx — 무시 */
        }
        return { status: 'deduped' }
      }
      const { eventId, seq } = await appendWpEvent(client, env, {
        workflowId, wpId, attempt, stepN,
        eventType: WP_DISPATCHED_EVENT,
        fromState,
        toState: input.toState ?? DISPATCHED_STATE,
        reason: input.reason ?? null,
      })
      await client.query('COMMIT')
      return { status: 'recorded', eventId, seq }
    } catch (err) {
      // ROLLBACK 자체 실패(연결 손상)해도 원본 오류 보존 — 진단 마스킹 방지.
      try {
        await client.query('ROLLBACK')
      } catch {
        /* 손상 연결: COMMIT 미실행이라 DB 자동 폐기 */
      }
      throw err
    } finally {
      client.release()
    }
  }
}
