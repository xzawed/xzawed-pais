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
    expect(ev[6]).toBe('wf-1:wp-wp-1:1')              // 멱등키 nextAttempt
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

  it('INSERT 실패 시 ROLLBACK·throw하고 원본 오류를 보존한다', async () => {
    const m = makeTxPool()
    m.query.mockImplementation((sql: string) => {
      if (/UPDATE wp_leases/i.test(sql)) return Promise.resolve({ rows: [{ wp_id: 'wp-1' }] })
      if (/INSERT INTO manager_events/i.test(sql)) return Promise.reject(new Error('original'))
      if (/ROLLBACK/i.test(sql)) return Promise.reject(new Error('rollback-failed'))
      return Promise.resolve({ rows: [] })
    })
    await expect(new LeaseStore(m.pool, () => 1).recordEscalation({
      workflowId: 'wf-1', wpId: 'wp-1', attempt: 2, stepN: 0,
    })).rejects.toThrow('original')
    expect(m.release).toHaveBeenCalled()
  })
})
