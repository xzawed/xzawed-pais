import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Pool } from 'pg'
import { createPool, runMigrations, closePool } from '../src/db/pool.js'
import { DecisionRepo } from '../src/db/decision.repo.js'
import { TaskGraphRepo } from '../src/db/task-graph.repo.js'
import { DispatchStore } from '../src/db/dispatch.repo.js'
import { handleDispatch, type DispatchDeps } from '../src/streams/dispatch.js'
import { makeDegradedDispatchBrief } from '../src/streams/degraded-signoff-brief.js'
import { DISPATCHED_STATE } from '../src/streams/dispatch-constants.js'
import type { OperationalMode, WorkPackage } from '@xzawed/agent-streams'

const url = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL']

function highWp(id: string): WorkPackage {
  return {
    id, storyId: 's1', epicId: null, owningRole: 'developer', inputs: [], outputs: [],
    oracleRef: 'oracle-1', acceptanceCriteria: ['x'], dependencies: [],
    risk: 'HIGH', attributionCounters: { impl: 0, task: 0, plan: 0 }, status: 'draft',
  } as WorkPackage
}

// N2 — hasApprovedDegradedDispatch 내구 조회. DB URL 없으면 skip. prefix 'wf-ds-' 정리.
describe.skipIf(!url)('N2 degraded signoff (integration)', () => {
  let pool: Pool

  beforeAll(async () => {
    pool = createPool(url!)
    await runMigrations(pool)
  })

  afterAll(async () => {
    for (const t of ['sign_offs', 'human_decisions']) {
      await pool.query(`DELETE FROM ${t} WHERE decision_id LIKE 'ds-%' OR request_id LIKE 'wf-ds-%'`).catch(() => undefined)
    }
    await pool.query("DELETE FROM decision_requests WHERE workflow_id LIKE 'wf-ds-%'").catch(() => undefined)
    await pool.query("DELETE FROM manager_outbox WHERE message::text LIKE '%wf-ds-%'").catch(() => undefined)
    await pool.query("DELETE FROM manager_events WHERE session_id LIKE 'wf-ds-%'").catch(() => undefined)
    for (const t of ['manager_outbox', 'wp_leases', 'wp_state_log', 'task_graphs']) {
      const col = t === 'manager_outbox' ? "message::text LIKE '%wf-ds-%'" : "workflow_id LIKE 'wf-ds-%'"
      await pool.query(`DELETE FROM ${t} WHERE ${col}`).catch(() => undefined)
    }
    await closePool()
  })

  it('미승인 false → accept_known+signoff 후 true·다른 wpId 격리', async () => {
    const repo = new DecisionRepo(pool)
    const wf = `wf-ds-${Date.now()}`
    const reqId = `${wf}:degraded:wp-a`
    await repo.createRequest({ requestId: reqId, type: 'degraded_dispatch', workflowId: wf, correlationId: wf, wpId: 'wp-a' })

    // before: 미승인.
    expect(await repo.hasApprovedDegradedDispatch(wf, 'wp-a')).toBe(false)

    // accept_known 결정 + 사인오프(scope degraded_dispatch).
    await repo.recordDecision({ decisionId: `ds-${wf}`, requestId: reqId, decidedBy: 'alice', choice: 'accept_known' })
    await repo.recordSignOff({ signoffId: `ds-${wf}:signoff`, decisionId: `ds-${wf}`, scope: 'degraded_dispatch', approver: 'alice', risk: 'HIGH' })

    // after: 승인.
    expect(await repo.hasApprovedDegradedDispatch(wf, 'wp-a')).toBe(true)
    // 다른 wpId는 격리(false).
    expect(await repo.hasApprovedDegradedDispatch(wf, 'wp-b')).toBe(false)
  })

  it('DEGRADED+HIGH-risk held → accept_known signoff → redispatch → DISPATCHED', async () => {
    const decisionRepo = new DecisionRepo(pool)
    const graphRepo = new TaskGraphRepo(pool)
    const store = new DispatchStore(pool)
    const wf = `wf-ds-${Date.now()}-loop`
    await graphRepo.upsertGraph({ workflowId: wf, workPackages: [highWp('a')] })

    const deps: DispatchDeps = {
      repo: graphRepo, store, getMode: (): OperationalMode => 'DEGRADED',
      isHighRiskDispatchApproved: (w, wp) => decisionRepo.hasApprovedDegradedDispatch(w, wp),
      onDegradedHighRisk: makeDegradedDispatchBrief(decisionRepo),
    }

    // 1) DEGRADED + HIGH-risk → 보류(디스패치 0·DecisionRequest 생성).
    const held = await handleDispatch(wf, deps)
    expect(held.dispatched).toEqual([])
    expect((await graphRepo.latestStates(wf)).has('a')).toBe(false) // 전이 0
    const reqId = `${wf}:degraded:a`
    expect(await decisionRepo.getRequest(reqId)).not.toBeNull()

    // 2) 사람 accept_known + 사인오프(scope degraded_dispatch).
    await decisionRepo.recordDecision({ decisionId: `ds-${wf}`, requestId: reqId, decidedBy: 'alice', choice: 'accept_known' })
    await decisionRepo.recordSignOff({ signoffId: `ds-${wf}:signoff`, decisionId: `ds-${wf}`, scope: 'degraded_dispatch', approver: 'alice', risk: 'HIGH' })
    expect(await decisionRepo.hasApprovedDegradedDispatch(wf, 'a')).toBe(true)

    // 3) 재디스패치(여전히 DEGRADED·이제 승인됨) → DISPATCHED.
    const re = await handleDispatch(wf, deps)
    expect(re.dispatched).toHaveLength(1)
    expect((await graphRepo.latestStates(wf)).get('a')?.toState).toBe(DISPATCHED_STATE)
  })
})
