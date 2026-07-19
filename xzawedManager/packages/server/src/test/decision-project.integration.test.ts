import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { runMigrations } from '../db/pool.js'
import { DecisionRepo } from '../db/decision.repo.js'

const url = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL']
const d = url ? describe : describe.skip

d('DecisionRepo project scope (pg)', () => {
  let pool: Pool
  beforeAll(async () => { pool = new Pool({ connectionString: url }); await runMigrations(pool) })
  afterAll(async () => {
    await pool.query("DELETE FROM manager_outbox WHERE event_id IN (SELECT event_id FROM manager_events WHERE session_id LIKE 'wf-dp-%')")
    await pool.query("DELETE FROM manager_events WHERE session_id LIKE 'wf-dp-%'")
    await pool.query("DELETE FROM decision_requests WHERE workflow_id LIKE 'wf-dp-%'")
    await pool.end()
  })

  it('createRequest가 project_id 영속·pendingByProject가 프로젝트 격리', async () => {
    const repo = new DecisionRepo(pool)
    await repo.createRequest({ requestId: 'wf-dp-1:wp-a:0', type: 'defect_brief', workflowId: 'wf-dp-1', correlationId: 'wf-dp-1', projectId: 'proj-A', tenantId: null })
    await repo.createRequest({ requestId: 'wf-dp-2:wp-b:0', type: 'defect_brief', workflowId: 'wf-dp-2', correlationId: 'wf-dp-2', projectId: 'proj-B', tenantId: null })
    const a = await repo.pendingByProject('proj-A')
    expect(a.map((r) => r.requestId)).toEqual(['wf-dp-1:wp-a:0'])
    expect(a[0]?.projectId).toBe('proj-A')
  })

  it('legacy NULL project_id 행은 pendingByProject에 미포함', async () => {
    const repo = new DecisionRepo(pool)
    await repo.createRequest({ requestId: 'wf-dp-3:wp-c:0', type: 'defect_brief', workflowId: 'wf-dp-3', correlationId: 'wf-dp-3', tenantId: null }) // projectId 없음 → null
    const a = await repo.pendingByProject('proj-A')
    expect(a.find((r) => r.requestId === 'wf-dp-3:wp-c:0')).toBeUndefined()
  })
})
