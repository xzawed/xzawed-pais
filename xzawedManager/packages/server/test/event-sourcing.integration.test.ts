import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createPool, runMigrations, closePool } from '../src/db/pool.js'
import { EventStore } from '../src/db/event-store.js'
import { SessionStore } from '../src/sessions/session.store.js'
import type { Pool } from 'pg'

const url = process.env['DATABASE_URL']
const d = url ? describe : describe.skip

d('event-sourcing 통합 (pg)', () => {
  let pool: Pool
  beforeAll(async () => {
    pool = createPool(url!)
    await runMigrations(pool)
  })
  afterAll(async () => {
    await pool.query('DELETE FROM manager_outbox')
    await pool.query('DELETE FROM manager_events')
    await closePool()
  })

  it('수용기준2: 이벤트 주입 후 새 인스턴스 replay로 state 복원', async () => {
    const sid = `it-${Date.now()}`
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
    const sid = `it2-${Date.now()}`
    await new SessionStore(undefined, new EventStore(pool)).create(sid)
    const ev = await pool.query('SELECT * FROM manager_events WHERE session_id=$1', [sid])
    const ob = await pool.query('SELECT * FROM manager_outbox WHERE event_id=$1', [ev.rows[0].event_id])
    expect(ev.rows).toHaveLength(1)
    expect(ev.rows[0].correlation_id).toBe(sid)
    expect(ev.rows[0].causation_id).toBeNull() // 첫 이벤트
    expect(ob.rows).toHaveLength(1) // 같은 tx로 outbox도 기록
  })
})
