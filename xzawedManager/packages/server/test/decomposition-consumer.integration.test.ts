import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createPool, runMigrations, closePool } from '../src/db/pool.js'
import { TaskGraphRepo } from '../src/db/task-graph.repo.js'
import { handleDecompositionEmitted, type DecompositionEmittedMessage } from '../src/streams/decomposition-consumer.js'
import type { WorkPackage, EventEnvelope } from '@xzawed/agent-streams'
import type { Pool } from 'pg'

const url = process.env['DATABASE_URL']
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
  envelope: envelope(workflowId, eventId), type: 'decomposition.emitted', payload: { workPackages: wps },
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
    await pool.query('DELETE FROM wp_state_log')
    await pool.query('DELETE FROM task_graphs')
    await closePool()
  })

  it('비순환 → upsert 영속 후 getGraph로 복원된다', async () => {
    const wfId = `wf-${Date.now()}-ok`
    const publish = vi.fn().mockResolvedValue('1-0')
    const out = await handleDecompositionEmitted(msg(wfId, 'evt-ok', [wp('a'), wp('b', ['a'])]), { repo, publish })
    expect(out).toEqual({ status: 'persisted', version: 1 })
    expect(publish).not.toHaveBeenCalled()
    const got = await repo.getGraph(wfId)
    expect(got?.workPackages.map((w) => w.id)).toEqual(['a', 'b'])
    expect(got?.eventId).toBe('evt-ok')
  })

  it('사이클 → 미영속 + inconsistent 발행', async () => {
    const wfId = `wf-${Date.now()}-cyc`
    const publish = vi.fn().mockResolvedValue('1-0')
    const out = await handleDecompositionEmitted(msg(wfId, 'evt-cyc', [wp('a', ['b']), wp('b', ['a'])]), { repo, publish })
    expect(out).toEqual({ status: 'inconsistent', reason: 'cycle' })
    expect(publish).toHaveBeenCalledTimes(1)
    expect(await repo.getGraph(wfId)).toBeNull()
  })
})
