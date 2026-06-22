import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Pool } from 'pg'
import { createPool, runMigrations, closePool } from '../src/db/pool.js'
import { DecisionRepo } from '../src/db/decision.repo.js'

const url = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL']

// N2 — hasApprovedDegradedDispatch 내구 조회. DB URL 없으면 skip. prefix 'wf-ds-' 정리.
describe.skipIf(!url)('N2 degraded signoff (integration)', () => {
  let pool: Pool

  beforeAll(async () => {
    pool = createPool(url!)
    await runMigrations(pool)
  })

  afterAll(async () => {
    for (const t of ['sign_offs', 'human_decisions']) {
      await pool.query(`DELETE FROM ${t} WHERE decision_id LIKE 'ds-%' OR request_id LIKE 'wf-ds-%'`).catch(() => undefined)
    }
    await pool.query("DELETE FROM decision_requests WHERE workflow_id LIKE 'wf-ds-%'").catch(() => undefined)
    await pool.query("DELETE FROM manager_outbox WHERE message::text LIKE '%wf-ds-%'").catch(() => undefined)
    await pool.query("DELETE FROM manager_events WHERE session_id LIKE 'wf-ds-%'").catch(() => undefined)
    await closePool()
  })

  it('미승인 false → accept_known+signoff 후 true·다른 wpId 격리', async () => {
    const repo = new DecisionRepo(pool)
    const wf = `wf-ds-${Date.now()}`
    const reqId = `${wf}:degraded:wp-a`
    await repo.createRequest({ requestId: reqId, type: 'degraded_dispatch', workflowId: wf, correlationId: wf, wpId: 'wp-a' })

    // before: 미승인.
    expect(await repo.hasApprovedDegradedDispatch(wf, 'wp-a')).toBe(false)

    // accept_known 결정 + 사인오프(scope degraded_dispatch).
    await repo.recordDecision({ decisionId: `ds-${wf}`, requestId: reqId, decidedBy: 'alice', choice: 'accept_known' })
    await repo.recordSignOff({ signoffId: `ds-${wf}:signoff`, decisionId: `ds-${wf}`, scope: 'degraded_dispatch', approver: 'alice', risk: 'HIGH' })

    // after: 승인.
    expect(await repo.hasApprovedDegradedDispatch(wf, 'wp-a')).toBe(true)
    // 다른 wpId는 격리(false).
    expect(await repo.hasApprovedDegradedDispatch(wf, 'wp-b')).toBe(false)
  })
})
