import { describe, it, expect, vi } from 'vitest'
import { createPool, runMigrations, closePool } from '../src/db/pool.js'
import { TaskGraphRepo } from '../src/db/task-graph.repo.js'
import { DispatchStore } from '../src/db/dispatch.repo.js'
import { LeaseStore } from '../src/db/lease.repo.js'
import { handleCompletion } from '../src/streams/completion.js'
import { handleWpDispatchSignal } from '../src/streams/worker.js'
import type { WorkPackage } from '@xzawed/agent-streams'

const url = process.env['DATABASE_URL']
describe.skipIf(!url)('P4-1 실행 워커 루프 통합(dispatch_signal→완료→재디스패치)', () => {
  it('워커가 WP를 실행→wp.completion→handleCompletion이 DONE·후행 unblock', async () => {
    const pool = createPool(url!)
    try {
      await runMigrations(pool)
      const repo = new TaskGraphRepo(pool)
      const store = new DispatchStore(pool)
      const leaseStore = new LeaseStore(pool)
      const wf = `wf-${Date.now()}`
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
      await closePool()
    }
  })
})
