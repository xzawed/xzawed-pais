import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Pool } from 'pg'
import { createPool, runMigrations, closePool } from '../src/db/pool.js'
import { RiskClassificationRepo } from '../src/db/risk-classification.repo.js'
import { TaskGraphRepo } from '../src/db/task-graph.repo.js'
import { buildRiskApprovedHandler, type RiskApprovedMessage } from '../src/streams/risk-consumer.js'
import { meetsMinRisk } from '../src/streams/verify.js'
import { scoreClassification } from '@xzawed/agent-streams'
import type { WorkPackage } from '@xzawed/agent-streams'

// CI(turborepo 잡)는 TEST_DATABASE_URL을 주입 — 게이트 통일(risk-classification 통합 패턴).
const url = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL']

/** MEDIUM risk WP 팩토리. risk.approved 핸들러가 HIGH로 write-back하는 before 상태 생성용. */
function wp(id: string): WorkPackage {
  return {
    id,
    storyId: 's1',
    epicId: null,
    owningRole: 'developer',
    inputs: [],
    outputs: [],
    oracleRef: null,
    acceptanceCriteria: ['x'],
    dependencies: [],
    risk: 'MEDIUM',
    attributionCounters: { impl: 0, task: 0, plan: 0 },
    status: 'draft',
  } as WorkPackage
}

// P2r-4 E2E 통합 — classify→approve→write-back→mutation 게이트 활성 실증.
// DB URL 없으면 skip. prefix 'wf-rr-' 스코프 정리.
describe.skipIf(!url)('P2r-4 risk routing (integration)', () => {
  let pool: Pool

  beforeAll(async () => {
    pool = createPool(url!)
    await runMigrations(pool)
  })

  afterAll(async () => {
    await pool
      .query("DELETE FROM manager_outbox WHERE message::text LIKE '%wf-rr-%'")
      .catch(() => undefined)
    await pool
      .query("DELETE FROM manager_events WHERE session_id LIKE 'wf-rr-%'")
      .catch(() => undefined)
    await pool
      .query("DELETE FROM risk_classifications WHERE workflow_id LIKE 'wf-rr-%'")
      .catch(() => undefined)
    await pool
      .query("DELETE FROM task_graphs WHERE workflow_id LIKE 'wf-rr-%'")
      .catch(() => undefined)
    await closePool()
  })

  it('classify(HIGH)→approve→write-back→wp.risk=HIGH→mutation 게이트 활성', async () => {
    const riskRepo = new RiskClassificationRepo(pool)
    const graphRepo = new TaskGraphRepo(pool)
    const wf = `wf-rr-${Date.now()}`

    // HIPAA 컴플라이언스 claim(support 3 → confidenceFromSupport(3)=1 → noisy-OR 1 ≥ 0.67=HIGH).
    const classification = scoreClassification({
      projectId: 'p',
      complianceFrameworks: ['HIPAA'],
      claims: [{ text: 'PHI', dimension: 'compliance', support: 3, citations: ['a', 'b', 'c'] }],
    })
    // combineRisk: compliance 차원 점수 1 ≥ HIGH_SCORE_THRESHOLD(0.67) → HIGH.
    expect(classification.risk).toBe('HIGH')

    // 1) HIGH 분류 영속(pending) + 그래프 생성(WP risk=MEDIUM).
    await riskRepo.upsert({ workflowId: wf, classification })
    await graphRepo.upsertGraph({ workflowId: wf, workPackages: [wp('a'), wp('b')] })

    // before: WP risk=MEDIUM → meetsMinRisk('MEDIUM','HIGH') = false(mutation 게이트 비활성).
    const before = await graphRepo.getGraph(wf)
    expect(before?.workPackages[0]?.risk).toBe('MEDIUM')
    expect(meetsMinRisk(before!.workPackages[0]!.risk, 'HIGH')).toBe(false)

    // 2) 사람 승인 → risk.approved 이벤트(아웃박스) 발행.
    const res = await riskRepo.approve(wf, 'alice')
    expect(res).not.toBeNull()

    // 3) risk.approved 핸들러 소비 → write-back(updateWpRisks).
    const handler = buildRiskApprovedHandler({ graphStore: graphRepo })
    await handler({
      envelope: { workflowId: wf } as never,
      type: 'risk.approved',
      payload: {
        workflowId: wf,
        projectId: 'p',
        risk: classification.risk,
        version: 1,
        modelRouting: classification.modelRouting,
      },
    } as RiskApprovedMessage)

    // after: 모든 WP risk=HIGH → meetsMinRisk('HIGH','HIGH') = true(mutation 게이트 활성).
    const after = await graphRepo.getGraph(wf)
    expect(after).not.toBeNull()
    expect(after!.workPackages).toHaveLength(2)
    expect(after!.workPackages.every((w) => w.risk === 'HIGH')).toBe(true)
    expect(meetsMinRisk(after!.workPackages[0]!.risk, 'HIGH')).toBe(true)
  })
})
