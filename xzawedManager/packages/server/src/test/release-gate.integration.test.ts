import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { runMigrations } from '../db/pool.js'
import { ReleaseGateRepo } from '../db/release-gate.repo.js'

const url = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL']
const d = url ? describe : describe.skip

d('ReleaseGateRepo (pg)', () => {
  let pool: Pool
  const wf = 'wf-rg-evi-1'
  beforeAll(async () => { pool = new Pool({ connectionString: url }); await runMigrations(pool) })
  afterAll(async () => {
    await pool.query('DELETE FROM wp_verification_results WHERE workflow_id LIKE $1', ['wf-rg-%'])
    await pool.query('DELETE FROM release_gates WHERE workflow_id LIKE $1', ['wf-rg-%'])
    await pool.query("DELETE FROM manager_outbox WHERE event_id IN (SELECT event_id FROM manager_events WHERE session_id LIKE 'wf-rg-%')")
    await pool.query("DELETE FROM manager_events WHERE session_id LIKE 'wf-rg-%'")
    await pool.end()
  })

  it('recordEvidence persists projection + manager_events + manager_outbox in one tx, idempotent', async () => {
    const repo = new ReleaseGateRepo(pool)
    await repo.recordEvidence(wf, 'wp-a', 0, [{ channel: 'tc', outcome: 'passed' }, { channel: 'security', outcome: 'skipped' }])
    await repo.recordEvidence(wf, 'wp-a', 0, [{ channel: 'tc', outcome: 'passed' }, { channel: 'security', outcome: 'skipped' }])
    const rows = await pool.query('SELECT channel, outcome FROM wp_verification_results WHERE workflow_id=$1 AND wp_id=$2 AND attempt=0 ORDER BY channel', [wf, 'wp-a'])
    expect(rows.rows).toEqual([{ channel: 'security', outcome: 'skipped' }, { channel: 'tc', outcome: 'passed' }])
    const ev = await pool.query("SELECT COUNT(*)::int n FROM manager_events WHERE session_id=$1 AND event_type='wp.verified'", [wf])
    expect(ev.rows[0].n).toBe(2)
    const ob = await pool.query('SELECT COUNT(*)::int n FROM manager_outbox o JOIN manager_events e ON o.event_id=e.event_id WHERE e.session_id=$1', [wf])
    expect(ob.rows[0].n).toBe(2)
  })

  it('evidenceForWorkflow returns Map<wpId, ChannelOutcome[]>', async () => {
    const repo = new ReleaseGateRepo(pool)
    const m = await repo.evidenceForWorkflow(wf)
    expect(m.get('wp-a')).toContainEqual({ channel: 'tc', outcome: 'passed' })
  })

  it('recordGate persists release_gates + events + outbox; same version idempotent (no double emit)', async () => {
    const repo = new ReleaseGateRepo(pool)
    const result = { status: 'blocked' as const, perWp: [{ wpId: 'wp-a', proven: false, unverifiable: true, missingChannels: [] }], blockingReasons: ['wp wp-a: 검증 증거 없음'] }
    const first = await repo.recordGate('wf-rg-gate-1', 'v-abc', result)
    expect(first).not.toBeNull()
    const dup = await repo.recordGate('wf-rg-gate-1', 'v-abc', result)
    expect(dup).toBeNull()
    const rows = await pool.query('SELECT status FROM release_gates WHERE workflow_id=$1 AND gate_version=$2', ['wf-rg-gate-1', 'v-abc'])
    expect(rows.rows).toEqual([{ status: 'blocked' }])
    const ev = await pool.query("SELECT COUNT(*)::int n FROM manager_events WHERE session_id='wf-rg-gate-1' AND event_type='gate.blocked'", [])
    expect(ev.rows[0].n).toBe(1)
  })
})
