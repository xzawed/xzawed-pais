import { describe, it, expect, vi } from 'vitest'
import { DispatchStore } from './dispatch.repo.js'

/** seq를 RETURNING하는 wp_state_log INSERT만 seq 행을 돌려주는 mock client/pool. */
function makeMockPool() {
  const query = vi.fn().mockImplementation((sql: string) => {
    if (/INSERT INTO wp_state_log/i.test(sql)) return Promise.resolve({ rows: [{ seq: '42' }] })
    return Promise.resolve({ rows: [] })
  })
  const release = vi.fn()
  const client = { query, release }
  const connect = vi.fn().mockResolvedValue(client)
  return { pool: { connect } as never, client, query, release, connect }
}

function callsFor(query: ReturnType<typeof vi.fn>, re: RegExp) {
  return query.mock.calls.find((c) => re.test(String(c[0])))
}

describe('DispatchStore.recordDispatch', () => {
  it('단일 트랜잭션으로 manager_events + wp_state_log + manager_outbox를 INSERT하고 COMMIT한다', async () => {
    const m = makeMockPool()
    const res = await new DispatchStore(m.pool, () => 1000).recordDispatch({
      workflowId: 'wf-1', wpId: 'wp-1', stepN: 0, fromState: 'DRAFTED',
    })

    const verbs = m.query.mock.calls.map((c) => String(c[0]).trim().split(/\s+/)[0].toUpperCase())
    expect(verbs[0]).toBe('BEGIN')
    expect(verbs[verbs.length - 1]).toBe('COMMIT')
    const inserts = m.query.mock.calls.filter((c) =>
      /INSERT INTO (manager_events|wp_state_log|manager_outbox)/i.test(String(c[0])))
    expect(inserts).toHaveLength(3)
    expect(res.eventId).toMatch(/[0-9a-f-]{36}/)
    expect(res.seq).toBe(42) // BIGSERIAL 문자열 → Number
    expect(m.release).toHaveBeenCalled()
  })

  it('event_id를 세 INSERT가 공유하고 occurred_at은 봉투 시각으로 일치시킨다', async () => {
    const m = makeMockPool()
    await new DispatchStore(m.pool, () => 7777).recordDispatch({
      workflowId: 'wf-1', wpId: 'wp-1', stepN: 2, fromState: 'DRAFTED',
    })
    const ev = callsFor(m.query, /INSERT INTO manager_events/i)![1] as unknown[]
    const log = callsFor(m.query, /INSERT INTO wp_state_log/i)![1] as unknown[]
    const ob = callsFor(m.query, /INSERT INTO manager_outbox/i)![1] as unknown[]

    const eventId = ev[0]
    expect(eventId).toMatch(/[0-9a-f-]{36}/)
    expect(log[4]).toBe(eventId)   // wp_state_log.event_id
    expect(ob[0]).toBe(eventId)    // manager_outbox.event_id
    // occurred_at(봉투 시각)을 events·wp_state_log가 공유
    expect(ev[8]).toBe(7777)       // manager_events.occurred_at
    expect(log[6]).toBe(7777)      // wp_state_log.occurred_at
  })

  it('봉투 stepId=step-N·idempotencyKey·correlation/actor를 manager_events 파라미터에 싣는다', async () => {
    const m = makeMockPool()
    await new DispatchStore(m.pool, () => 1).recordDispatch({
      workflowId: 'wf-1', wpId: 'wp-1', stepN: 3, fromState: 'DRAFTED', causationId: 'src-evt',
    })
    const ev = callsFor(m.query, /INSERT INTO manager_events/i)![1] as unknown[]
    // [event_id, session_id, event_type, payload, correlation_id, causation_id, idempotency_key, actor, occurred_at]
    expect(ev[1]).toBe('wf-1')                  // session_id = workflowId
    expect(ev[2]).toBe('wp.dispatched')         // event_type
    expect(JSON.parse(ev[3] as string)).toEqual({ wpId: 'wp-1', stepN: 3 })
    expect(ev[4]).toBe('wf-1')                  // correlation_id = workflowId
    expect(ev[5]).toBe('src-evt')               // causation_id
    expect(ev[6]).toBe('wf-1:step-3:0')         // idempotency_key
    expect(ev[7]).toBe('task-manager')          // actor
  })

  it('wp_state_log에 DRAFTED→DISPATCHED 전이를, manager_outbox에 manager:events 스트림·메시지를 싣는다', async () => {
    const m = makeMockPool()
    await new DispatchStore(m.pool, () => 1).recordDispatch({
      workflowId: 'wf-1', wpId: 'wp-1', stepN: 0, fromState: 'DRAFTED',
    })
    const log = callsFor(m.query, /INSERT INTO wp_state_log/i)![1] as unknown[]
    // [workflow_id, wp_id, from_state, to_state, event_id, reason, occurred_at]
    expect(log[0]).toBe('wf-1')
    expect(log[1]).toBe('wp-1')
    expect(log[2]).toBe('DRAFTED')
    expect(log[3]).toBe('DISPATCHED')           // 기본 toState

    const ob = callsFor(m.query, /INSERT INTO manager_outbox/i)![1] as unknown[]
    expect(ob[1]).toBe('manager:events:wf-1')   // stream
    const msg = JSON.parse(ob[2] as string)
    expect(msg.type).toBe('wp.dispatched')
    expect(msg.payload).toEqual({ wpId: 'wp-1', stepN: 0 })
    expect(msg.envelope.idempotencyKey).toBe('wf-1:step-0:0')
  })

  it('toState override·reason을 반영한다', async () => {
    const m = makeMockPool()
    await new DispatchStore(m.pool, () => 1).recordDispatch({
      workflowId: 'wf-1', wpId: 'wp-1', stepN: 0, fromState: 'DRAFTED',
      toState: 'IN_PROGRESS', reason: 'manual',
    })
    const log = callsFor(m.query, /INSERT INTO wp_state_log/i)![1] as unknown[]
    expect(log[3]).toBe('IN_PROGRESS')
    expect(log[5]).toBe('manual')
  })

  it('INSERT 실패 시 ROLLBACK하고 throw하며 client를 release한다(부분 기록 0)', async () => {
    const m = makeMockPool()
    m.query.mockImplementation((sql: string) => {
      if (/INSERT INTO manager_outbox/i.test(sql)) return Promise.reject(new Error('boom'))
      if (/INSERT INTO wp_state_log/i.test(sql)) return Promise.resolve({ rows: [{ seq: '1' }] })
      return Promise.resolve({ rows: [] })
    })
    await expect(new DispatchStore(m.pool, () => 1).recordDispatch({
      workflowId: 'wf-1', wpId: 'wp-1', stepN: 0, fromState: 'DRAFTED',
    })).rejects.toThrow('boom')
    const verbs = m.query.mock.calls.map((c) => String(c[0]).trim().split(/\s+/)[0].toUpperCase())
    expect(verbs).toContain('ROLLBACK')
    expect(verbs).not.toContain('COMMIT')
    expect(m.release).toHaveBeenCalled()
  })

  it('ROLLBACK 자체가 실패해도 원본 오류를 보존해 throw한다(진단 마스킹 방지)', async () => {
    const m = makeMockPool()
    m.query.mockImplementation((sql: string) => {
      if (/INSERT INTO manager_events/i.test(sql)) return Promise.reject(new Error('original'))
      if (/ROLLBACK/i.test(sql)) return Promise.reject(new Error('rollback-failed'))
      return Promise.resolve({ rows: [] })
    })
    // 연결 손상으로 ROLLBACK이 reject해도, 호출자는 'rollback-failed'가 아닌 진짜 원인을 받아야 한다
    await expect(new DispatchStore(m.pool, () => 1).recordDispatch({
      workflowId: 'wf-1', wpId: 'wp-1', stepN: 0, fromState: 'DRAFTED',
    })).rejects.toThrow('original')
    expect(m.release).toHaveBeenCalled()
  })
})
