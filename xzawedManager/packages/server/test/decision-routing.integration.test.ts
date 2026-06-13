import { describe, it, expect } from 'vitest'
import { createPool, runMigrations, closePool } from '../src/db/pool.js'
import { TaskGraphRepo } from '../src/db/task-graph.repo.js'
import { DispatchStore } from '../src/db/dispatch.repo.js'
import { LeaseStore } from '../src/db/lease.repo.js'
import type { WorkPackage } from '@xzawed/agent-streams'

// CI(turborepo 잡)는 TEST_DATABASE_URL을 주입 — 게이트 통일(형제 통합 테스트 패턴)
const url = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL']

/** 'wf-dr-%' prefix 스코프 정리 — 잔여 행 누적·형제 통합 테스트와의 병렬 간섭 방지(FK 순서: outbox→events). */
async function cleanup(pool: import('pg').Pool): Promise<void> {
  await pool.query("DELETE FROM manager_outbox WHERE event_id IN (SELECT event_id FROM manager_events WHERE session_id LIKE 'wf-dr-%')").catch(() => undefined)
  await pool.query("DELETE FROM manager_events WHERE session_id LIKE 'wf-dr-%'").catch(() => undefined)
  await pool.query("DELETE FROM wp_state_log WHERE workflow_id LIKE 'wf-dr-%'").catch(() => undefined)
  await pool.query("DELETE FROM wp_leases WHERE workflow_id LIKE 'wf-dr-%'").catch(() => undefined)
  await pool.query("DELETE FROM task_graphs WHERE workflow_id LIKE 'wf-dr-%'").catch(() => undefined)
}

/** dispatch→escalate로 escalated lease를 세팅하는 공통 셋업. */
async function dispatchAndEscalate(
  repo: TaskGraphRepo, store: DispatchStore, leaseStore: LeaseStore, wf: string,
): Promise<void> {
  const a: WorkPackage = { id: 'a', storyId: 's1', owningRole: 'developer', oracleRef: null, acceptanceCriteria: [], dependencies: [], attributionCounters: {}, status: 'draft' }
  await repo.upsertGraph({ workflowId: wf, workPackages: [a], eventId: null })
  await store.recordDispatch({ workflowId: wf, wpId: 'a', stepN: 0, fromState: 'DRAFTED', attempt: 0, visibilityMs: 60000 })
}

describe.skipIf(!url)('P6 결정 라우팅: LeaseStore.reopenLease', () => {
  it('escalated lease → reopenLease가 active·attempt advance(현재+1)로 재진입(fix_reverify)', async () => {
    const pool = createPool(url!)
    try {
      await runMigrations(pool)
      const repo = new TaskGraphRepo(pool)
      const store = new DispatchStore(pool)
      const leaseStore = new LeaseStore(pool)
      const wf = `wf-dr-${Date.now()}`
      await dispatchAndEscalate(repo, store, leaseStore, wf)
      // escalate는 attempt 컬럼을 바꾸지 않음 — recordDispatch가 남긴 attempt(0)가 escalated 시점 attempt.
      const escalatedAttempt = (await leaseStore.getLease(wf, 'a'))!.attempt
      // 상한 초과 escalate(active→escalated)
      const esc = await leaseStore.recordEscalation({ workflowId: wf, wpId: 'a', attempt: 3, stepN: 0 })
      expect(esc.status).toBe('escalated')
      expect((await leaseStore.getLease(wf, 'a'))?.status).toBe('escalated')

      // reopenLease: escalated→active·attempt advance(0 리셋 아님 — dispatch_signal 멱등키 충돌 회피)
      const res = await leaseStore.reopenLease({ workflowId: wf, wpId: 'a', visibilityMs: 60000 })
      expect(res.status).toBe('reopened')
      if (res.status === 'reopened') expect(res.attempt).toBe(escalatedAttempt + 1)
      const lease = await leaseStore.getLease(wf, 'a')
      expect(lease?.status).toBe('active')
      expect(lease?.attempt).toBe(escalatedAttempt + 1)
      // wp_state_log에 ESCALATED→DISPATCHED 재진입 전이 기록
      const states = await repo.latestStates(wf)
      expect(states.get('a')?.toState).toBe('DISPATCHED')
    } finally {
      await cleanup(pool)
      await closePool()
    }
  })

  it('비-escalated(active) lease → reopenLease는 skip(단방향 가드)', async () => {
    const pool = createPool(url!)
    try {
      await runMigrations(pool)
      const repo = new TaskGraphRepo(pool)
      const store = new DispatchStore(pool)
      const leaseStore = new LeaseStore(pool)
      const wf = `wf-dr-skip-${Date.now()}`
      await dispatchAndEscalate(repo, store, leaseStore, wf)
      // escalate 안 함 — active 상태 그대로
      expect((await leaseStore.getLease(wf, 'a'))?.status).toBe('active')

      const res = await leaseStore.reopenLease({ workflowId: wf, wpId: 'a', visibilityMs: 60000 })
      expect(res.status).toBe('skipped')
      // active·attempt 불변
      const lease = await leaseStore.getLease(wf, 'a')
      expect(lease?.status).toBe('active')
      expect(lease?.attempt).toBe(0)
    } finally {
      await cleanup(pool)
      await closePool()
    }
  })
})
