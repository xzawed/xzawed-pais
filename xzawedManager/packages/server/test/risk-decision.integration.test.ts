import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Pool } from 'pg'
import { createPool, runMigrations, closePool } from '../src/db/pool.js'
import { RiskClassificationRepo } from '../src/db/risk-classification.repo.js'
import { DecisionRepo } from '../src/db/decision.repo.js'
import { buildRiskBrief } from '../src/streams/risk-brief.js'
import { buildDecisionRecordedHandler } from '../src/streams/decision-consumer.js'
import { scoreClassification } from '@xzawed/agent-streams'

// CI(turborepo 잡)는 TEST_DATABASE_URL을 주입 — 게이트 통일(risk-classification·decision 통합 패턴).
const url = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL']

// C5 E2E 루프를 실 Postgres로 실증: classify(HIGH)→DecisionRequest→approve→RiskClassificationRepo.approve→status approved.
// DB URL 없으면 skip. prefix 'wf-c5-' 스코프 정리(형제 통합 테스트 병렬 간섭 방지).
describe.skipIf(!url)('C5 risk decision (integration)', () => {
  let pool: Pool

  beforeAll(async () => {
    pool = createPool(url!)
    await runMigrations(pool)
  })

  afterAll(async () => {
    // FK 순서: sign_offs→human_decisions→decision_requests, manager_outbox·manager_events·risk_classifications 독립.
    await pool
      .query(
        `DELETE FROM human_decisions WHERE request_id IN
           (SELECT request_id FROM decision_requests WHERE workflow_id LIKE 'wf-c5-%')`,
      )
      .catch(() => undefined)
    await pool
      .query("DELETE FROM decision_requests WHERE workflow_id LIKE 'wf-c5-%'")
      .catch(() => undefined)
    await pool
      .query("DELETE FROM risk_classifications WHERE workflow_id LIKE 'wf-c5-%'")
      .catch(() => undefined)
    await pool
      .query("DELETE FROM manager_outbox WHERE message::text LIKE '%wf-c5-%'")
      .catch(() => undefined)
    await pool
      .query("DELETE FROM manager_events WHERE session_id LIKE 'wf-c5-%'")
      .catch(() => undefined)
    await closePool()
  })

  it('classify(HIGH)→DecisionRequest→approve→RiskClassificationRepo.approve→status approved', async () => {
    const riskRepo = new RiskClassificationRepo(pool)
    const decisionRepo = new DecisionRepo(pool)
    const wf = 'wf-c5-1'

    // HIPAA 컴플라이언스 claim: support 3 → confidenceFromSupport(3)=1 → compliance noisy-OR 1 ≥ HIGH_SCORE_THRESHOLD(0.67) → HIGH.
    const classification = scoreClassification({
      projectId: 'p',
      complianceFrameworks: ['HIPAA'],
      claims: [{ text: 'PHI', dimension: 'compliance', support: 3, citations: ['a', 'b', 'c'] }],
    })
    expect(classification.humanGate.required).toBe(true)

    // 1) 분류 영속(pending).
    const { version } = await riskRepo.upsert({ workflowId: wf, classification })

    // 생산자 발행 대리: DecisionRequest 생성.
    await decisionRepo.createRequest(buildRiskBrief({ workflowId: wf, version, classification }))
    const pending = await decisionRepo.pendingByProject('p')
    expect(
      pending.some((d) => d.type === 'risk_classification' && d.requestId === `${wf}:risk:${version}`),
    ).toBe(true)

    // 2) 사람 승인 기록 → RESOLVED 전이.
    await decisionRepo.recordDecision({
      decisionId: `${wf}:risk:${version}:approve`,
      requestId: `${wf}:risk:${version}`,
      decidedBy: 'alice',
      choice: 'approve',
      routedTo: 'risk_approve',
    })

    // 3) decision.recorded 소비 → riskStore.approve → risk_classifications status=approved.
    const handler = buildDecisionRecordedHandler({
      decisionStore: decisionRepo,
      leaseStore: {} as never,
      publish: async () => undefined,
      visibilityMs: 1000,
      riskStore: riskRepo,
    } as never)
    await handler({
      envelope: { workflowId: wf } as never,
      type: 'decision.recorded',
      payload: {
        requestId: `${wf}:risk:${version}`,
        choice: 'approve',
        decisionId: `${wf}:risk:${version}:approve`,
        decidedBy: 'alice',
      },
    } as never)

    // 4) 최종 상태 검증: status=approved.
    const stored = await riskRepo.getByWorkflow(wf)
    expect(stored?.status).toBe('approved')
  })
})
