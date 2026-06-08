import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createPool, runMigrations, closePool } from '../src/db/pool.js'
import { DispatchStore } from '../src/db/dispatch.repo.js'
import { LeaseStore } from '../src/db/lease.repo.js'
import { handleLeaseSweep } from '../src/streams/lease.js'
import type { Pool } from 'pg'

const url = process.env['DATABASE_URL']
const d = url ? describe : describe.skip

d('lease sweep 통합 (pg)', () => {
  let pool: Pool
  const cleanup = async (p: Pool) => {
    await p.query("DELETE FROM manager_outbox WHERE stream LIKE 'manager:events:wf-lease-%'")
    await p.query("DELETE FROM manager_events WHERE session_id LIKE 'wf-lease-%'")
    await p.query("DELETE FROM wp_state_log WHERE workflow_id LIKE 'wf-lease-%'")
    await p.query("DELETE FROM wp_leases WHERE workflow_id LIKE 'wf-lease-%'")
  }
  beforeAll(async () => {
    pool = createPool(url!)
    await runMigrations(pool)
    await cleanup(pool)
  })
  afterAll(async () => {
    await cleanup(pool)
    await closePool()
  })

  const expireAll = (wfId: string) => pool.query("UPDATE wp_leases SET expires_at = 0 WHERE workflow_id = $1", [wfId])

  it('만료 lease를 attempt++로 reclaim하고 상한 초과 시 escalate한다', async () => {
    const wfId = `wf-lease-${Date.now()}-a`
    const dispatchStore = new DispatchStore(pool)
    const leaseStore = new LeaseStore(pool)
    const cfg = { store: leaseStore, maxAttempts: 2, visibilityMs: 5000 }

    // 디스패치 → attempt 0 active lease
    await dispatchStore.recordDispatch({ workflowId: wfId, wpId: 'a', stepN: 0, fromState: 'DRAFTED', visibilityMs: 5000 })
    expect((await leaseStore.getLease(wfId, 'a'))?.attempt).toBe(0)

    // sweep 1: 만료 → nextAttempt 1 < 2 → reclaim (전역 sweep이라 wfId로 필터)
    await expireAll(wfId)
    const s1 = await handleLeaseSweep(1000, cfg)
    expect(s1.reclaimed.some((r) => r.workflowId === wfId && r.wpId === 'a')).toBe(true)
    expect(s1.escalated.some((r) => r.workflowId === wfId)).toBe(false)
    const l1 = await leaseStore.getLease(wfId, 'a')
    expect(l1?.attempt).toBe(1)
    expect(l1?.status).toBe('active')

    // sweep 2: 재만료 → nextAttempt 2 == maxAttempts → escalate
    await expireAll(wfId)
    const s2 = await handleLeaseSweep(2000, cfg)
    expect(s2.escalated.some((r) => r.workflowId === wfId && r.wpId === 'a')).toBe(true)
    expect(s2.reclaimed.some((r) => r.workflowId === wfId)).toBe(false)
    expect((await leaseStore.getLease(wfId, 'a'))?.status).toBe('escalated')

    // 이벤트: wp.dispatched ×2(attempt 0·1 reclaim) + wp.escalated ×1
    const disp = await pool.query(
      "SELECT seq FROM manager_events WHERE session_id = $1 AND event_type = 'wp.dispatched'", [wfId])
    expect(disp.rows).toHaveLength(2)
    const esc = await pool.query(
      "SELECT seq FROM manager_events WHERE session_id = $1 AND event_type = 'wp.escalated'", [wfId])
    expect(esc.rows).toHaveLength(1)

    // 최신 전이 ESCALATED
    const last = await pool.query(
      "SELECT to_state FROM wp_state_log WHERE workflow_id = $1 AND wp_id = 'a' ORDER BY seq DESC LIMIT 1", [wfId])
    expect(last.rows[0]?.to_state).toBe('ESCALATED')

    // escalated lease는 active가 아니라 다음 sweep 제외(재escalate 없음). 전역 sweep이라 wfId로 스코프.
    await expireAll(wfId)
    const s3 = await handleLeaseSweep(3000, cfg)
    expect(s3.reclaimed.some((r) => r.workflowId === wfId)).toBe(false)
    expect(s3.escalated.some((r) => r.workflowId === wfId)).toBe(false)
  })

  it('동시 reclaim은 attempt CAS로 직렬화된다 — 두 번째는 skipped(중복 wp.dispatched 0)', async () => {
    const wfId = `wf-lease-${Date.now()}-c`
    const dispatchStore = new DispatchStore(pool)
    const leaseStore = new LeaseStore(pool)
    await dispatchStore.recordDispatch({ workflowId: wfId, wpId: 'a', stepN: 0, fromState: 'DRAFTED', visibilityMs: 5000 })
    await expireAll(wfId)

    // 같은 nextAttempt=1로 두 번 reclaim(경쟁 시뮬레이션) — CAS(attempt 기대 0)로 두 번째는 0행 skip
    const reclaim = { workflowId: wfId, wpId: 'a', nextAttempt: 1, stepN: 0, visibilityMs: 5000 }
    const r1 = await leaseStore.recordReclaim(reclaim)
    const r2 = await leaseStore.recordReclaim(reclaim)
    expect(r1.status).toBe('reclaimed')
    expect(r2.status).toBe('skipped')
    expect((await leaseStore.getLease(wfId, 'a'))?.attempt).toBe(1) // 1회만 증가

    // 이벤트: 최초 dispatch(attempt 0) + reclaim 1회(attempt 1) = 2건, 중복 없음
    const disp = await pool.query(
      "SELECT seq FROM manager_events WHERE session_id = $1 AND event_type = 'wp.dispatched'", [wfId])
    expect(disp.rows).toHaveLength(2)
  })

  it('만료되지 않은 lease는 sweep 대상이 아니다', async () => {
    const wfId = `wf-lease-${Date.now()}-b`
    const dispatchStore = new DispatchStore(pool)
    const leaseStore = new LeaseStore(pool)
    await dispatchStore.recordDispatch({ workflowId: wfId, wpId: 'a', stepN: 0, fromState: 'DRAFTED', visibilityMs: 1_000_000 })
    const out = await handleLeaseSweep(1000, { store: leaseStore, maxAttempts: 2, visibilityMs: 5000 })
    // expires_at = occurredAt(now) + 1e6 → 미래라 미만료
    expect(out.reclaimed.find((r) => r.wpId === 'a')).toBeUndefined()
  })
})
