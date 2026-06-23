import { describe, test, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { Pool } from 'pg'
import { runMigrations } from '../src/db/pool.js'
import { OracleRepo } from '../src/db/oracle.repo.js'
import { oracleIdFor } from '../src/db/oracle.types.js'

const url = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL']
const d = url ? describe : describe.skip

d('OracleRepo.approvedGoldensForStory (pg)', () => {
  let pool: Pool
  beforeAll(async () => { pool = new Pool({ connectionString: url }); await runMigrations(pool) })
  afterEach(async () => { await pool.query(`DELETE FROM oracles WHERE workflow_id LIKE 'wf-gold-%'`) })
  afterAll(async () => { await pool.end() })

  test('approved 오라클의 golden_refs를 반환(pending이면 null)', async () => {
    const repo = new OracleRepo(pool)
    const oracleId = oracleIdFor('wf-gold-1', 'story-1')
    await repo.upsert({
      oracleId, workflowId: 'wf-gold-1', storyId: 'story-1', version: 1, status: 'pending',
      scenarios: [], invariants: [],
      goldenRefs: [{ id: 'g1', inputFixture: 'in', normalizedOutput: 'out', normalizers: [], frozenAt: '', frozenBy: 'po', fromDecision: null, version: 1 }],
      coverage: {},
    })
    expect(await repo.approvedGoldensForStory('wf-gold-1', 'story-1')).toBeNull()
    await repo.approve(oracleId, 'po')
    const goldens = await repo.approvedGoldensForStory('wf-gold-1', 'story-1')
    expect(goldens).not.toBeNull()
    expect(goldens?.[0].normalizedOutput).toBe('out')
  })

  test('golden_refs 빈 배열이면 null', async () => {
    const repo = new OracleRepo(pool)
    const oracleId = oracleIdFor('wf-gold-2', 'story-1')
    await repo.upsert({ oracleId, workflowId: 'wf-gold-2', storyId: 'story-1', version: 1, status: 'pending', scenarios: [], invariants: [], goldenRefs: [], coverage: {} })
    await repo.approve(oracleId, 'po')
    expect(await repo.approvedGoldensForStory('wf-gold-2', 'story-1')).toBeNull()
  })

  // Slice 1: draft golden(frozenBy=null) → freezeGoldensByWorkflow(사람 사인오프) → impact 소비(N7) 루프 실증.
  test('draft golden(frozenBy=null·approved) → freezeGoldensByWorkflow → approvedGoldensForStory 반환(frozen·N7)', async () => {
    const repo = new OracleRepo(pool)
    const oracleId = oracleIdFor('wf-gold-3', 'story-1')
    await repo.upsert({
      oracleId, workflowId: 'wf-gold-3', storyId: 'story-1', version: 1, status: 'approved',
      scenarios: [], invariants: [],
      goldenRefs: [{ id: 'g1', inputFixture: 'in', normalizedOutput: 'out', normalizers: [], frozenAt: '', frozenBy: null, fromDecision: null, version: 1 }],
      coverage: {},
    })
    // frozenBy=null이라 impact는 아직 미소비(N7) — 사인오프 전엔 ground-truth 아님.
    expect(await repo.approvedGoldensForStory('wf-gold-3', 'story-1')).toBeNull()
    expect(await repo.unfrozenGoldenCount('wf-gold-3')).toBe(1)
    const res = await repo.freezeGoldensByWorkflow('wf-gold-3', 'alice')
    expect(res.frozen).toBe(1)
    const goldens = await repo.approvedGoldensForStory('wf-gold-3', 'story-1')
    expect(goldens?.length).toBe(1)
    expect(goldens?.[0].frozenBy).toBe('alice')
    expect(await repo.unfrozenGoldenCount('wf-gold-3')).toBe(0) // 멱등: 재freeze 대상 없음
  })
})
