import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Pool } from 'pg'
import { createPool, runMigrations, closePool } from '../src/db/pool.js'
import { TaskGraphRepo } from '../src/db/task-graph.repo.js'
import type { WorkPackage } from '@xzawed/agent-streams'

const url = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL']

function wp(id: string, risk: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM'): WorkPackage {
  return {
    id, storyId: 's1', epicId: null, owningRole: 'developer',
    inputs: [], outputs: [], oracleRef: null, acceptanceCriteria: ['x'],
    dependencies: [], risk, attributionCounters: { impl: 0, task: 0, plan: 0 }, status: 'draft',
  } as WorkPackage
}

describe.skipIf(!url)('TaskGraphRepo.updateWpRisks (integration)', () => {
  let pool: Pool
  beforeAll(async () => { pool = createPool(url!); await runMigrations(pool) })
  afterAll(async () => { await pool.query("DELETE FROM task_graphs WHERE workflow_id LIKE 'wf-tgr-%'"); await closePool() })

  it('모든 WP risk를 갱신하고 version·id·userContext를 보존한다', async () => {
    const repo = new TaskGraphRepo(pool)
    const uc = { userId: 'u', projectId: 'p', workspaceRoot: '/abs/ws' }
    const { version: v0 } = await repo.upsertGraph({ workflowId: 'wf-tgr-1', workPackages: [wp('a'), wp('b')], userContext: uc })

    const res = await repo.updateWpRisks('wf-tgr-1', 'HIGH')
    expect(res.updated).toBe(2)

    const g = await repo.getGraph('wf-tgr-1')
    expect(g!.version).toBe(v0)                       // version 불변(재분해 아님)
    expect(g!.workPackages.map((w) => w.id).sort()).toEqual(['a', 'b'])  // id 불변
    expect(g!.workPackages.every((w) => w.risk === 'HIGH')).toBe(true)   // risk 갱신
    expect(g!.userContext).toEqual(uc)                // userContext 보존
  })

  it('그래프가 없으면 no-op({updated:0})', async () => {
    const repo = new TaskGraphRepo(pool)
    expect(await repo.updateWpRisks('wf-tgr-missing', 'HIGH')).toEqual({ updated: 0 })
  })
})
