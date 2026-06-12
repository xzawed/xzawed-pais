import { describe, test, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { Pool } from 'pg'
import { runMigrations } from '../src/db/pool.js'
import { AdvisoryRepo } from '../src/db/advisory.repo.js'
import type { AdvisoryFinding } from '../src/db/advisory.types.js'

const url = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL']
const d = url ? describe : describe.skip

const f = (rank: number): AdvisoryFinding => ({
  rank, title: `t${rank}`, rationale: `r${rank}`, severity: 'advisory', sourceLens: 'optimization',
})

d('AdvisoryRepo (pg)', () => {
  let pool: Pool
  beforeAll(async () => { pool = new Pool({ connectionString: url }); await runMigrations(pool) })
  afterEach(async () => {
    await pool.query(`DELETE FROM advisory_findings WHERE workflow_id LIKE 'wf-adv-%'`)
    await pool.query(`DELETE FROM manager_outbox WHERE event_id IN (SELECT event_id FROM manager_events WHERE session_id LIKE 'wf-adv-%')`)
    await pool.query(`DELETE FROM manager_events WHERE session_id LIKE 'wf-adv-%'`)
  })
  afterAll(async () => { await pool.end() })

  test('recordFindings는 advisory_findings + manager_events + manager_outbox를 단일 tx로 적재한다', async () => {
    const repo = new AdvisoryRepo(pool)
    await repo.recordFindings('wf-adv-1', 'wp-1', 0, [f(1), f(2)])

    const found = await repo.findingsByWorkflow('wf-adv-1')
    expect(found.map((x) => x.rank)).toEqual([1, 2])

    const ev = await pool.query(`SELECT event_type, actor FROM manager_events WHERE session_id = 'wf-adv-1'`)
    expect(ev.rows).toHaveLength(1)
    expect(ev.rows[0].event_type).toBe('wp.advisory.found')
    expect(ev.rows[0].actor).toBe('advisory-lens')

    const ob = await pool.query(
      `SELECT stream FROM manager_outbox o JOIN manager_events e ON o.event_id = e.event_id WHERE e.session_id = 'wf-adv-1'`,
    )
    expect(ob.rows).toHaveLength(1)
    expect(ob.rows[0].stream).toBe('manager:advisory:main')
  })

  test('같은 (wf,wpId,attempt,rank) 재삽입은 멱등(ON CONFLICT DO NOTHING)', async () => {
    const repo = new AdvisoryRepo(pool)
    await repo.recordFindings('wf-adv-2', 'wp-1', 0, [f(1)])
    await repo.recordFindings('wf-adv-2', 'wp-1', 0, [f(1)]) // 재삽입
    const found = await repo.findingsByWorkflow('wf-adv-2')
    expect(found).toHaveLength(1)
  })

  test('빈 findings면 no-op(이벤트 미발행)', async () => {
    const repo = new AdvisoryRepo(pool)
    await repo.recordFindings('wf-adv-3', 'wp-1', 0, [])
    const ev = await pool.query(`SELECT 1 FROM manager_events WHERE session_id = 'wf-adv-3'`)
    expect(ev.rows).toHaveLength(0)
  })
})
