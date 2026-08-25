import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { runMigrations } from '../db/pool.js'
import { VerificationFailureRepo, FAILURE_BRIEF_LIMIT } from '../db/verification-failure.repo.js'

const url = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL']
const d = url ? describe : describe.skip

d('VerificationFailureRepo (pg)', () => {
  let pool: Pool
  const wf = 'wf-vf-1'
  beforeAll(async () => { pool = new Pool({ connectionString: url }); await runMigrations(pool) })
  afterAll(async () => {
    await pool.query('DELETE FROM wp_verification_failures WHERE workflow_id LIKE $1', ['wf-vf-%'])
    await pool.end()
  })

  it('record 는 attempt 단위로 멱등이고 첫 사유를 보존한다', async () => {
    const repo = new VerificationFailureRepo(pool)
    await repo.record({ workflowId: wf, wpId: 'wp-a', attempt: 0, reason: '첫 사유', tenantId: null })
    // reclaim 후 좀비 응답이 같은 attempt 로 다시 와도 원래 사유를 덮지 않는다.
    await repo.record({ workflowId: wf, wpId: 'wp-a', attempt: 0, reason: '나중 사유', tenantId: null })
    const rows = await repo.recentForWp(wf, 'wp-a')
    expect(rows).toEqual([{ attempt: 0, reason: '첫 사유' }])
  })

  it('recentForWp 는 attempt 오름차순으로 돌려주고 상한을 지킨다', async () => {
    const repo = new VerificationFailureRepo(pool)
    for (let a = 0; a < FAILURE_BRIEF_LIMIT + 3; a += 1) {
      await repo.record({ workflowId: wf, wpId: 'wp-b', attempt: a, reason: `사유 ${a}`, tenantId: null })
    }
    const rows = await repo.recentForWp(wf, 'wp-b')
    expect(rows).toHaveLength(FAILURE_BRIEF_LIMIT)
    // 최근 것을 남기되 사람이 읽는 순서(오름차순)로 준다.
    expect(rows.map((r) => r.attempt)).toEqual([3, 4, 5, 6, 7])
    expect(rows[0]!.reason).toBe('사유 3')
  })

  it('사유가 없는 WP 는 빈 배열이다(브리프가 이전 모양으로 나온다)', async () => {
    const repo = new VerificationFailureRepo(pool)
    expect(await repo.recentForWp(wf, 'wp-none')).toEqual([])
  })

  it('테넌트 태그를 함께 남긴다', async () => {
    const repo = new VerificationFailureRepo(pool)
    await repo.record({ workflowId: wf, wpId: 'wp-t', attempt: 0, reason: 'x', tenantId: 'tenant-1' })
    const { rows } = await pool.query<{ tenant_id: string | null }>(
      'SELECT tenant_id FROM wp_verification_failures WHERE workflow_id=$1 AND wp_id=$2', [wf, 'wp-t'],
    )
    expect(rows[0]!.tenant_id).toBe('tenant-1')
  })
})
