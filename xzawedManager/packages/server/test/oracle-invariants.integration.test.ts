import { describe, test, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { Pool } from 'pg'
import { runMigrations } from '../src/db/pool.js'
import { OracleRepo } from '../src/db/oracle.repo.js'
import { oracleIdFor } from '../src/db/oracle.types.js'

const url = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL']
const d = url ? describe : describe.skip

// F5: approve()가 scenarios와 동형으로 invariant draft를 human_approved로 전이한다(이전 계약은 미전이).
// upsertDraft(drafted) → approve(전이) → approvedInvariantsForStory 반환의 property 채널 활성 루프를 실증.
d('OracleRepo invariant 초안→승인 루프 (F5·pg)', () => {
  let pool: Pool
  beforeAll(async () => { pool = new Pool({ connectionString: url }); await runMigrations(pool) })
  afterEach(async () => { await pool.query(`DELETE FROM oracles WHERE workflow_id LIKE 'wf-inv-%'`) })
  afterAll(async () => { await pool.end() })

  test('upsertDraft(drafted) → approve가 invariant를 human_approved 전이 → approvedInvariantsForStory 반환(F5 신규 계약)', async () => {
    const repo = new OracleRepo(pool)
    const oracleId = oracleIdFor('wf-inv-1', 'story-1')
    await repo.upsertDraft({
      workflowId: 'wf-inv-1', storyId: 'story-1', scenarios: [], coverage: {},
      invariants: [{ id: 'i1', statement: 's', domain: 'd', property: 'p', status: 'drafted' }],
    })
    // pending이면 승인 invariant 0 → null
    expect(await repo.approvedInvariantsForStory('wf-inv-1', 'story-1')).toBeNull()
    await repo.approve(oracleId, 'po')
    const invs = await repo.approvedInvariantsForStory('wf-inv-1', 'story-1')
    expect(invs).not.toBeNull()
    expect(invs?.length).toBe(1)
    expect(invs?.[0].id).toBe('i1')
    expect(invs?.[0].status).toBe('human_approved')
  })

  test('approve는 drafted만 전이(rejected invariant는 미전이·미반환)', async () => {
    const repo = new OracleRepo(pool)
    const oracleId = oracleIdFor('wf-inv-2', 'story-1')
    await repo.upsert({
      oracleId, workflowId: 'wf-inv-2', storyId: 'story-1', version: 1, status: 'pending',
      scenarios: [], goldenRefs: [],
      invariants: [
        { id: 'i1', statement: 's', domain: 'd', property: 'p', status: 'drafted' },
        { id: 'i2', statement: 's2', domain: 'd2', property: 'p2', status: 'rejected' },
      ],
      coverage: {},
    })
    await repo.approve(oracleId, 'po')
    const invs = await repo.approvedInvariantsForStory('wf-inv-2', 'story-1')
    expect(invs?.length).toBe(1)
    expect(invs?.[0].id).toBe('i1') // i2(rejected)는 미반환
  })
})
