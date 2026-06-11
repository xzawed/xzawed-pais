import { describe, it, expect, vi } from 'vitest'
import { DispatchStore, appendWpEvent, wpEnvelope } from './dispatch.repo.js'

/** lease INSERT은 RETURNING wp_id, wp_state_log INSERT은 RETURNING seq를 돌려주는 mock. leaseConflict면 lease 0행. */
function makeMockPool(opts: { leaseConflict?: boolean } = {}) {
  const query = vi.fn().mockImplementation((sql: string) => {
    if (/INSERT INTO wp_leases/i.test(sql)) {
      return Promise.resolve({ rows: opts.leaseConflict ? [] : [{ wp_id: 'wp-1' }], rowCount: opts.leaseConflict ? 0 : 1 })
    }
    if (/INSERT INTO wp_state_log/i.test(sql)) return Promise.resolve({ rows: [{ seq: '42' }] })
    return Promise.resolve({ rows: [] })
  })
  const release = vi.fn()
  const client = { query, release }
  const connect = vi.fn().mockResolvedValue(client)
  return { pool: { connect } as never, client, query, release, connect }
}

function callFor(query: ReturnType<typeof vi.fn>, re: RegExp) {
  return query.mock.calls.find((c) => re.test(String(c[0])))
}

const base = { workflowId: 'wf-1', wpId: 'wp-1', stepN: 3, fromState: 'DRAFTED', visibilityMs: 5000 }

describe('DispatchStore.recordDispatch (P1d-5a: lease + WP 고정 멱등키)', () => {
  it('단일 tx로 wp_leases + manager_events + wp_state_log + manager_outbox를 INSERT하고 COMMIT한다', async () => {
    const m = makeMockPool()
    const res = await new DispatchStore(m.pool, () => 1000).recordDispatch(base)

    const verbs = m.query.mock.calls.map((c) => String(c[0]).trim().split(/\s+/)[0].toUpperCase())
    expect(verbs[0]).toBe('BEGIN')
    expect(verbs[verbs.length - 1]).toBe('COMMIT')
    const inserts = m.query.mock.calls.filter((c) =>
      /INSERT INTO (wp_leases|manager_events|wp_state_log|manager_outbox)/i.test(String(c[0])))
    expect(inserts).toHaveLength(4)
    expect(res).toEqual({ status: 'recorded', eventId: expect.stringMatching(/[0-9a-f-]{36}/), seq: 42 })
    expect(m.release).toHaveBeenCalled()
  })

  it('멱등키를 WP id에 고정한다(§8 #1): {wf}:wp-${wpId}:${attempt}', async () => {
    const m = makeMockPool()
    await new DispatchStore(m.pool, () => 1000).recordDispatch(base)
    const ev = callFor(m.query, /INSERT INTO manager_events/i)![1] as unknown[]
    expect(ev[6]).toBe('wf-1:wp-wp-1:0:wp.dispatched')  // idempotency_key (attempt 0·event_type 분리 §8)
    expect(JSON.parse(ev[3] as string)).toEqual({ wpId: 'wp-1', stepN: 3, attempt: 0 })
  })

  it('attempt를 멱등키·payload·lease에 반영한다', async () => {
    const m = makeMockPool()
    await new DispatchStore(m.pool, () => 1000).recordDispatch({ ...base, attempt: 2 })
    const ev = callFor(m.query, /INSERT INTO manager_events/i)![1] as unknown[]
    expect(ev[6]).toBe('wf-1:wp-wp-1:2:wp.dispatched')
    expect(JSON.parse(ev[3] as string)).toMatchObject({ attempt: 2 })
    const lease = callFor(m.query, /INSERT INTO wp_leases/i)![1] as unknown[]
    expect(lease[2]).toBe(2)                        // attempt
  })

  it('wp_leases를 ON CONFLICT DO NOTHING으로 획득하고 expires_at=occurredAt+visibilityMs·event_id 공유', async () => {
    const m = makeMockPool()
    await new DispatchStore(m.pool, () => 1000).recordDispatch(base)
    const leaseCall = callFor(m.query, /INSERT INTO wp_leases/i)!
    expect(String(leaseCall[0])).toMatch(/ON CONFLICT \(workflow_id, wp_id\) DO NOTHING/i)
    const lease = leaseCall[1] as unknown[]
    // [workflow_id, wp_id, attempt, owner, status, expires_at, step_n, event_id]
    expect(lease[0]).toBe('wf-1')
    expect(lease[1]).toBe('wp-1')
    expect(lease[3]).toBeNull()                     // owner 기본 null
    expect(lease[4]).toBe('active')                 // status
    expect(lease[5]).toBe(6000)                     // expires_at = 1000 + 5000
    expect(lease[6]).toBe(3)                        // step_n
    const eventId = (callFor(m.query, /INSERT INTO manager_events/i)![1] as unknown[])[0]
    expect(lease[7]).toBe(eventId)                  // lease.event_id = dispatch event_id
  })

  it('event_id를 events·wp_state_log·outbox가 공유하고 occurred_at은 봉투 시각', async () => {
    const m = makeMockPool()
    await new DispatchStore(m.pool, () => 7777).recordDispatch(base)
    const ev = callFor(m.query, /INSERT INTO manager_events/i)![1] as unknown[]
    const log = callFor(m.query, /INSERT INTO wp_state_log/i)![1] as unknown[]
    const ob = callFor(m.query, /INSERT INTO manager_outbox/i)![1] as unknown[]
    expect(log[4]).toBe(ev[0])
    expect(ob[0]).toBe(ev[0])
    expect(ev[8]).toBe(7777)
    expect(log[6]).toBe(7777)
  })

  it('wp_state_log에 DRAFTED→DISPATCHED 전이, manager_outbox에 manager:events 스트림·메시지', async () => {
    const m = makeMockPool()
    await new DispatchStore(m.pool, () => 1).recordDispatch(base)
    const log = callFor(m.query, /INSERT INTO wp_state_log/i)![1] as unknown[]
    expect(log[2]).toBe('DRAFTED')
    expect(log[3]).toBe('DISPATCHED')
    const ob = callFor(m.query, /INSERT INTO manager_outbox/i)![1] as unknown[]
    expect(ob[1]).toBe('manager:events:wf-1')
    const msg = JSON.parse(ob[2] as string)
    expect(msg.type).toBe('wp.dispatched')
    expect(msg.envelope.idempotencyKey).toBe('wf-1:wp-wp-1:0:wp.dispatched')
  })

  it('이미 lease가 있으면(ON CONFLICT 0행) ROLLBACK하고 {status:deduped} 반환·이벤트 미적재(§8 #2)', async () => {
    const m = makeMockPool({ leaseConflict: true })
    const res = await new DispatchStore(m.pool, () => 1).recordDispatch(base)
    expect(res).toEqual({ status: 'deduped' })
    const verbs = m.query.mock.calls.map((c) => String(c[0]).trim().split(/\s+/)[0].toUpperCase())
    expect(verbs).toContain('ROLLBACK')
    expect(verbs).not.toContain('COMMIT')
    expect(callFor(m.query, /INSERT INTO manager_events/i)).toBeUndefined() // 이벤트 미적재
    expect(m.release).toHaveBeenCalled()
  })

  it('toState override·reason을 반영한다', async () => {
    const m = makeMockPool()
    await new DispatchStore(m.pool, () => 1).recordDispatch({ ...base, toState: 'IN_PROGRESS', reason: 'manual' })
    const log = callFor(m.query, /INSERT INTO wp_state_log/i)![1] as unknown[]
    expect(log[3]).toBe('IN_PROGRESS')
    expect(log[5]).toBe('manual')
  })

  it('INSERT 실패 시 ROLLBACK하고 throw하며 client를 release한다', async () => {
    const m = makeMockPool()
    m.query.mockImplementation((sql: string) => {
      if (/INSERT INTO manager_outbox/i.test(sql)) return Promise.reject(new Error('boom'))
      if (/INSERT INTO wp_leases/i.test(sql)) return Promise.resolve({ rows: [{ wp_id: 'wp-1' }] })
      if (/INSERT INTO wp_state_log/i.test(sql)) return Promise.resolve({ rows: [{ seq: '1' }] })
      return Promise.resolve({ rows: [] })
    })
    await expect(new DispatchStore(m.pool, () => 1).recordDispatch(base)).rejects.toThrow('boom')
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
      if (/INSERT INTO wp_leases/i.test(sql)) return Promise.resolve({ rows: [{ wp_id: 'wp-1' }] })
      return Promise.resolve({ rows: [] })
    })
    await expect(new DispatchStore(m.pool, () => 1).recordDispatch(base)).rejects.toThrow('original')
    expect(m.release).toHaveBeenCalled()
  })
})

/** manager_events idempotency_key(params[6])와 outbox 봉투 키를 캡처하는 mock client(appendWpEvent 단위 검증). */
function captureClient() {
  const keys: string[] = []
  const envKeys: string[] = []
  const query = vi.fn().mockImplementation((sql: string, params: unknown[]) => {
    if (/INSERT INTO manager_events/i.test(sql)) keys.push(params[6] as string)
    if (/INSERT INTO wp_state_log/i.test(sql)) return Promise.resolve({ rows: [{ seq: '1' }] })
    if (/INSERT INTO manager_outbox/i.test(sql)) envKeys.push(JSON.parse(params[2] as string).envelope.idempotencyKey)
    return Promise.resolve({ rows: [] })
  })
  return { client: { query } as never, keys, envKeys }
}

describe('appendWpEvent — 멱등키 event_type 분리(§8 생명주기 충돌 방지)', () => {
  it('같은 (wf,wp,attempt)라도 dispatched·completed가 분리된 멱등키를 받는다 — 키 충돌 dedup 유실 방지', async () => {
    const c = captureClient()
    const append = (eventType: string, fromState: string, toState: string) =>
      appendWpEvent(c.client, wpEnvelope('wf', 'a', 0, 1), { workflowId: 'wf', wpId: 'a', attempt: 0, stepN: 0, eventType, fromState, toState })
    await append('wp.dispatched', 'DRAFTED', 'DISPATCHED')
    await append('wp.completed', 'DISPATCHED', 'DONE')
    expect(c.keys).toEqual(['wf:wp-a:0:wp.dispatched', 'wf:wp-a:0:wp.completed'])
    expect(c.keys[0]).not.toBe(c.keys[1])            // 핵심: 같은 attempt라도 충돌 없음
    expect(c.envKeys).toEqual(c.keys)                 // 아웃박스 봉투 키도 event_type 반영(소비자 dedup 정합)
  })
})
