import { describe, it, expect, vi } from 'vitest'
import { createPool, runMigrations, closePool } from '../src/db/pool.js'
import { TaskGraphRepo } from '../src/db/task-graph.repo.js'
import { DispatchStore } from '../src/db/dispatch.repo.js'
import { LeaseStore } from '../src/db/lease.repo.js'
import { handleCompletion } from '../src/streams/completion.js'
import { handleLeaseSweep } from '../src/streams/lease.js'
import { handleWpDispatchSignal } from '../src/streams/worker.js'
import type { WorkPackage } from '@xzawed/agent-streams'

/** sweep을 이 워크플로로 스코프 — expiredActiveLeases는 전역 조회라 병렬 형제 테스트의 lease를 reclaim하면 안 된다. */
function scopedLeaseStore(store: LeaseStore, workflowId: string): LeaseStore {
  return {
    expiredActiveLeases: async (now: number) =>
      (await store.expiredActiveLeases(now)).filter((l) => l.workflowId === workflowId),
    recordReclaim: store.recordReclaim.bind(store),
    recordEscalation: store.recordEscalation.bind(store),
    getLease: store.getLease.bind(store),
    recordCompletion: store.recordCompletion.bind(store),
  } as LeaseStore
}

// CI(turborepo 잡)는 TEST_DATABASE_URL을 주입 — 게이트 통일(Orchestrator migrate.integration 패턴)
const url = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL']

/** 'wf-ew-%' prefix 스코프 정리 — 잔여 행 누적·형제 통합 테스트와의 병렬 간섭 방지(FK 순서: outbox→events). */
async function cleanup(pool: import('pg').Pool): Promise<void> {
  await pool.query("DELETE FROM manager_outbox WHERE stream LIKE 'manager:events:wf-ew-%'").catch(() => undefined)
  await pool.query("DELETE FROM manager_events WHERE session_id LIKE 'wf-ew-%'").catch(() => undefined)
  await pool.query("DELETE FROM wp_state_log WHERE workflow_id LIKE 'wf-ew-%'").catch(() => undefined)
  await pool.query("DELETE FROM wp_leases WHERE workflow_id LIKE 'wf-ew-%'").catch(() => undefined)
  await pool.query("DELETE FROM task_graphs WHERE workflow_id LIKE 'wf-ew-%'").catch(() => undefined)
}

describe.skipIf(!url)('P4-1 실행 워커 루프 통합(dispatch_signal→완료→재디스패치)', () => {
  it('워커가 WP를 실행→wp.completion→handleCompletion이 DONE·후행 unblock', async () => {
    const pool = createPool(url!)
    try {
      await runMigrations(pool)
      const repo = new TaskGraphRepo(pool)
      const store = new DispatchStore(pool)
      const leaseStore = new LeaseStore(pool)
      const wf = `wf-ew-${Date.now()}`
      const a: WorkPackage = { id: 'a', storyId: 's1', owningRole: 'developer', oracleRef: null, acceptanceCriteria: [], dependencies: [], attributionCounters: {}, status: 'draft' }
      await repo.upsertGraph({ workflowId: wf, workPackages: [a], eventId: null })
      await store.recordDispatch({ workflowId: wf, wpId: 'a', stepN: 0, fromState: 'DRAFTED', attempt: 0, visibilityMs: 60000 })

      // 워커: 신호 처리 → 에이전트 성공(mock) → wp.completion 발행(여기선 publish를 capture)
      const published: Array<{ stream: string; msg: { payload: { wpId: string } } }> = []
      const out = await handleWpDispatchSignal(
        { envelope: { eventId: '1', correlationId: wf, causationId: null, workflowId: wf, stepId: 'wp.dispatch_signal:a', attemptId: 0, idempotencyKey: `${wf}:wp.dispatch_signal:a:0`, occurredAt: 1 }, type: 'wp.dispatch_signal', payload: { wpId: 'a', attempt: 0 } },
        { repo, handlers: { develop_code: { execute: vi.fn().mockResolvedValue({}) } }, publish: async (stream, msg) => { published.push({ stream, msg: msg as never }); return '1-0' } },
      )
      expect(out).toEqual({ status: 'completed', wpId: 'a' })
      expect(published[0]!.msg.payload.wpId).toBe('a')

      // 완료 신호 소비 → DONE 전이
      const c = await handleCompletion(wf, 'a', { leaseStore, dispatch: { repo, store } })
      expect(c.status).toBe('completed')
      const states = await repo.latestStates(wf)
      expect(states.get('a')?.toState).toBe('DONE')
    } finally {
      await cleanup(pool)
      await closePool()
    }
  })

  it('userContext가 영속된 그래프면 워커가 에이전트 execute에 컨텍스트·projectPath를 주입한다(P4a-2)', async () => {
    const pool = createPool(url!)
    try {
      await runMigrations(pool)
      const repo = new TaskGraphRepo(pool)
      const wf = `wf-ew-uc-${Date.now()}`
      const uc = { userId: 'u1', projectId: 'p1', workspaceRoot: '/workspace/p1' }
      const a: WorkPackage = { id: 'a', storyId: 's1', owningRole: 'developer', oracleRef: null, acceptanceCriteria: ['AC1'], dependencies: [], attributionCounters: {}, status: 'draft' }
      await repo.upsertGraph({ workflowId: wf, workPackages: [a], eventId: null, userContext: uc })

      // 실 Postgres 라운드트립: graph_dag JSONB → getGraph → 워커 주입
      const stored = await repo.getGraph(wf)
      expect(stored?.userContext).toEqual(uc)

      const exec = vi.fn().mockResolvedValue({})
      const out = await handleWpDispatchSignal(
        { envelope: { eventId: '1', correlationId: wf, causationId: null, workflowId: wf, stepId: 'wp.dispatch_signal:a', attemptId: 0, idempotencyKey: `${wf}:wp.dispatch_signal:a:0`, occurredAt: 1 }, type: 'wp.dispatch_signal', payload: { wpId: 'a', attempt: 0 } },
        { repo, handlers: { develop_code: { execute: exec } }, publish: async () => '1-0' },
      )
      expect(out).toEqual({ status: 'completed', wpId: 'a' })
      expect(exec).toHaveBeenCalledWith(expect.objectContaining({ projectPath: '/workspace/p1' }), wf, uc)
    } finally {
      await cleanup(pool)
      await closePool()
    }
  })

  it('검증 게이트(P4b-1): tester 실패 결과 → 완료 미발행 → lease sweep이 reclaim(attempt 1)·재신호(백스톱 실증)', async () => {
    const pool = createPool(url!)
    try {
      await runMigrations(pool)
      const repo = new TaskGraphRepo(pool)
      const store = new DispatchStore(pool)
      const leaseStore = new LeaseStore(pool)
      const wf = `wf-ew-vf-${Date.now()}`
      const a: WorkPackage = { id: 'a', storyId: 's1', owningRole: 'tester', oracleRef: null, acceptanceCriteria: [], dependencies: [], attributionCounters: {}, status: 'draft' }
      await repo.upsertGraph({ workflowId: wf, workPackages: [a], eventId: null })
      await store.recordDispatch({ workflowId: wf, wpId: 'a', stepN: 0, fromState: 'DRAFTED', attempt: 0, visibilityMs: 60000 })

      const published: Array<{ stream: string; msg: { type: string; payload?: { attempt?: number } } }> = []
      const publish = async (stream: string, msg: unknown): Promise<string> => {
        published.push({ stream, msg: msg as never })
        return '1-0'
      }
      const out = await handleWpDispatchSignal(
        { envelope: { eventId: '1', correlationId: wf, causationId: null, workflowId: wf, stepId: 'wp.dispatch_signal:a', attemptId: 0, idempotencyKey: `${wf}:wp.dispatch_signal:a:0`, occurredAt: 1 }, type: 'wp.dispatch_signal', payload: { wpId: 'a', attempt: 0 } },
        {
          repo,
          handlers: { run_tests: { execute: vi.fn().mockResolvedValue({ success: false, failed: 2 }) } },
          publish,
          verifyEnabled: true,
        },
      )
      expect(out.status).toBe('verification_failed')
      // 완료 미발행 — 관측 이벤트(wp.verification.failed)만
      expect(published.some((p) => p.msg.type === 'wp.completion')).toBe(false)
      expect(published.some((p) => p.msg.type === 'wp.verification.failed')).toBe(true)
      // 백스톱 실증: lease 만료 후 sweep이 이 WP를 reclaim(attempt 1)하고 dispatch_signal을 재발행한다
      const sweep = await handleLeaseSweep(Date.now() + 120_000, {
        store: scopedLeaseStore(leaseStore, wf), publish,
      })
      expect(sweep.reclaimed).toEqual([expect.objectContaining({ workflowId: wf, wpId: 'a', nextAttempt: 1 })])
      const resignal = published.find((p) => p.msg.type === 'wp.dispatch_signal')
      expect(resignal?.msg.payload?.attempt).toBe(1)
      const lease = await leaseStore.getLease(wf, 'a')
      expect(lease?.status).toBe('active')
      expect(lease?.attempt).toBe(1)
      // wp_state_log에 DONE 전이 없음(DISPATCHED 유지)
      const states = await repo.latestStates(wf)
      expect(states.get('a')?.toState).toBe('DISPATCHED')
    } finally {
      await cleanup(pool)
      await closePool()
    }
  })

  it('검증 게이트(P4b-1): tester 통과 결과 → wp.completion → handleCompletion이 DONE 전이(스펙 §6 통과 경로)', async () => {
    const pool = createPool(url!)
    try {
      await runMigrations(pool)
      const repo = new TaskGraphRepo(pool)
      const store = new DispatchStore(pool)
      const leaseStore = new LeaseStore(pool)
      const wf = `wf-ew-vp-${Date.now()}`
      const a: WorkPackage = { id: 'a', storyId: 's1', owningRole: 'tester', oracleRef: null, acceptanceCriteria: [], dependencies: [], attributionCounters: {}, status: 'draft' }
      await repo.upsertGraph({ workflowId: wf, workPackages: [a], eventId: null })
      await store.recordDispatch({ workflowId: wf, wpId: 'a', stepN: 0, fromState: 'DRAFTED', attempt: 0, visibilityMs: 60000 })

      const published: Array<{ msg: { type: string } }> = []
      const out = await handleWpDispatchSignal(
        { envelope: { eventId: '1', correlationId: wf, causationId: null, workflowId: wf, stepId: 'wp.dispatch_signal:a', attemptId: 0, idempotencyKey: `${wf}:wp.dispatch_signal:a:0`, occurredAt: 1 }, type: 'wp.dispatch_signal', payload: { wpId: 'a', attempt: 0 } },
        {
          repo,
          handlers: { run_tests: { execute: vi.fn().mockResolvedValue({ success: true, passed: 5, failed: 0 }) } },
          publish: async (_s, msg) => { published.push({ msg: msg as never }); return '1-0' },
          verifyEnabled: true,
        },
      )
      expect(out).toEqual({ status: 'completed', wpId: 'a' })
      expect(published.some((p) => p.msg.type === 'wp.completion')).toBe(true)
      const c = await handleCompletion(wf, 'a', { leaseStore, dispatch: { repo, store } })
      expect(c.status).toBe('completed')
      const states = await repo.latestStates(wf)
      expect(states.get('a')?.toState).toBe('DONE')
      expect((await leaseStore.getLease(wf, 'a'))?.status).toBe('released')
    } finally {
      await cleanup(pool)
      await closePool()
    }
  })
})
