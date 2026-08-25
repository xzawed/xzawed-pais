import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { runMigrations } from '../db/pool.js'
import { WpOutputRepo, MAX_WP_OUTPUTS } from '../db/wp-output.repo.js'

const url = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL']
const d = url ? describe : describe.skip

d('WpOutputRepo (pg)', () => {
  let pool: Pool
  const wf = 'wf-out-1'
  beforeAll(async () => { pool = new Pool({ connectionString: url }); await runMigrations(pool) })
  afterAll(async () => {
    await pool.query('DELETE FROM wp_outputs WHERE workflow_id LIKE $1', ['wf-out-%'])
    await pool.end()
  })

  it('record 는 upsert 다 — 재시도 성공이 옛 산출물을 덮는다', async () => {
    const repo = new WpOutputRepo(pool)
    await repo.record({ workflowId: wf, wpId: 'wp-a', artifacts: ['old.ts'], tenantId: null })
    await repo.record({ workflowId: wf, wpId: 'wp-a', artifacts: ['new.ts', 'new2.ts'], tenantId: null })
    expect(await repo.unionFor(wf, ['wp-a'])).toEqual(['new.ts', 'new2.ts'])
  })

  it('unionFor 는 여러 선행의 산출물을 합치고 중복을 지운다', async () => {
    const repo = new WpOutputRepo(pool)
    await repo.record({ workflowId: wf, wpId: 'wp-b', artifacts: ['shared.ts', 'b.ts'], tenantId: null })
    await repo.record({ workflowId: wf, wpId: 'wp-c', artifacts: ['shared.ts', 'c.ts'], tenantId: null })
    const union = await repo.unionFor(wf, ['wp-b', 'wp-c'])
    expect(union).toHaveLength(3)
    expect(new Set(union)).toEqual(new Set(['shared.ts', 'b.ts', 'c.ts']))
  })

  it('빈 목록이면 왕복 없이 빈 배열이다', async () => {
    expect(await new WpOutputRepo(pool).unionFor(wf, [])).toEqual([])
  })

  it('기록이 없는 선행은 조용히 빠진다(후행이 죽지 않는다)', async () => {
    expect(await new WpOutputRepo(pool).unionFor(wf, ['wp-none'])).toEqual([])
  })

  /** 대규모 변경 하나가 후행 전체의 입력을 부풀리지 않게 한다. */
  it('산출물 수는 상한을 넘지 않는다', async () => {
    const repo = new WpOutputRepo(pool)
    const many = Array.from({ length: MAX_WP_OUTPUTS + 50 }, (_, i) => `f${i}.ts`)
    await repo.record({ workflowId: wf, wpId: 'wp-big', artifacts: many, tenantId: null })
    expect(await repo.unionFor(wf, ['wp-big'])).toHaveLength(MAX_WP_OUTPUTS)
  })

  it('빈 산출물도 기록한다 — "낸 것이 없었다"도 사실이다', async () => {
    const repo = new WpOutputRepo(pool)
    await repo.record({ workflowId: wf, wpId: 'wp-empty', artifacts: [], tenantId: 'tenant-1' })
    const { rows } = await pool.query<{ tenant_id: string | null }>(
      'SELECT tenant_id FROM wp_outputs WHERE workflow_id=$1 AND wp_id=$2', [wf, 'wp-empty'],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.tenant_id).toBe('tenant-1')
  })
})
