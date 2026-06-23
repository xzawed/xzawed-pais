import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { runMigrations } from '../db/pool.js'
import { OracleRepo } from '../db/oracle.repo.js'

const DB = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL']
const d = DB ? describe : describe.skip

let pool: Pool

beforeAll(async () => {
  if (!DB) return
  pool = new Pool({ connectionString: DB })
  await runMigrations(pool)
})

afterAll(async () => {
  if (!DB) return
  // FK 순서: outbox → events → oracles
  await pool.query("DELETE FROM manager_outbox WHERE message::text LIKE '%wf-c3-%'").catch(() => undefined)
  await pool.query("DELETE FROM manager_events WHERE session_id LIKE 'wf-c3-%'").catch(() => undefined)
  await pool.query("DELETE FROM oracles WHERE workflow_id LIKE 'wf-c3-%'").catch(() => undefined)
  await pool.end()
})

d('OracleRepo.approvePendingByWorkflow', () => {
  it('pending 오라클 전부 승인하고 카운트 반환', async () => {
    const wf = 'wf-c3-approve'
    const repo = new OracleRepo(pool)

    // 두 story pending 오라클 생성
    await repo.upsertDraft({
      workflowId: wf,
      storyId: 's1',
      scenarios: [{ id: 's1-sc1', title: 'Given-When-Then 1', given: [], when: 'user acts', thenSteps: ['system responds'], status: 'drafted' }],
      coverage: { ac1: ['s1-sc1'] },
    })
    await repo.upsertDraft({
      workflowId: wf,
      storyId: 's2',
      scenarios: [{ id: 's2-sc1', title: 'Given-When-Then 2', given: [], when: 'user acts again', thenSteps: ['system responds again'], status: 'drafted' }],
      coverage: { ac2: ['s2-sc1'] },
    })

    // 배치 승인 실행
    const r = await repo.approvePendingByWorkflow(wf, 'user-1')
    expect(r.approved).toBe(2)

    // pending이 남아 있으면 안 됨
    expect(await repo.listByWorkflow(wf, 'pending')).toHaveLength(0)

    // approved 상태 오라클이 ≥2개
    expect((await repo.approvedByWorkflow(wf)).length).toBeGreaterThanOrEqual(2)
  })

  it('pending 없으면 approved=0 반환', async () => {
    const wf = 'wf-c3-empty'
    const repo = new OracleRepo(pool)
    const r = await repo.approvePendingByWorkflow(wf, 'user-1')
    expect(r.approved).toBe(0)
  })

  it('이미 approved된 오라클은 재승인 안 함(멱등)', async () => {
    const wf = 'wf-c3-idempotent'
    const repo = new OracleRepo(pool)

    await repo.upsertDraft({
      workflowId: wf,
      storyId: 's1',
      scenarios: [{ id: 'sc1', title: '', given: [], when: '', thenSteps: [], status: 'drafted' }],
      coverage: {},
    })

    // 첫 배치 승인
    const r1 = await repo.approvePendingByWorkflow(wf, 'user-1')
    expect(r1.approved).toBe(1)

    // 두 번째 배치 승인 — pending 없으므로 0
    const r2 = await repo.approvePendingByWorkflow(wf, 'user-1')
    expect(r2.approved).toBe(0)
  })
})
