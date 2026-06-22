import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Pool } from 'pg'
import { createPool, runMigrations, closePool } from '../src/db/pool.js'
import { TaskGraphRepo } from '../src/db/task-graph.repo.js'
import { DispatchStore } from '../src/db/dispatch.repo.js'
import { handleDispatch, type DispatchDeps } from '../src/streams/dispatch.js'
import { drainHeld } from '../src/streams/supervisor.js'
import { DISPATCHED_STATE } from '../src/streams/dispatch-constants.js'
import type { OperationalMode, WorkPackage } from '@xzawed/agent-streams'

const url = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL']

/** ready WP(oracleRef 비-null → 기본 술어 충족·no deps). */
function wp(id: string): WorkPackage {
  return {
    id, storyId: 's1', epicId: null, owningRole: 'developer', inputs: [], outputs: [],
    oracleRef: 'oracle-1', acceptanceCriteria: ['x'], dependencies: [],
    risk: 'MEDIUM', attributionCounters: { impl: 0, task: 0, plan: 0 }, status: 'draft',
  } as WorkPackage
}

// P5-3b E2E — SAFE held → 모드 복귀 + resume → DISPATCHED 전이 실증. DB URL 없으면 skip. prefix 'wf-de-' 정리.
describe.skipIf(!url)('P5-3b degraded enforce (integration)', () => {
  let pool: Pool

  beforeAll(async () => {
    pool = createPool(url!)
    await runMigrations(pool)
  })

  afterAll(async () => {
    for (const t of ['manager_outbox', 'wp_leases', 'wp_state_log', 'task_graphs']) {
      const col = t === 'manager_outbox' ? "message::text LIKE '%wf-de-%'" : "workflow_id LIKE 'wf-de-%'"
      await pool.query(`DELETE FROM ${t} WHERE ${col}`).catch(() => undefined)
    }
    await pool.query("DELETE FROM manager_events WHERE session_id LIKE 'wf-de-%'").catch(() => undefined)
    await closePool()
  })

  it('SAFE→held(전이 0)→복귀 resume→DISPATCHED', async () => {
    const repo = new TaskGraphRepo(pool)
    const store = new DispatchStore(pool)
    const wf = `wf-de-${Date.now()}`
    await repo.upsertGraph({ workflowId: wf, workPackages: [wp('a')] })

    // 1) SAFE → held(디스패치 0·전이 0·held-set 적재).
    const held = new Set<string>()
    const safeDeps: DispatchDeps = { repo, store, getMode: (): OperationalMode => 'SAFE', onHeld: (w) => held.add(w) }
    const heldOut = await handleDispatch(wf, safeDeps)
    expect(heldOut.status).toBe('held')
    expect(heldOut.dispatched).toEqual([])
    expect(held.has(wf)).toBe(true)
    const afterHeld = await repo.latestStates(wf)
    expect(afterHeld.has('a')).toBe(false) // 전이 0(DRAFTED 유지)

    // 2) 모드 복귀(NORMAL) + resume(drainHeld) → DISPATCHED 전이.
    const normalDeps: DispatchDeps = { repo, store, getMode: (): OperationalMode => 'NORMAL' }
    await drainHeld(held, async (w) => { await handleDispatch(w, normalDeps) })
    expect(held.size).toBe(0)
    const afterResume = await repo.latestStates(wf)
    expect(afterResume.get('a')?.toState).toBe(DISPATCHED_STATE)
  })
})
