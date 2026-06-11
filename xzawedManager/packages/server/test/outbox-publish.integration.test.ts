import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createPool, runMigrations, closePool } from '../src/db/pool.js'
import { createOutboxPublish } from '../src/streams/outbox-publish.js'

// CI(turborepo 잡)는 TEST_DATABASE_URL 주입. 없으면 skip(로컬·CI 환경 따라).
const url = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL']

// 하드닝: decompose emission이 트랜잭셔널 아웃박스를 경유해 manager_events(진실원천)+manager_outbox에
// 실 적재되는지 실 Postgres로 실증. published_at=NULL(relay 발행 대기)이 at-least-once 내구성의 핵심.
describe.skipIf(!url)('createOutboxPublish 통합(manager_events + manager_outbox 실 적재)', () => {
  it('단일 tx로 truth-source 이벤트 + 미발행 outbox 행 적재(relay 발행 대기)', async () => {
    const pool = createPool(url!)
    try {
      await runMigrations(pool)
      const wf = `wf-obx-${Date.now()}`
      const env = {
        eventId: randomUUID(), correlationId: wf, causationId: null, workflowId: wf,
        stepId: 'decomposition.emitted', attemptId: 0,
        idempotencyKey: `${wf}:decomposition.emitted:0`, occurredAt: 1000,
      }
      const message = { envelope: env, type: 'decomposition.emitted', payload: { workPackages: [{ id: 'a' }] } }

      const eventId = await createOutboxPublish(pool)('manager:decomposition:main', message)
      expect(eventId).toBe(env.eventId)

      // manager_events: 진실원천 행(session_id=workflowId·event_type·idempotency_key·payload).
      const ev = await pool.query(
        'SELECT event_type, session_id, idempotency_key, payload, actor FROM manager_events WHERE event_id = $1',
        [eventId],
      )
      expect(ev.rows[0]).toMatchObject({
        event_type: 'decomposition.emitted', session_id: wf,
        idempotency_key: `${wf}:decomposition.emitted:0`, actor: 'task-manager',
      })
      expect(ev.rows[0].payload).toEqual({ workPackages: [{ id: 'a' }] })

      // manager_outbox: 원본 message·stream·published_at=NULL(relay가 발행하면 채워짐 — at-least-once 보증점).
      const ob = await pool.query(
        'SELECT stream, message, published_at FROM manager_outbox WHERE event_id = $1', [eventId],
      )
      expect(ob.rows[0].stream).toBe('manager:decomposition:main')
      expect(ob.rows[0].published_at).toBeNull()
      expect(ob.rows[0].message).toMatchObject({ type: 'decomposition.emitted' })
    } finally {
      // wf-obx-% prefix 스코프 정리(FK 순서: outbox→events).
      await pool.query("DELETE FROM manager_outbox WHERE message::text LIKE '%wf-obx-%'").catch(() => undefined)
      await pool.query("DELETE FROM manager_events WHERE session_id LIKE 'wf-obx-%'").catch(() => undefined)
      await closePool()
    }
  })
})
