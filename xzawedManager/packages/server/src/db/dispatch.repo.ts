import type { Pool, PoolClient } from 'pg'
import { makeEnvelope } from '@xzawed/agent-streams'
import { DISPATCHED_STATE, WP_DISPATCHED_EVENT, DISPATCH_ACTOR } from '../streams/dispatch-constants.js'

export interface RecordDispatchInput {
  workflowId: string
  wpId: string
  /** topoSort.order 인덱스(결정론). 봉투 stepId='step-${stepN}'. */
  stepN: number
  /** 전이 from_state(초기 디스패치=DRAFTED). */
  fromState: string
  /** 전이 to_state. 기본 'DISPATCHED'. */
  toState?: string
  /** 유발 이벤트(그래프 출처 decomposition.emitted event_id 등). 루트는 null. */
  causationId?: string | null
  reason?: string | null
}

export interface RecordDispatchResult {
  eventId: string
  seq: number
}

/**
 * WP 디스패치 원자 적재 — manager_events(진실원천) + wp_state_log(전이 로그) + manager_outbox(M5)를
 * 단일 트랜잭션으로 INSERT한다. manager_outbox.event_id → manager_events FK(006)를 한 tx로 충족.
 * EventStore.appendSessionEvent(P0)와 동일한 트랜잭셔널 아웃박스 메커니즘.
 */
export class DispatchStore {
  constructor(
    private readonly pool: Pool,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async recordDispatch(input: RecordDispatchInput): Promise<RecordDispatchResult> {
    const { workflowId, wpId, stepN, fromState } = input
    // ⚠️ 멱등키 = {wf}:step-${stepN}:0 는 step-N(위상 인덱스)에 묶인다. 첫 분해에선 안정하나,
    // 재분해(task_graphs 가변 프로젝션 version++)로 order가 바뀌면 같은 step-N이 다른 WP를
    // 가리킬 수 있어 다운스트림 M6 dedup이 오작동할 수 있다(미배선이라 현재 미발현).
    // 배선(P1d-5/P2) 전 멱등키를 WP id에 고정하거나 graph version을 포함해 해소한다. 스펙 §8 참고.
    const env = makeEnvelope(
      {
        correlationId: workflowId,
        causationId: input.causationId ?? null,
        workflowId,
        stepId: `step-${stepN}`,
        attemptId: 0,
      },
      this.now(),
    )
    const payload = { wpId, stepN }
    const message = { envelope: env, type: WP_DISPATCHED_EVENT, payload }
    const stream = `manager:events:${workflowId}`

    const client: PoolClient = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `INSERT INTO manager_events
           (event_id, session_id, event_type, payload, correlation_id, causation_id, idempotency_key, actor, occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          env.eventId, workflowId, WP_DISPATCHED_EVENT, JSON.stringify(payload),
          env.correlationId, env.causationId, env.idempotencyKey, DISPATCH_ACTOR, env.occurredAt,
        ],
      )
      const { rows } = await client.query<{ seq: number | string }>(
        `INSERT INTO wp_state_log (workflow_id, wp_id, from_state, to_state, event_id, reason, occurred_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING seq`,
        [workflowId, wpId, fromState, input.toState ?? DISPATCHED_STATE, env.eventId, input.reason ?? null, env.occurredAt],
      )
      const row = rows[0]
      if (!row) throw new Error('recordDispatch: no row returned') // COMMIT 전 → ROLLBACK 경로
      await client.query(
        `INSERT INTO manager_outbox (event_id, stream, message) VALUES ($1,$2,$3)`,
        [env.eventId, stream, JSON.stringify(message)],
      )
      await client.query('COMMIT')
      return { eventId: env.eventId, seq: Number(row.seq) }
    } catch (err) {
      // ROLLBACK 자체가 실패(연결 손상)해도 원본 오류를 보존한다 — 진단 마스킹 방지.
      // COMMIT 미실행이라 미커밋 INSERT는 DB가 자동 폐기(원자성 보존).
      try {
        await client.query('ROLLBACK')
      } catch {
        /* 손상 연결: 무시하고 원본 err를 throw(아래) */
      }
      throw err
    } finally {
      client.release()
    }
  }
}
