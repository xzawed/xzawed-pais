import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createPool, runMigrations, closePool } from '../src/db/pool.js'
import { TaskGraphRepo } from '../src/db/task-graph.repo.js'
import { DispatchStore } from '../src/db/dispatch.repo.js'
import { LeaseStore } from '../src/db/lease.repo.js'
import { handleDispatch } from '../src/streams/dispatch.js'
import { handleCompletion } from '../src/streams/completion.js'
import type { WorkPackage } from '@xzawed/agent-streams'
import type { Pool } from 'pg'

const url = process.env['DATABASE_URL']
const d = url ? describe : describe.skip

const wp = (id: string, deps: string[] = []): WorkPackage => ({
  id, storyId: 'story-1', owningRole: 'developer', oracleRef: 'oracle-1',
  acceptanceCriteria: [], dependencies: deps, attributionCounters: {}, status: 'draft',
})

d('완료 흐름 통합 (pg)', () => {
  let pool: Pool
  const cleanup = async (p: Pool) => {
    await p.query("DELETE FROM manager_outbox WHERE stream LIKE 'manager:events:wf-comp-%'")
    await p.query("DELETE FROM manager_events WHERE session_id LIKE 'wf-comp-%'")
    await p.query("DELETE FROM wp_state_log WHERE workflow_id LIKE 'wf-comp-%'")
    await p.query("DELETE FROM wp_leases WHERE workflow_id LIKE 'wf-comp-%'")
    await p.query("DELETE FROM task_graphs WHERE workflow_id LIKE 'wf-comp-%'")
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

  it('완료 시 lease release·DISPATCHED→DONE 전이·후행 unblock 재디스패치', async () => {
    const wfId = `wf-comp-${Date.now()}-a`
    const repo = new TaskGraphRepo(pool)
    const leaseStore = new LeaseStore(pool)
    const dispatch = { repo, store: new DispatchStore(pool) }
    await repo.upsertGraph({ workflowId: wfId, workPackages: [wp('a'), wp('b', ['a'])] })

    // 초기 디스패치: 루트 a만(b는 a 미완)
    const d1 = await handleDispatch(wfId, dispatch)
    expect(d1.dispatched.map((x) => x.wpId)).toEqual(['a'])

    // a 완료 → lease released·a DONE·b 재디스패치
    const out = await handleCompletion(wfId, 'a', { leaseStore, dispatch })
    expect(out.status).toBe('completed')
    expect(out.dispatched.map((x) => x.wpId)).toEqual(['b'])

    expect((await leaseStore.getLease(wfId, 'a'))?.status).toBe('released')
    expect((await leaseStore.getLease(wfId, 'b'))?.status).toBe('active')

    const aLast = await pool.query(
      "SELECT to_state FROM wp_state_log WHERE workflow_id = $1 AND wp_id = 'a' ORDER BY seq DESC LIMIT 1", [wfId])
    expect(aLast.rows[0]?.to_state).toBe('DONE')
    const bDisp = await pool.query(
      "SELECT seq FROM manager_events WHERE session_id = $1 AND event_type = 'wp.dispatched' AND payload->>'wpId' = 'b'", [wfId])
    expect(bDisp.rows).toHaveLength(1)

    // 재완료(이미 released) → skip·중복 없음
    const out2 = await handleCompletion(wfId, 'a', { leaseStore, dispatch })
    expect(out2.status).toBe('skipped')
    const aDone = await pool.query(
      "SELECT seq FROM manager_events WHERE session_id = $1 AND event_type = 'wp.completed'", [wfId])
    expect(aDone.rows).toHaveLength(1)
  })
})
