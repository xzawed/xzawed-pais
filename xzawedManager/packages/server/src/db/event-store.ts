import type { Pool, PoolClient } from 'pg'
import { makeEnvelope } from '@xzawed/agent-streams'
import type { SessionState } from '../sessions/session.store.js'

export type SessionEventType = 'SessionCreated' | 'SessionStateChanged' | 'SessionDeleted'

export interface AppendSessionEventInput {
  sessionId: string
  type: SessionEventType
  payload: Record<string, unknown>
  prevEventId: string | null
  perSessionSeq: number
  actor?: string
}
export interface AppendResult {
  eventId: string
}

/** 세션 이벤트소싱 저장소 — append-only manager_events(진실원천) + 트랜잭셔널 manager_outbox(M5). */
export class EventStore {
  constructor(
    private readonly pool: Pool,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * 세션 이벤트를 단일 트랜잭션으로 manager_events + manager_outbox에 append한다(dual-write 0).
   * 봉투(#239)로 correlation(=sessionId)·causation(=prevEventId)·idempotency를 채운다.
   */
  async appendSessionEvent(input: AppendSessionEventInput, stream: string): Promise<AppendResult> {
    const env = makeEnvelope(
      {
        correlationId: input.sessionId,
        causationId: input.prevEventId,
        workflowId: input.sessionId,
        stepId: `${input.type}#${input.perSessionSeq}`,
        attemptId: 0,
      },
      this.now(),
    )
    const actor = input.actor ?? 'manager'
    const client: PoolClient = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `INSERT INTO manager_events
           (event_id, session_id, event_type, payload, correlation_id, causation_id, idempotency_key, actor, occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          env.eventId, input.sessionId, input.type, JSON.stringify(input.payload),
          env.correlationId, env.causationId, env.idempotencyKey, actor, env.occurredAt,
        ],
      )
      await client.query(
        `INSERT INTO manager_outbox (event_id, stream, message) VALUES ($1,$2,$3)`,
        [env.eventId, stream, JSON.stringify({ envelope: env, type: input.type, payload: input.payload })],
      )
      await client.query('COMMIT')
      return { eventId: env.eventId }
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  /** 전 이벤트를 seq순으로 fold해 세션별 최종 state·마지막 eventId·이벤트 수를 복원한다. */
  async replaySessions(): Promise<Map<string, { state: SessionState; lastEventId: string; count: number }>> {
    const { rows } = await this.pool.query(
      `SELECT event_id, session_id, event_type, payload FROM manager_events ORDER BY seq ASC`,
    )
    const out = new Map<string, { state: SessionState; lastEventId: string; count: number }>()
    for (const r of rows as Array<{ event_id: string; session_id: string; event_type: string; payload: unknown }>) {
      if (r.event_type === 'SessionDeleted') {
        out.delete(r.session_id)
        continue
      }
      const prev = out.get(r.session_id)
      const payloadState = (r.payload as { state?: SessionState } | null)?.state
      const state: SessionState =
        r.event_type === 'SessionCreated' ? 'idle' : payloadState ?? prev?.state ?? 'idle'
      out.set(r.session_id, { state, lastEventId: r.event_id, count: (prev?.count ?? 0) + 1 })
    }
    return out
  }
}
