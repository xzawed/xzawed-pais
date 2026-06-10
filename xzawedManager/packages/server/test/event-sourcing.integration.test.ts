import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createPool, runMigrations, closePool } from '../src/db/pool.js'
import { EventStore } from '../src/db/event-store.js'
import { SessionStore } from '../src/sessions/session.store.js'
import type { Pool } from 'pg'

// CI(turborepo 잡)는 TEST_DATABASE_URL을 주입 — 게이트 통일(Orchestrator migrate.integration 패턴)
const url = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL']
const d = url ? describe : describe.skip

d('event-sourcing 통합 (pg)', () => {
  let pool: Pool
  beforeAll(async () => {
    pool = createPool(url!)
    await runMigrations(pool)
  })
  afterAll(async () => {
    // 'es-it%' prefix 스코프 정리 — 비스코프 DELETE는 병렬 실행 중인 형제 통합 테스트의
    // manager_events/outbox 행을 지워 간헐 실패를 만든다(P1d-4 §8.3). FK 순서: outbox → events.
    await pool.query("DELETE FROM manager_outbox WHERE stream LIKE 'manager:events:es-it%'")
    await pool.query("DELETE FROM manager_events WHERE session_id LIKE 'es-it%'")
    await closePool()
  })

  it('수용기준2: 이벤트 주입 후 새 인스턴스 replay로 state 복원', async () => {
    const sid = `es-it-${Date.now()}`
    const writer = new SessionStore(undefined, new EventStore(pool))
    await writer.create(sid)
    const p = writer.waitForInfo(sid)
    await new Promise((r) => setImmediate(r))
    await writer.resolveInfo(sid, 'x') // → running
    await p

    // "크래시" 시뮬: 새 store 인스턴스가 replay로만 복원
    const reader = new SessionStore(undefined, new EventStore(pool))
    const restored = await new EventStore(pool).replaySessions()
    for (const [s, v] of restored) reader.restoreSession(s, v.state, v.lastEventId, v.count)
    expect(reader.get(sid)?.state).toBe('running')
  })

  it('수용기준1·3: append가 events+outbox 원자적 기록 + correlation/causation 보유', async () => {
    const sid = `es-it2-${Date.now()}`
    await new SessionStore(undefined, new EventStore(pool)).create(sid)
    const ev = await pool.query('SELECT * FROM manager_events WHERE session_id=$1', [sid])
    const ob = await pool.query('SELECT * FROM manager_outbox WHERE event_id=$1', [ev.rows[0].event_id])
    expect(ev.rows).toHaveLength(1)
    expect(ev.rows[0].correlation_id).toBe(sid)
    expect(ev.rows[0].causation_id).toBeNull() // 첫 이벤트
    expect(ob.rows).toHaveLength(1) // 같은 tx로 outbox도 기록
  })
})
