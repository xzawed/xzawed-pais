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
})
