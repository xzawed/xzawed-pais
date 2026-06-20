import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { Pool } from 'pg'
import { runMigrations } from '../db/pool.js'
import { DecisionRepo } from '../db/decision.repo.js'
import { DECISION_EXPIRED } from '../db/decision.types.js'

const DB = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL']
const PFX = 'wf-dx-'

async function seedReq(repo: DecisionRepo, wf: string, expiresAtMs: number | null): Promise<string> {
  const requestId = `${wf}:wp:0`
  await repo.createRequest({
    requestId, type: 'defect_brief', workflowId: wf, correlationId: wf,
    ...(expiresAtMs !== null && { expiresAt: new Date(expiresAtMs).toISOString() }),
  })
  return requestId
}

describe.skipIf(!DB)('DecisionRepo.expiredPendingRequests + expire loop (통합)', () => {
  let pool: Pool
  let repo: DecisionRepo
  beforeAll(async () => {
    pool = new Pool({ connectionString: DB! })
    await runMigrations(pool)
    repo = new DecisionRepo(pool)
  })
  afterEach(async () => {
    await pool.query("DELETE FROM manager_outbox WHERE event_id IN (SELECT event_id FROM manager_events WHERE session_id LIKE 'wf-dx-%')")
    await pool.query("DELETE FROM manager_events WHERE session_id LIKE 'wf-dx-%'")
    await pool.query("DELETE FROM decision_requests WHERE workflow_id LIKE 'wf-dx-%'")
  })
  afterAll(async () => { await pool.end() })

  it('과거 expires_at PENDING → 반환', async () => {
    const now = Date.now()
    const id = await seedReq(repo, `${PFX}past`, now - 1000)
    expect(await repo.expiredPendingRequests(now, 100)).toContain(id)
  })
  it('미래 expires_at → 제외(경계)', async () => {
    const now = Date.now()
    await seedReq(repo, `${PFX}future`, now + 1000)
    const ids = await repo.expiredPendingRequests(now, 100)
    expect(ids.some((i) => i.startsWith(`${PFX}future`))).toBe(false)
  })
  it('expires_at NULL(레거시) → 제외', async () => {
    const now = Date.now()
    await seedReq(repo, `${PFX}null`, null)
    const ids = await repo.expiredPendingRequests(now, 100)
    expect(ids.some((i) => i.startsWith(`${PFX}null`))).toBe(false)
  })
  it('非PENDING(EXPIRED) → 제외', async () => {
    const now = Date.now()
    const id = await seedReq(repo, `${PFX}exp`, now - 1000)
    await repo.expireRequest(id) // PENDING→EXPIRED
    const ids = await repo.expiredPendingRequests(now, 100)
    expect(ids).not.toContain(id)
  })
  it('LIMIT 준수 + ORDER BY expires_at ASC(오래된 것 먼저)', async () => {
    const now = Date.now()
    await seedReq(repo, `${PFX}l1`, now - 1000)         // 더 최근
    const older = await seedReq(repo, `${PFX}l2`, now - 2000) // 더 오래됨 → ASC 첫 행
    const result = await repo.expiredPendingRequests(now, 1)
    expect(result.length).toBe(1)
    expect(result[0]).toBe(older)
  })
  it('e2e: 만료 → expireRequest → EXPIRED + decision.expired 이벤트', async () => {
    const now = Date.now()
    const id = await seedReq(repo, `${PFX}e2e`, now - 1000)
    const [expId] = await repo.expiredPendingRequests(now, 100)
    expect(expId).toBe(id)
    if (!expId) return // 타입 내로잉 — 위 단언 실패 시 undefined로 진행 방지(I-1)
    const r = await repo.expireRequest(expId)
    expect(r).not.toBeNull()
    const req = await repo.getRequest(id)
    expect(req?.status).toBe(DECISION_EXPIRED)
    const { rows } = await pool.query(
      "SELECT 1 FROM manager_events WHERE event_type='decision.expired' AND session_id=$1",
      [`${PFX}e2e`],
    )
    expect(rows.length).toBe(1)
  })
})
