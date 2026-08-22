import { describe, it, expect, vi } from 'vitest'
import { LeaseStore } from './lease.repo.js'

/** UPDATE wp_leases는 RETURNING wp_id(leaseMiss면 0행), wp_state_log INSERT는 RETURNING seq. */
function makeTxPool(opts: { leaseMiss?: boolean } = {}) {
  const query = vi.fn().mockImplementation((sql: string) => {
    if (/UPDATE wp_leases/i.test(sql)) {
      return Promise.resolve({ rows: opts.leaseMiss ? [] : [{ wp_id: 'wp-1' }], rowCount: opts.leaseMiss ? 0 : 1 })
    }
    if (/INSERT INTO wp_state_log/i.test(sql)) return Promise.resolve({ rows: [{ seq: '42' }] })
    return Promise.resolve({ rows: [] })
  })
  const release = vi.fn()
  const client = { query, release }
  const connect = vi.fn().mockResolvedValue(client)
  return { pool: { connect } as never, client, query, release }
}
function selectPool(rows: unknown[]) {
  return { query: vi.fn().mockResolvedValue({ rows }) } as never
}
function callFor(query: ReturnType<typeof vi.fn>, re: RegExp) {
  return query.mock.calls.find((c) => re.test(String(c[0])))
}

describe('LeaseStore.expiredActiveLeases', () => {
  it("status='active' AND expires_at < now 를 조회하고 BIGINT→Number로 매핑한다", async () => {
    const pool = selectPool([
      { workflow_id: 'wf-1', wp_id: 'a', attempt: 0, owner: null, status: 'active', expires_at: '100', step_n: 2, event_id: 'e1' },
    ])
    const out = await new LeaseStore(pool).expiredActiveLeases(500)
    const [sql, params] = (pool as { query: ReturnType<typeof vi.fn> }).query.mock.calls[0]
    expect(sql).toMatch(/FROM wp_leases/i)
    expect(sql).toMatch(/status\s*=\s*\$1/i)
    expect(sql).toMatch(/expires_at\s*<\s*\$2/i)
    expect(params[0]).toBe('active')
    expect(params[1]).toBe(500)
    expect(out[0]).toEqual({
      workflowId: 'wf-1', wpId: 'a', attempt: 0, owner: null, status: 'active', expiresAt: 100, stepN: 2, eventId: 'e1',
    })
  })
})

describe('LeaseStore.recordReclaim', () => {
  it('단일 tx로 lease UPDATE(attempt=next·active) + wp.dispatched(attempt next) 적재 후 COMMIT', async () => {
    const m = makeTxPool()
    const res = await new LeaseStore(m.pool, () => 1000).recordReclaim({
      workflowId: 'wf-1', wpId: 'wp-1', nextAttempt: 1, stepN: 2, visibilityMs: 5000,
    })
    const verbs = m.query.mock.calls.map((c) => String(c[0]).trim().split(/\s+/)[0].toUpperCase())
    expect(verbs[0]).toBe('BEGIN')
    expect(verbs[verbs.length - 1]).toBe('COMMIT')

    const upd = callFor(m.query, /UPDATE wp_leases/i)!
    // 동시 sweep 직렬화: status='active' AND attempt CAS(재할당 전 attempt). nextAttempt 1 → expected 0
    expect(String(upd[0])).toMatch(/WHERE[\s\S]*status\s*=\s*\$\d[\s\S]*attempt\s*=\s*\$\d/i)
    expect(upd[1]).toContain('active')
    expect(upd[1]).toContain(0) // expectedAttempt = nextAttempt(1) - 1
    const ev = callFor(m.query, /INSERT INTO manager_events/i)![1] as unknown[]
    expect(ev[2]).toBe('wp.dispatched')
    expect(ev[6]).toBe('wf-1:wp-wp-1:1:wp.dispatched')  // 멱등키 nextAttempt·event_type 분리(§8)
    expect(JSON.parse(ev[3] as string)).toMatchObject({ wpId: 'wp-1', attempt: 1 })
    expect(res).toEqual({ status: 'reclaimed', eventId: expect.stringMatching(/[0-9a-f-]{36}/), seq: 42 })
  })

  it('lease가 이미 active가 아니면(UPDATE 0행) ROLLBACK하고 {status:skipped}', async () => {
    const m = makeTxPool({ leaseMiss: true })
    const res = await new LeaseStore(m.pool, () => 1).recordReclaim({
      workflowId: 'wf-1', wpId: 'wp-1', nextAttempt: 1, stepN: 0, visibilityMs: 5000,
    })
    expect(res).toEqual({ status: 'skipped' })
    const verbs = m.query.mock.calls.map((c) => String(c[0]).trim().split(/\s+/)[0].toUpperCase())
    expect(verbs).toContain('ROLLBACK')
    expect(callFor(m.query, /INSERT INTO manager_events/i)).toBeUndefined()
  })
})

describe('LeaseStore.recordEscalation', () => {
  it("단일 tx로 lease status='escalated' UPDATE + wp.escalated(ESCALATED 전이) 적재 후 COMMIT", async () => {
    const m = makeTxPool()
    const res = await new LeaseStore(m.pool, () => 1).recordEscalation({
      workflowId: 'wf-1', wpId: 'wp-1', attempt: 2, stepN: 0,
    })
    const upd = callFor(m.query, /UPDATE wp_leases/i)!
    expect(upd[1]).toContain('escalated')
    const ev = callFor(m.query, /INSERT INTO manager_events/i)![1] as unknown[]
    expect(ev[2]).toBe('wp.escalated')
    expect(ev[6]).toBe('wf-1:wp-wp-1:2:wp.escalated')  // 멱등키 attempt·event_type 분리(§8)
    const log = callFor(m.query, /INSERT INTO wp_state_log/i)![1] as unknown[]
    expect(log[3]).toBe('ESCALATED')                  // to_state
    expect(res).toMatchObject({ status: 'escalated', seq: 42 })
  })

  it('lease가 이미 active가 아니면 {status:skipped}', async () => {
    const m = makeTxPool({ leaseMiss: true })
    const res = await new LeaseStore(m.pool, () => 1).recordEscalation({
      workflowId: 'wf-1', wpId: 'wp-1', attempt: 2, stepN: 0,
    })
    expect(res).toEqual({ status: 'skipped' })
  })
})

describe('LeaseStore.recordCompletion', () => {
  it("단일 tx로 lease status='released' UPDATE(active 가드) + wp.completed(DISPATCHED→DONE) 적재 후 COMMIT", async () => {
    const m = makeTxPool()
    const res = await new LeaseStore(m.pool, () => 1).recordCompletion({
      workflowId: 'wf-1', wpId: 'wp-1', attempt: 1, stepN: 2,
    })
    const upd = callFor(m.query, /UPDATE wp_leases/i)!
    expect(upd[1]).toContain('released') // status='released'
    expect(upd[1]).toContain('active')   // WHERE status='active' 가드(동시 완료 직렬화)
    const ev = callFor(m.query, /INSERT INTO manager_events/i)![1] as unknown[]
    expect(ev[2]).toBe('wp.completed')
    expect(ev[6]).toBe('wf-1:wp-wp-1:1:wp.completed') // 멱등키 attempt·event_type 분리(§8)
    const log = callFor(m.query, /INSERT INTO wp_state_log/i)![1] as unknown[]
    expect(log[3]).toBe('DONE')          // to_state
    expect(res).toMatchObject({ status: 'completed', seq: 42 })
  })

  it('lease가 active가 아니면(이미 완료·released 등) {status:skipped}', async () => {
    const m = makeTxPool({ leaseMiss: true })
    const res = await new LeaseStore(m.pool, () => 1).recordCompletion({
      workflowId: 'wf-1', wpId: 'wp-1', attempt: 1, stepN: 0,
    })
    expect(res).toEqual({ status: 'skipped' })
  })

  it('INSERT 실패 시 ROLLBACK·throw하고 원본 오류를 보존한다(공통 transition 가드)', async () => {
    const m = makeTxPool()
    m.query.mockImplementation((sql: string) => {
      if (/UPDATE wp_leases/i.test(sql)) return Promise.resolve({ rows: [{ wp_id: 'wp-1' }] })
      if (/INSERT INTO manager_events/i.test(sql)) return Promise.reject(new Error('original'))
      if (/ROLLBACK/i.test(sql)) return Promise.reject(new Error('rollback-failed'))
      return Promise.resolve({ rows: [] })
    })
    await expect(new LeaseStore(m.pool, () => 1).recordCompletion({
      workflowId: 'wf-1', wpId: 'wp-1', attempt: 1, stepN: 0,
    })).rejects.toThrow('original')
    expect(m.release).toHaveBeenCalled()
  })
})

/** renewLease는 단일 pool.query(tx 아님) — rowCount만 돌려주는 mock. */
function renewPool(rowCount: number) {
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount })
  return { pool: { query } as never, query }
}

describe('LeaseStore.renewLease — 하트비트(가시성 연장·attempt CAS·outbox 미적재)', () => {
  it('status=active AND attempt CAS로 expires_at=now+visibilityMs UPDATE·1행이면 true·events/outbox 미적재', async () => {
    const m = renewPool(1)
    const ok = await new LeaseStore(m.pool, () => 1000).renewLease('wf-1', 'wp-1', 2, 5000)
    expect(ok).toBe(true)
    const [sql, params] = m.query.mock.calls[0]
    expect(String(sql)).toMatch(/UPDATE wp_leases SET expires_at/i)
    expect(String(sql)).toMatch(/status\s*=\s*\$4[\s\S]*attempt\s*=\s*\$5/i)  // 동시성: active + attempt CAS
    expect(params[0]).toBe(6000)   // now(1000) + visibilityMs(5000)
    expect(params[3]).toBe('active')
    expect(params[4]).toBe(2)      // expectedAttempt
    expect(m.query.mock.calls).toHaveLength(1)  // 가시성 연장만 — 전이/이벤트 적재 없음
  })

  it('0행(lease 부재·attempt 불일치·비active)이면 false', async () => {
    const m = renewPool(0)
    expect(await new LeaseStore(m.pool, () => 1).renewLease('wf', 'wp', 0, 1000)).toBe(false)
  })
})

describe('LeaseStore.transition — 데드락 재시도', () => {
  /** wp_state_log INSERT에서 n회 40P01을 터뜨리고 그 뒤는 정상 동작하는 pool. */
  function deadlockingPool(times: number) {
    let left = times
    const query = vi.fn().mockImplementation((sql: string) => {
      if (/INSERT INTO wp_state_log/i.test(sql)) {
        if (left > 0) {
          left -= 1
          return Promise.reject(Object.assign(new Error('deadlock detected'), { code: '40P01' }))
        }
        return Promise.resolve({ rows: [{ seq: '42' }] })
      }
      if (/UPDATE wp_leases/i.test(sql)) {
        return Promise.resolve({ rows: [{ wp_id: 'wp-1', tenant_id: null }], rowCount: 1 })
      }
      return Promise.resolve({ rows: [] })
    })
    const release = vi.fn()
    const connect = vi.fn().mockResolvedValue({ query, release })
    return { pool: { connect } as never, query, connect, release }
  }

  const COMPLETE = { workflowId: 'wf-1', wpId: 'wp-1', attempt: 0, stepN: 1 }
  const verbs = (q: ReturnType<typeof vi.fn>) => q.mock.calls.map((c) => String(c[0]))

  it('40P01 1회 후 재시도해 성공한다 — connect가 2회(트랜잭션 전체 재실행)', async () => {
    const m = deadlockingPool(1)
    const res = await new LeaseStore(m.pool).recordCompletion(COMPLETE)

    expect(res.status).toBe('completed')
    expect(m.connect).toHaveBeenCalledTimes(2)
    expect(verbs(m.query)).toContain('COMMIT')
  })

  it('재시도 전에 ROLLBACK하고 연결을 반납한다 — 손상 연결 누수 금지', async () => {
    const m = deadlockingPool(1)
    await new LeaseStore(m.pool).recordCompletion(COMPLETE)

    expect(verbs(m.query).filter((v) => v === 'ROLLBACK')).toHaveLength(1)
    expect(m.release).toHaveBeenCalledTimes(2)
  })

  it('40P01이 상한을 넘으면 그대로 던진다 — 무한 재시도 금지', async () => {
    const m = deadlockingPool(99)
    await expect(new LeaseStore(m.pool).recordCompletion(COMPLETE)).rejects.toThrow('deadlock detected')
  })

  it('40P01이 아닌 오류는 재시도하지 않는다', async () => {
    const query = vi.fn().mockImplementation((sql: string) => {
      if (/UPDATE wp_leases/i.test(sql)) return Promise.resolve({ rows: [{ wp_id: 'wp-1', tenant_id: null }], rowCount: 1 })
      if (/INSERT INTO wp_state_log/i.test(sql)) return Promise.reject(Object.assign(new Error('syntax error'), { code: '42601' }))
      return Promise.resolve({ rows: [] })
    })
    const connect = vi.fn().mockResolvedValue({ query, release: vi.fn() })

    await expect(new LeaseStore({ connect } as never).recordCompletion(COMPLETE)).rejects.toThrow('syntax error')
    expect(connect).toHaveBeenCalledTimes(1)
  })
})
