import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { runMigrations } from '../src/db/pool.js'

const url = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL']
const d = url ? describe : describe.skip

/** G11 Slice 4: 쓰기 태깅(tenant_id). 읽기 격리는 하지 않으므로 "행에 값이 기록되는가"만 검증한다. */
d('G11 Slice 4 tenant 태깅 (pg)', () => {
  let pool: Pool
  beforeAll(async () => { pool = new Pool({ connectionString: url }); await runMigrations(pool) })
  afterAll(async () => { await pool.end() })

  const TAGGED_TABLES = [
    'task_graphs', 'wp_state_log', 'wp_leases', 'oracles', 'decision_requests',
    'risk_classifications', 'advisory_findings', 'wp_verification_results',
    'release_gates', 'domain_knowledge',
  ]

  it.each(TAGGED_TABLES)('%s에 tenant_id 컬럼이 존재한다', async (table) => {
    const { rows } = await pool.query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns
        WHERE table_name = $1 AND column_name = 'tenant_id'`,
      [table],
    )
    expect(rows[0]?.data_type).toBe('text')
  })

  it('upsertGraph가 userContext.tenantId를 tenant_id로 영속하고, 재분해 시 보존한다', async () => {
    const { TaskGraphRepo } = await import('../src/db/task-graph.repo.js')
    const repo = new TaskGraphRepo(pool)
    const wf = 'wf-tt-graph-1'
    const wp = {
      id: 'a', storyId: 's1', owningRole: 'developer', oracleRef: null,
      acceptanceCriteria: ['AC1'], dependencies: [], attributionCounters: {}, status: 'draft' as const,
    }
    const uc = { userId: 'u1', projectId: 'p1', workspaceRoot: '/workspace/tt', tenantId: 'org-1' }

    await repo.upsertGraph({ workflowId: wf, workPackages: [wp], eventId: null, userContext: uc })
    const first = await pool.query<{ tenant_id: string | null }>(
      `SELECT tenant_id FROM task_graphs WHERE workflow_id = $1`, [wf],
    )
    expect(first.rows[0]?.tenant_id).toBe('org-1')

    // C5: 재분해가 tenantId 없이 와도 기존 테넌트는 지워지지 않는다(COALESCE 보존).
    const ucNoTenant = { userId: 'u1', projectId: 'p1', workspaceRoot: '/workspace/tt' }
    await repo.upsertGraph({ workflowId: wf, workPackages: [wp], eventId: null, userContext: ucNoTenant })
    const second = await pool.query<{ tenant_id: string | null }>(
      `SELECT tenant_id FROM task_graphs WHERE workflow_id = $1`, [wf],
    )
    expect(second.rows[0]?.tenant_id).toBe('org-1')

    await pool.query(`DELETE FROM task_graphs WHERE workflow_id = $1`, [wf])
  })

  it('upsertGraph가 tenantId 없는 userContext면 tenant_id를 NULL로 둔다', async () => {
    const { TaskGraphRepo } = await import('../src/db/task-graph.repo.js')
    const repo = new TaskGraphRepo(pool)
    const wf = 'wf-tt-graph-2'
    const wp = {
      id: 'a', storyId: 's1', owningRole: 'developer', oracleRef: null,
      acceptanceCriteria: ['AC1'], dependencies: [], attributionCounters: {}, status: 'draft' as const,
    }
    await repo.upsertGraph({
      workflowId: wf, workPackages: [wp], eventId: null,
      userContext: { userId: 'u1', projectId: 'p1', workspaceRoot: '/workspace/tt' },
    })
    const { rows } = await pool.query<{ tenant_id: string | null }>(
      `SELECT tenant_id FROM task_graphs WHERE workflow_id = $1`, [wf],
    )
    expect(rows[0]?.tenant_id).toBeNull()
    await pool.query(`DELETE FROM task_graphs WHERE workflow_id = $1`, [wf])
  })

  it('recordDispatch가 wp_leases·wp_state_log에 tenant_id를 기록한다', async () => {
    const { DispatchStore } = await import('../src/db/dispatch.repo.js')
    const store = new DispatchStore(pool)
    const wf = 'wf-tt-dispatch-1'
    const r = await store.recordDispatch({
      workflowId: wf, wpId: 'a', stepN: 0, fromState: 'DRAFTED',
      visibilityMs: 60_000, tenantId: 'org-1',
    })
    expect(r.status).toBe('recorded')

    const lease = await pool.query<{ tenant_id: string | null }>(
      `SELECT tenant_id FROM wp_leases WHERE workflow_id = $1 AND wp_id = 'a'`, [wf],
    )
    expect(lease.rows[0]?.tenant_id).toBe('org-1')

    const log = await pool.query<{ tenant_id: string | null }>(
      `SELECT tenant_id FROM wp_state_log WHERE workflow_id = $1 AND wp_id = 'a'`, [wf],
    )
    expect(log.rows[0]?.tenant_id).toBe('org-1')

    await pool.query(`DELETE FROM manager_outbox WHERE event_id IN (SELECT event_id FROM manager_events WHERE session_id = $1)`, [wf])
    await pool.query(`DELETE FROM manager_events WHERE session_id = $1`, [wf])
    await pool.query(`DELETE FROM wp_state_log WHERE workflow_id = $1`, [wf])
    await pool.query(`DELETE FROM wp_leases WHERE workflow_id = $1`, [wf])
  })

  it('recordDispatch가 tenantId=null이면 tenant_id를 NULL로 둔다', async () => {
    const { DispatchStore } = await import('../src/db/dispatch.repo.js')
    const store = new DispatchStore(pool)
    const wf = 'wf-tt-dispatch-2'
    await store.recordDispatch({
      workflowId: wf, wpId: 'a', stepN: 0, fromState: 'DRAFTED',
      visibilityMs: 60_000, tenantId: null,
    })
    const lease = await pool.query<{ tenant_id: string | null }>(
      `SELECT tenant_id FROM wp_leases WHERE workflow_id = $1 AND wp_id = 'a'`, [wf],
    )
    expect(lease.rows[0]?.tenant_id).toBeNull()

    await pool.query(`DELETE FROM manager_outbox WHERE event_id IN (SELECT event_id FROM manager_events WHERE session_id = $1)`, [wf])
    await pool.query(`DELETE FROM manager_events WHERE session_id = $1`, [wf])
    await pool.query(`DELETE FROM wp_state_log WHERE workflow_id = $1`, [wf])
    await pool.query(`DELETE FROM wp_leases WHERE workflow_id = $1`, [wf])
  })
})
