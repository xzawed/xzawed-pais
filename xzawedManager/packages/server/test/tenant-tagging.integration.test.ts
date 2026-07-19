import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import type { RiskClassification } from '@xzawed/agent-streams'
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
    const wf = `wf-tt-graph-${randomUUID()}`
    try {
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
    } finally {
      await pool.query(`DELETE FROM task_graphs WHERE workflow_id = $1`, [wf])
    }
  })

  it('upsertGraph가 tenantId 없는 userContext면 tenant_id를 NULL로 둔다', async () => {
    const { TaskGraphRepo } = await import('../src/db/task-graph.repo.js')
    const repo = new TaskGraphRepo(pool)
    const wf = `wf-tt-graph-${randomUUID()}`
    try {
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
    } finally {
      await pool.query(`DELETE FROM task_graphs WHERE workflow_id = $1`, [wf])
    }
  })

  it('recordDispatch가 wp_leases·wp_state_log에 tenant_id를 기록한다', async () => {
    const { DispatchStore } = await import('../src/db/dispatch.repo.js')
    const store = new DispatchStore(pool)
    const wf = `wf-tt-dispatch-${randomUUID()}`
    try {
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
    } finally {
      await pool.query(`DELETE FROM manager_outbox WHERE event_id IN (SELECT event_id FROM manager_events WHERE session_id = $1)`, [wf])
      await pool.query(`DELETE FROM manager_events WHERE session_id = $1`, [wf])
      await pool.query(`DELETE FROM wp_state_log WHERE workflow_id = $1`, [wf])
      await pool.query(`DELETE FROM wp_leases WHERE workflow_id = $1`, [wf])
    }
  })

  it('recordDispatch가 tenantId=null이면 tenant_id를 NULL로 둔다', async () => {
    const { DispatchStore } = await import('../src/db/dispatch.repo.js')
    const store = new DispatchStore(pool)
    const wf = `wf-tt-dispatch-${randomUUID()}`
    try {
      await store.recordDispatch({
        workflowId: wf, wpId: 'a', stepN: 0, fromState: 'DRAFTED',
        visibilityMs: 60_000, tenantId: null,
      })
      const lease = await pool.query<{ tenant_id: string | null }>(
        `SELECT tenant_id FROM wp_leases WHERE workflow_id = $1 AND wp_id = 'a'`, [wf],
      )
      expect(lease.rows[0]?.tenant_id).toBeNull()
    } finally {
      await pool.query(`DELETE FROM manager_outbox WHERE event_id IN (SELECT event_id FROM manager_events WHERE session_id = $1)`, [wf])
      await pool.query(`DELETE FROM manager_events WHERE session_id = $1`, [wf])
      await pool.query(`DELETE FROM wp_state_log WHERE workflow_id = $1`, [wf])
      await pool.query(`DELETE FROM wp_leases WHERE workflow_id = $1`, [wf])
    }
  })

  it('insertMany가 domain_knowledge에 tenant_id를 기록한다', async () => {
    const { KnowledgeRepo } = await import('../src/db/knowledge.repo.js')
    const repo = new KnowledgeRepo(pool)
    const projectId = `proj-tt-${randomUUID()}`
    try {
      await repo.insertMany(projectId, [{ content: 'c1', sourceAgent: 'tester' }], 'org-1')
      await repo.insertMany(projectId, [{ content: 'c2', sourceAgent: 'tester' }], null)

      const { rows } = await pool.query<{ content: string; tenant_id: string | null }>(
        `SELECT content, tenant_id FROM domain_knowledge WHERE project_id = $1 ORDER BY content`, [projectId],
      )
      expect(rows.map((r) => [r.content, r.tenant_id])).toEqual([['c1', 'org-1'], ['c2', null]])
    } finally {
      await pool.query(`DELETE FROM domain_knowledge WHERE project_id = $1`, [projectId])
    }
  })

  it('upsertDraft가 oracles에 tenant_id를 기록한다', async () => {
    const { OracleRepo } = await import('../src/db/oracle.repo.js')
    const repo = new OracleRepo(pool)
    const wf = `wf-tt-oracle-${randomUUID()}`
    try {
      await repo.upsertDraft({ workflowId: wf, storyId: 's1', scenarios: [], coverage: {}, tenantId: 'org-1' })
      const { rows } = await pool.query<{ tenant_id: string | null }>(
        `SELECT tenant_id FROM oracles WHERE workflow_id = $1`, [wf],
      )
      expect(rows[0]?.tenant_id).toBe('org-1')
    } finally {
      await pool.query(`DELETE FROM oracles WHERE workflow_id = $1`, [wf])
    }
  })

  it('risk upsert가 risk_classifications에 tenant_id를 기록한다', async () => {
    const { RiskClassificationRepo } = await import('../src/db/risk-classification.repo.js')
    const repo = new RiskClassificationRepo(pool)
    const wf = `wf-tt-risk-${randomUUID()}`
    try {
      const classification: RiskClassification = {
        projectId: 'p1',
        risk: 'MEDIUM',
        dimensionScores: {
          domain: { score: 0, confidence: 0 },
          complexity: { score: 0, confidence: 0 },
          external_deps: { score: 0, confidence: 0 },
          compliance: { score: 0, confidence: 0 },
        },
        complianceFrameworks: [],
        claims: [],
        modelRouting: { PM: 'opus', Developer: 'sonnet', Designer: 'sonnet', Tester: 'sonnet', Security: 'sonnet' },
        humanGate: { required: false, reason: '' },
        classifierModel: 'opus',
        audit: { approvedBy: null, approvedAt: null, version: 1 },
      }
      await repo.upsert({ workflowId: wf, classification, tenantId: 'org-1' })
      const { rows } = await pool.query<{ tenant_id: string | null }>(
        `SELECT tenant_id FROM risk_classifications WHERE workflow_id = $1`, [wf],
      )
      expect(rows[0]?.tenant_id).toBe('org-1')
    } finally {
      await pool.query(`DELETE FROM risk_classifications WHERE workflow_id = $1`, [wf])
    }
  })

  it('recordFindings가 advisory_findings에 tenant_id를 기록한다', async () => {
    const { AdvisoryRepo } = await import('../src/db/advisory.repo.js')
    const repo = new AdvisoryRepo(pool)
    const wf = `wf-tt-adv-${randomUUID()}`
    try {
      await repo.recordFindings(wf, 'a', 0, [
        { rank: 1, title: 't', rationale: 'r', severity: 'advisory', sourceLens: 'optimization' },
      ], 'org-1')
      const { rows } = await pool.query<{ tenant_id: string | null }>(
        `SELECT tenant_id FROM advisory_findings WHERE workflow_id = $1`, [wf],
      )
      expect(rows[0]?.tenant_id).toBe('org-1')
    } finally {
      await pool.query(`DELETE FROM manager_outbox WHERE event_id IN (SELECT event_id FROM manager_events WHERE session_id = $1)`, [wf])
      await pool.query(`DELETE FROM manager_events WHERE session_id = $1`, [wf])
      await pool.query(`DELETE FROM advisory_findings WHERE workflow_id = $1`, [wf])
    }
  })
})
