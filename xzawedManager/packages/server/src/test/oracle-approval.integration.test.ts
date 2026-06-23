import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { runMigrations } from '../db/pool.js'
import { OracleRepo } from '../db/oracle.repo.js'
import { DecisionRepo } from '../db/decision.repo.js'
import { handleDecompositionEmitted } from '../streams/decomposition-consumer.js'
import { buildDecisionRecordedHandler } from '../streams/decision-consumer.js'
import { makeEnvelope } from '@xzawed/agent-streams'

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
  // FK 순서: outbox → events → oracles, decision_requests
  await pool.query("DELETE FROM manager_outbox WHERE message::text LIKE '%wf-c3-%'").catch(() => undefined)
  await pool.query("DELETE FROM manager_events WHERE session_id LIKE 'wf-c3-%'").catch(() => undefined)
  await pool.query("DELETE FROM oracles WHERE workflow_id LIKE 'wf-c3-%'").catch(() => undefined)
  await pool.query("DELETE FROM decision_requests WHERE workflow_id LIKE 'wf-c3-%'").catch(() => undefined)
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

// C3 E2E 통합 테스트: 생산자(decomposition-consumer decisionStore)+소비자(DecisionRecordedConsumer oracleStore) 폐루프.
d('C3 oracle 승인 E2E (pg·wf-c3-e2e)', () => {
  it('handleDecompositionEmitted + decisionStore → oracle_approval 결정 요청 영속', async () => {
    const wf = 'wf-c3-e2e-producer'
    const oracleRepo = new OracleRepo(pool)
    const decisionRepo = new DecisionRepo(pool)

    const envelope = makeEnvelope({ workflowId: wf, correlationId: wf, causationId: null, stepId: 'decomposition.emitted', attemptId: 0 })
    const msg = {
      envelope,
      type: 'decomposition.emitted' as const,
      payload: {
        workPackages: [],
        oracleDrafts: [
          {
            storyId: 'e2e-s1',
            scenarios: [{ id: 'e2e-sc1', title: 'E2E scenario', given: [], when: 'user acts', thenSteps: ['system responds'], status: 'drafted' as const }],
            coverage: { ac1: ['e2e-sc1'] },
          },
        ],
      },
    }

    // 핵심 단언: createRequest가 oracle_approval DecisionRequest를 영속해야 함(C3 생산자).
    // noOp publish — inconsistent emit 없이 테스트 가능(WP 없으면 buildTaskGraph는 빈 그래프 정상 처리).
    await handleDecompositionEmitted(msg, {
      repo: {
        upsertGraph: async () => ({ version: 1 }),
        getGraph: async () => null,
      } as never,
      publish: async () => undefined,
      oracleStore: oracleRepo,
      decisionStore: decisionRepo,
    })

    // oracle_approval 결정 요청 영속 확인
    const request = await decisionRepo.getRequest(`${wf}:oracle`)
    expect(request).not.toBeNull()
    expect(request?.type).toBe('oracle_approval')
    expect(request?.workflowId).toBe(wf)
    expect(request?.status).toBe('pending')
  })

  it('buildDecisionRecordedHandler + oracleStore → pending 오라클 승인', async () => {
    const wf = 'wf-c3-e2e-consumer'
    const oracleRepo = new OracleRepo(pool)
    const decisionRepo = new DecisionRepo(pool)

    // pending 오라클 생성
    await oracleRepo.upsertDraft({
      workflowId: wf,
      storyId: 'e2e-story',
      scenarios: [{ id: 'sc-e2e', title: 'E2E', given: [], when: 'act', thenSteps: ['result'], status: 'drafted' }],
      coverage: {},
    })

    // oracle_approval 결정 요청 생성
    const requestId = `${wf}:oracle`
    await decisionRepo.createRequest({ requestId, type: 'oracle_approval', workflowId: wf, correlationId: wf })

    // decision.recorded 이벤트 핸들러 실행 (oracleStore 주입·소비자 경로)
    const handler = buildDecisionRecordedHandler({
      decisionStore: decisionRepo,
      leaseStore: { reopenLease: async () => ({ status: 'not_found' as const, attempt: 0 }) },
      publish: async () => undefined,
      visibilityMs: 300_000,
      oracleStore: oracleRepo,
    })

    const envelope = makeEnvelope({ workflowId: wf, correlationId: wf, causationId: null, stepId: 'decision.recorded', attemptId: 0 })
    await handler({
      envelope,
      type: 'decision.recorded',
      payload: { requestId, choice: 'approve', decisionId: `${requestId}:dec`, decidedBy: 'approver-1' },
    })

    // pending 오라클이 전부 승인됐는지 확인
    const approved = await oracleRepo.approvedByWorkflow(wf)
    expect(approved.length).toBeGreaterThanOrEqual(1)
    expect(await oracleRepo.listByWorkflow(wf, 'pending')).toHaveLength(0)
  })
})
