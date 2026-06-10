import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createPool, runMigrations, closePool } from '../src/db/pool.js'
import { TaskGraphRepo } from '../src/db/task-graph.repo.js'
import { handleDecompositionEmitted, type DecompositionEmittedMessage } from '../src/streams/decomposition-consumer.js'
import type { WorkPackage, EventEnvelope } from '@xzawed/agent-streams'
import type { Pool } from 'pg'

// CI(turborepo 잡)는 TEST_DATABASE_URL을 주입 — 게이트 통일(Orchestrator migrate.integration 패턴)
const url = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL']
const d = url ? describe : describe.skip

const wp = (id: string, deps: string[] = []): WorkPackage => ({
  id, storyId: 's1', owningRole: 'developer', oracleRef: null,
  acceptanceCriteria: [], dependencies: deps, attributionCounters: {}, status: 'draft',
})
const envelope = (workflowId: string, eventId: string): EventEnvelope => ({
  eventId, correlationId: workflowId, causationId: null, idempotencyKey: `${workflowId}:dec:0`,
  workflowId, stepId: 'dec', attemptId: 0, occurredAt: 1000,
})
const msg = (workflowId: string, eventId: string, wps: WorkPackage[]): DecompositionEmittedMessage => ({
  envelope: envelope(workflowId, eventId), type: 'decomposition.emitted', payload: { workPackages: wps, oracleDrafts: [] },
})

d('decomposition 소비 통합 (pg)', () => {
  let pool: Pool
  let repo: TaskGraphRepo
  beforeAll(async () => {
    pool = createPool(url!)
    await runMigrations(pool)
    repo = new TaskGraphRepo(pool)
  })
  afterAll(async () => {
    // 'wf-dc-%' prefix 스코프 정리 — 비스코프 DELETE는 병렬 형제 통합 테스트의 행을 지운다(P1d-4 §8.3).
    await pool.query("DELETE FROM wp_state_log WHERE workflow_id LIKE 'wf-dc-%'")
    await pool.query("DELETE FROM task_graphs WHERE workflow_id LIKE 'wf-dc-%'")
    await closePool()
  })

  it('비순환 → upsert 영속 후 getGraph로 복원된다', async () => {
    const wfId = `wf-dc-${Date.now()}-ok`
    // task_graphs.event_id는 UUID 컬럼 — 실 pg에선 'evt-ok' 같은 비UUID가 거부된다(게이트 통일로 처음 발현).
    const evtId = crypto.randomUUID()
    const publish = vi.fn().mockResolvedValue('1-0')
    const out = await handleDecompositionEmitted(msg(wfId, evtId, [wp('a'), wp('b', ['a'])]), { repo, publish })
    expect(out).toEqual({ status: 'persisted', version: 1 })
    expect(publish).not.toHaveBeenCalled()
    const got = await repo.getGraph(wfId)
    expect(got?.workPackages.map((w) => w.id)).toEqual(['a', 'b'])
    expect(got?.eventId).toBe(evtId)
  })

  it('사이클 → 미영속 + inconsistent 발행', async () => {
    const wfId = `wf-dc-${Date.now()}-cyc`
    const publish = vi.fn().mockResolvedValue('1-0')
    const out = await handleDecompositionEmitted(msg(wfId, crypto.randomUUID(), [wp('a', ['b']), wp('b', ['a'])]), { repo, publish })
    expect(out).toEqual({ status: 'inconsistent', reason: 'cycle' })
    expect(publish).toHaveBeenCalledTimes(1)
    expect(await repo.getGraph(wfId)).toBeNull()
  })
})
