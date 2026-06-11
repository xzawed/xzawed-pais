import type { Pool, PoolClient } from 'pg'
import type { EventEnvelope } from '@xzawed/agent-streams'
import type { DecomposePublish } from '../decompose/producer.js'

/** 아웃박스 발행 이벤트의 기본 actor(manager_events.actor). */
const OUTBOX_PUBLISH_ACTOR = 'task-manager'

/** ROLLBACK 자체 실패(연결 손상)해도 무시 — 원본 흐름 보존(EventStore·DispatchStore 패턴). */
async function safeRollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK')
  } catch {
    /* 손상 연결: 미COMMIT tx는 DB가 자동 폐기 */
  }
}

/**
 * 트랜잭셔널 아웃박스 발행기(M5). 이미 봉투를 갖춘 메시지(`{envelope,type,payload}`)를
 * manager_events(append-only 진실원천) + manager_outbox에 **단일 tx**로 적재한다 — OutboxRelay가 stream으로
 * at-least-once 발행. decompose 생산자의 raw `producer.publishRaw`를 대체해 emission을 (a) 크래시·전송실패에도
 * 재발행되는 at-least-once로, (b) 이벤트소싱 truth-source·감사(M7)에 정합하게 만든다.
 * `DecomposePublish` 시그니처를 만족하므로 producer 코드는 무수정(배선만 교체).
 */
export function createOutboxPublish(pool: Pool, actor: string = OUTBOX_PUBLISH_ACTOR): DecomposePublish {
  return async (stream, message) => {
    const env = message['envelope'] as EventEnvelope
    const type = message['type'] as string
    const payload = (message['payload'] ?? {}) as Record<string, unknown>
    const client: PoolClient = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `INSERT INTO manager_events
           (event_id, session_id, event_type, payload, correlation_id, causation_id, idempotency_key, actor, occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          env.eventId, env.workflowId, type, JSON.stringify(payload),
          env.correlationId, env.causationId, env.idempotencyKey, actor, env.occurredAt,
        ],
      )
      await client.query(
        `INSERT INTO manager_outbox (event_id, stream, message) VALUES ($1,$2,$3)`,
        [env.eventId, stream, JSON.stringify(message)],
      )
      await client.query('COMMIT')
      return env.eventId
    } catch (err) {
      await safeRollback(client)
      throw err
    } finally {
      client.release()
    }
  }
}
