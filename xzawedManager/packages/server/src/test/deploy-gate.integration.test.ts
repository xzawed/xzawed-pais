import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { Pool } from 'pg'
import { runMigrations } from '../db/pool.js'
import { ReleaseGateRepo } from '../db/release-gate.repo.js'
import { DecisionRepo } from '../db/decision.repo.js'

const DB = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL']
const PFX = 'wf-dg-'

async function seedGraph(pool: Pool, wf: string, projectId: string | null): Promise<void> {
  // graph_dag = workPackages + (선택) userContext — task-graph.repo.ts upsertGraph 저장 구조와 동일
  const dag = projectId === null
    ? JSON.stringify({ workPackages: [] })
    : JSON.stringify({ workPackages: [], userContext: { projectId } })
  await pool.query(
    `INSERT INTO task_graphs (workflow_id, graph_dag, version, created_at, updated_at)
     VALUES ($1, $2::jsonb, 1, NOW(), NOW())`,
    [wf, dag],
  )
}

async function seedGate(pool: Pool, wf: string, version: string, status: string): Promise<void> {
  await pool.query(
    `INSERT INTO release_gates (workflow_id, gate_version, status, per_wp, blocking_reasons, event_id)
     VALUES ($1, $2, $3, '[]'::jsonb, '[]'::jsonb, NULL)`,
    [wf, version, status],
  )
}

describe.skipIf(!DB)('ReleaseGateRepo.latestGateByProject (통합)', () => {
  let pool: Pool
  let repo: ReleaseGateRepo
  beforeAll(async () => {
    pool = new Pool({ connectionString: DB })
    await runMigrations(pool)
    repo = new ReleaseGateRepo(pool)
  })
  afterEach(async () => {
    await pool.query(`DELETE FROM release_gates WHERE workflow_id LIKE '${PFX}%'`)
    await pool.query(`DELETE FROM task_graphs WHERE workflow_id LIKE '${PFX}%'`)
  })
  afterAll(async () => { await pool.end() })

  it('projectId에 해당하는 게이트 반환(blocked)', async () => {
    await seedGraph(pool, `${PFX}1`, `${PFX}proj-a`)
    await seedGate(pool, `${PFX}1`, 'v1', 'blocked')
    expect(await repo.latestGateByProject(`${PFX}proj-a`)).toEqual({ status: 'blocked', workflowId: `${PFX}1` })
  })

  it('게이트 없는 projectId → null', async () => {
    expect(await repo.latestGateByProject(`${PFX}none`)).toBeNull()
  })

  it('같은 projectId·다른 workflow 2건 → 최신(created_at,id) 반환', async () => {
    await seedGraph(pool, `${PFX}old`, `${PFX}proj-b`)
    await seedGate(pool, `${PFX}old`, 'v1', 'blocked')
    await seedGraph(pool, `${PFX}new`, `${PFX}proj-b`)
    await seedGate(pool, `${PFX}new`, 'v1', 'passed')
    // 같은 NOW()라도 id DESC tiebreak로 나중 INSERT가 최신
    expect(await repo.latestGateByProject(`${PFX}proj-b`)).toEqual({ status: 'passed', workflowId: `${PFX}new` })
  })

  it('미지 status 값 → null(fail-open)', async () => {
    await seedGraph(pool, `${PFX}u`, `${PFX}proj-u`)
    await seedGate(pool, `${PFX}u`, 'v1', 'degraded')
    expect(await repo.latestGateByProject(`${PFX}proj-u`)).toBeNull()
  })

  it('userContext 없는 레거시 그래프 → null', async () => {
    await seedGraph(pool, `${PFX}leg`, null)
    await seedGate(pool, `${PFX}leg`, 'v1', 'blocked')
    expect(await repo.latestGateByProject(`${PFX}proj-leg`)).toBeNull()
  })
})

// 컬럼은 migration 011 검증 완료. NOT NULL(default 없음): decision_requests=request_id/type/workflow_id/correlation_id;
// human_decisions=decision_id/request_id/decided_by/choice/correlation_id; sign_offs=signoff_id/decision_id/scope/approver.
// 나머지(status/context/severity/language/risk·created_at/decided_at)는 default. occurred_at·updated_at 컬럼 없음.
async function seedSignoff(pool: Pool, wf: string, reqId: string, scope: string): Promise<void> {
  await pool.query(
    `INSERT INTO decision_requests (request_id, type, workflow_id, correlation_id, status)
     VALUES ($1, 'degraded_release', $2, $2, 'RESOLVED')`,
    [reqId, wf],
  )
  await pool.query(
    `INSERT INTO human_decisions (decision_id, request_id, decided_by, choice, correlation_id)
     VALUES ($1, $2, 'po-1', 'accept_known', $3)`,
    [`${reqId}:dec`, reqId, wf],
  )
  await pool.query(
    `INSERT INTO sign_offs (signoff_id, decision_id, scope, approver)
     VALUES ($1, $2, $3, 'po-1')`,
    [`${reqId}:so`, `${reqId}:dec`, scope],
  )
}

describe.skipIf(!DB)('DecisionRepo.hasApprovedReleaseSignoff (통합)', () => {
  let pool: Pool
  let repo: DecisionRepo
  beforeAll(async () => {
    pool = new Pool({ connectionString: DB })
    await runMigrations(pool)
    repo = new DecisionRepo(pool)
  })
  afterEach(async () => {
    await pool.query(`DELETE FROM sign_offs WHERE decision_id LIKE '${PFX}%'`)
    await pool.query(`DELETE FROM human_decisions WHERE request_id LIKE '${PFX}%'`)
    await pool.query(`DELETE FROM decision_requests WHERE request_id LIKE '${PFX}%'`)
  })
  afterAll(async () => { await pool.end() })

  it('scope=release 사인오프 존재 → true', async () => {
    await seedSignoff(pool, `${PFX}wf1`, `${PFX}req1`, 'release')
    expect(await repo.hasApprovedReleaseSignoff(`${PFX}wf1`)).toBe(true)
  })
  it('scope 불일치(release 아님) → false', async () => {
    await seedSignoff(pool, `${PFX}wf2`, `${PFX}req2`, 'other')
    expect(await repo.hasApprovedReleaseSignoff(`${PFX}wf2`)).toBe(false)
  })
  it('workflow 불일치 → false', async () => {
    await seedSignoff(pool, `${PFX}wf3`, `${PFX}req3`, 'release')
    expect(await repo.hasApprovedReleaseSignoff(`${PFX}wf-other`)).toBe(false)
  })
})
