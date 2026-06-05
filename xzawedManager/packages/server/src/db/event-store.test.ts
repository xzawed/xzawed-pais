import { describe, it, expect, vi } from 'vitest'
import { EventStore } from './event-store.js'

function makeMockPool() {
  const query = vi.fn().mockResolvedValue({ rows: [] })
  const release = vi.fn()
  const client = { query, release }
  const connect = vi.fn().mockResolvedValue(client)
  return { pool: { connect } as never, client, query, release, connect }
}

describe('EventStore.appendSessionEvent', () => {
  it('단일 트랜잭션으로 events + outbox를 INSERT하고 COMMIT한다', async () => {
    const m = makeMockPool()
    const store = new EventStore(m.pool, () => 1000)
    const res = await store.appendSessionEvent({
      sessionId: 's1', type: 'SessionCreated', payload: { state: 'idle' },
      prevEventId: null, perSessionSeq: 0,
    }, 'manager:events:s1')

    const sqls = m.query.mock.calls.map((c) => String(c[0]).trim().split(/\s+/)[0].toUpperCase())
    expect(sqls[0]).toBe('BEGIN')
    expect(sqls[sqls.length - 1]).toBe('COMMIT')
    const inserts = m.query.mock.calls.filter((c) => /INSERT INTO manager_(events|outbox)/i.test(String(c[0])))
    expect(inserts).toHaveLength(2)
    expect(res.eventId).toMatch(/[0-9a-f-]{36}/)
    expect(m.release).toHaveBeenCalled()
  })

  it('INSERT 실패 시 ROLLBACK하고 throw한다(부분 기록 0)', async () => {
    const m = makeMockPool()
    m.query.mockImplementation((sql: string) => {
      if (/INSERT INTO manager_events/i.test(sql)) return Promise.reject(new Error('boom'))
      return Promise.resolve({ rows: [] })
    })
    const store = new EventStore(m.pool, () => 1000)
    await expect(store.appendSessionEvent({
      sessionId: 's1', type: 'SessionCreated', payload: {}, prevEventId: null, perSessionSeq: 0,
    }, 'manager:events:s1')).rejects.toThrow('boom')
    const sqls = m.query.mock.calls.map((c) => String(c[0]).trim().split(/\s+/)[0].toUpperCase())
    expect(sqls).toContain('ROLLBACK')
    expect(sqls).not.toContain('COMMIT')
    expect(m.release).toHaveBeenCalled()
  })

  it('이벤트 봉투 필드(correlation=sessionId, causation=prevEventId)를 INSERT 파라미터에 싣는다', async () => {
    const m = makeMockPool()
    const store = new EventStore(m.pool, () => 1000)
    await store.appendSessionEvent({
      sessionId: 's1', type: 'SessionStateChanged', payload: { state: 'running' },
      prevEventId: 'evt-prev', perSessionSeq: 2,
    }, 'manager:events:s1')
    const evCall = m.query.mock.calls.find((c) => /INSERT INTO manager_events/i.test(String(c[0])))!
    const params = evCall[1] as unknown[]
    expect(params).toContain('s1')        // session_id & correlation_id
    expect(params).toContain('evt-prev')  // causation_id
    expect(params).toContain('manager')   // actor 기본값
  })
})

describe('EventStore.replaySessions', () => {
  it('create→running→delete 시퀀스를 최종 state로 fold하고 삭제를 반영한다', async () => {
    const rows = [
      { event_id: 'e1', session_id: 's1', event_type: 'SessionCreated', payload: {} },
      { event_id: 'e2', session_id: 's1', event_type: 'SessionStateChanged', payload: { state: 'running' } },
      { event_id: 'e3', session_id: 's2', event_type: 'SessionCreated', payload: {} },
      { event_id: 'e4', session_id: 's2', event_type: 'SessionDeleted', payload: {} },
    ]
    const pool = { connect: vi.fn(), query: vi.fn().mockResolvedValue({ rows }) } as never
    const store = new EventStore(pool)
    const map = await store.replaySessions()
    expect(map.get('s1')).toMatchObject({ state: 'running', lastEventId: 'e2', count: 2 })
    expect(map.has('s2')).toBe(false)
  })
})
