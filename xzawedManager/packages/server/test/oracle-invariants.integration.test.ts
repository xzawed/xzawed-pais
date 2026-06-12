import { describe, test, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { Pool } from 'pg'
import { runMigrations } from '../src/db/pool.js'
import { OracleRepo } from '../src/db/oracle.repo.js'
import { oracleIdFor } from '../src/db/oracle.types.js'

const url = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL']
const d = url ? describe : describe.skip

d('OracleRepo.approvedInvariantsForStory (pg)', () => {
  let pool: Pool
  beforeAll(async () => { pool = new Pool({ connectionString: url }); await runMigrations(pool) })
  afterEach(async () => { await pool.query(`DELETE FROM oracles WHERE workflow_id LIKE 'wf-inv-%'`) })
  afterAll(async () => { await pool.end() })

  test('approved 오라클의 human_approved invariants만 반환(drafted 제외·pending이면 null)', async () => {
    const repo = new OracleRepo(pool)
    const oracleId = oracleIdFor('wf-inv-1', 'story-1')
    // 설계: approve()는 scenario 항목만 전이하고 invariant 항목 상태는 전이하지 않는다(초안 생성기 없음·사람이
    // 직접 저작+승인). 따라서 invariant를 upsert 시점에 직접 status:'human_approved'로 시드한다.
    await repo.upsert({
      oracleId, workflowId: 'wf-inv-1', storyId: 'story-1', version: 1, status: 'pending',
      scenarios: [], goldenRefs: [],
      invariants: [
        { id: 'i1', statement: 's', domain: 'd', property: 'p', status: 'human_approved' },
        { id: 'i2', statement: 's2', domain: 'd2', property: 'p2', status: 'drafted' },
      ],
      coverage: {},
    })
    expect(await repo.approvedInvariantsForStory('wf-inv-1', 'story-1')).toBeNull() // pending → null
    await repo.approve(oracleId, 'po')
    const invs = await repo.approvedInvariantsForStory('wf-inv-1', 'story-1')
    expect(invs).not.toBeNull()
    expect(invs?.length).toBe(1)
    expect(invs?.[0].id).toBe('i1')
  })

  test('human_approved invariant 0개면 null', async () => {
    const repo = new OracleRepo(pool)
    const oracleId = oracleIdFor('wf-inv-2', 'story-1')
    await repo.upsert({
      oracleId, workflowId: 'wf-inv-2', storyId: 'story-1', version: 1, status: 'pending',
      scenarios: [], goldenRefs: [],
      invariants: [{ id: 'i1', statement: 's', domain: 'd', property: 'p', status: 'drafted' }],
      coverage: {},
    })
    expect(await repo.approve(oracleId, 'po')).not.toBeNull()
    expect(await repo.approvedInvariantsForStory('wf-inv-2', 'story-1')).toBeNull()
  })
})
