import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { runMigrations } from '../db/pool.js'
import { DecisionRepo } from '../db/decision.repo.js'
import { makeSignoffBrief } from '../streams/signoff-brief.js'
import { buildDecisionRecordedHandler } from '../streams/decision-consumer.js'

const url = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL']
const d = url ? describe : describe.skip

d('release signoff loop (pg)', () => {
  let pool: Pool
  beforeAll(async () => { pool = new Pool({ connectionString: url }); await runMigrations(pool) })
  afterAll(async () => {
    await pool.query("DELETE FROM sign_offs WHERE decision_id IN (SELECT decision_id FROM human_decisions WHERE request_id LIKE 'wf-rs-%')")
    await pool.query("DELETE FROM human_decisions WHERE request_id LIKE 'wf-rs-%'")
    await pool.query("DELETE FROM decision_requests WHERE workflow_id LIKE 'wf-rs-%'")
    await pool.query("DELETE FROM manager_outbox WHERE event_id IN (SELECT event_id FROM manager_events WHERE session_id LIKE 'wf-rs-%')")
    await pool.query("DELETE FROM manager_events WHERE session_id LIKE 'wf-rs-%'")
    await pool.end()
  })

  it('gate.blocked→DecisionRequest→accept_known→SignOff 루프', async () => {
    const repo = new DecisionRepo(pool)
    // 1) gate.blocked → degraded_release DecisionRequest (graphStore 없이 projectId null)
    await makeSignoffBrief(repo)({ workflowId: 'wf-rs-1', gateVersion: 'v1', blockingReasons: ['wp-a 미증명'], perWp: [{ wpId: 'wp-a', proven: false, unverifiable: true, missingChannels: [] }] })
    const reqId = 'wf-rs-1:gate:v1'
    const req = await repo.getRequest(reqId)
    expect(req?.type).toBe('degraded_release')
    // 2) 사람 accept_known 결정 기록
    const dec = await repo.recordDecision({ decisionId: `${reqId}:accept_known`, requestId: reqId, decidedBy: 'po-7', choice: 'accept_known', routedTo: 'gate_override' })
    expect(dec).not.toBeNull()
    // 3) decision.recorded 라우팅 → recordSignOff
    const handler = buildDecisionRecordedHandler({ decisionStore: repo, leaseStore: { reopenLease: async () => ({ status: 'noop' }) } as never, publish: async () => '1-0', visibilityMs: 1000, signoffStore: repo })
    await handler({ envelope: { eventId: 'e', correlationId: 'wf-rs-1', causationId: reqId, idempotencyKey: 'k', occurredAt: 1, workflowId: 'wf-rs-1', stepId: 's', attemptId: 0 }, type: 'decision.recorded', payload: { requestId: reqId, choice: 'accept_known', decisionId: `${reqId}:accept_known`, decidedBy: 'po-7' } } as never)
    // 4) sign_offs 행 + signoff.recorded 이벤트 검증
    const so = await pool.query("SELECT scope, approver FROM sign_offs WHERE decision_id = $1", [`${reqId}:accept_known`])
    expect(so.rows[0]).toEqual({ scope: 'release', approver: 'po-7' })
    const ev = await pool.query("SELECT COUNT(*)::int n FROM manager_events WHERE session_id='wf-rs-1' AND event_type='signoff.recorded'")
    expect(ev.rows[0].n).toBe(1)
  })
})
