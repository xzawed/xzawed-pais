import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
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
    status: 'DRAFTED',
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

  /**
   * **이 테스트는 F2 를 기대값으로 박아두고 있었다**(`every((w) => w.risk === 'HIGH')`).
   * 프로젝트 등급 하나가 전 WP 에 찍히는 것이 정상이라고 단언했으니, 결함이 고쳐지면
   * 이 테스트가 깨지는 것이 맞다. `S5.3b` 에서 사슬 전체를 WP 별로 다시 세운다.
   */
  it('classify→approve→write-back 이 WP 별로 간다(지목된 WP 만 mutation 게이트 활성)', async () => {
    const riskRepo = new RiskClassificationRepo(pool)
    const graphRepo = new TaskGraphRepo(pool)
    const wf = `wf-rr-${Date.now()}`

    // HIPAA 컴플라이언스 claim(support 3 → confidenceFromSupport(3)=1 → noisy-OR 1 ≥ 0.67=HIGH)을
    // **WP 'a' 에만 지목**한다. 'b' 는 그 위험을 안 받는다 — 그것이 이 슬라이스의 값이다.
    const classification = scoreClassification({
      projectId: 'p',
      complianceFrameworks: ['HIPAA'],
      claims: [{ text: 'PHI', dimension: 'compliance', support: 3, citations: ['a', 'b', 'c'], wpIds: ['a'] }],
      workPackageIds: ['a', 'b'],
    })
    // 프로젝트 종합은 여전히 HIGH(모델 라우팅·사람 게이트의 입력).
    expect(classification.risk).toBe('HIGH')
    // WP 판정은 갈린다. 'b' 는 컴플라이언스 바닥(MEDIUM)까지만 — 감지된 프레임워크는 프로젝트 사실이다.
    expect(classification.wpRisks).toEqual({ a: 'HIGH', b: 'MEDIUM' })

    // 1) 분류 영속(pending) + 그래프 생성(WP risk=MEDIUM).
    await riskRepo.upsert({ workflowId: wf, classification })
    await graphRepo.upsertGraph({ workflowId: wf, workPackages: [wp('a'), wp('b')] })

    // before: WP risk=MEDIUM → meetsMinRisk('MEDIUM','HIGH') = false(mutation 게이트 비활성).
    const before = await graphRepo.getGraph(wf)
    expect(before?.workPackages[0]?.risk).toBe('MEDIUM')
    expect(meetsMinRisk(before!.workPackages[0]!.risk, 'HIGH')).toBe(false)

    // 2) 사람 승인 → risk.approved 이벤트(아웃박스) 발행. 페이로드가 wpRisks 를 실어야 한다.
    const res = await riskRepo.approve(wf, 'alice')
    expect(res).not.toBeNull()
    const { rows } = await pool.query<{ message: { payload: { wpRisks: Record<string, string> } } }>(
      'SELECT message FROM manager_outbox WHERE message::text LIKE $1', [`%${wf}%`],
    )
    expect(rows[0]?.message.payload.wpRisks, '아웃박스가 WP 판정을 안 실어 보냈다').toEqual({ a: 'HIGH', b: 'MEDIUM' })

    // 3) risk.approved 핸들러 소비 → WP 별 write-back.
    const handler = buildRiskApprovedHandler({ graphStore: graphRepo })
    await handler({
      envelope: { workflowId: wf } as never,
      type: 'risk.approved',
      payload: {
        workflowId: wf,
        projectId: 'p',
        risk: classification.risk,
        wpRisks: classification.wpRisks,
        version: 1,
        modelRouting: classification.modelRouting,
      },
    } as RiskApprovedMessage)

    // after: 지목된 'a' 만 HIGH → mutation 게이트가 **WP 별로** 갈린다. 예전에는 둘 다 HIGH 였다.
    const after = await graphRepo.getGraph(wf)
    const byId = new Map(after!.workPackages.map((w) => [w.id, w]))
    expect(after!.workPackages).toHaveLength(2)
    expect(byId.get('a')!.risk).toBe('HIGH')
    expect(byId.get('b')!.risk, 'b 가 프로젝트 최댓값을 물려받았다(F2 재발)').toBe('MEDIUM')
    expect(meetsMinRisk(byId.get('a')!.risk, 'HIGH')).toBe(true)
    expect(meetsMinRisk(byId.get('b')!.risk, 'HIGH')).toBe(false)
  })

  /**
   * **구 아티팩트는 fail-closed 여야 한다.** 변경 전에 영속된 pending 분류에는 WP 판정이 없다 —
   * 그때 아무것도 안 쓰면 사람이 HIGH 로 승인했는데도 전 WP 가 MEDIUM 에 머물러 mutation
   * 게이트가 **조용히 꺼진다.** 처음에 그렇게 만들었다가 Grok 반증이 잡았다.
   */
  it('wpRisks 없는 구 이벤트는 프로젝트 등급을 전 WP 에 남긴다(폴백)', async () => {
    const graphRepo = new TaskGraphRepo(pool)
    const wf = `wf-rr-legacy-${Date.now()}`
    await graphRepo.upsertGraph({ workflowId: wf, workPackages: [wp('a'), wp('b')] })

    const log = vi.fn()
    await buildRiskApprovedHandler({ graphStore: graphRepo, log })({
      envelope: { workflowId: wf } as never,
      type: 'risk.approved',
      payload: { workflowId: wf, projectId: 'p', risk: 'HIGH', version: 1, modelRouting: {} },
    } as unknown as RiskApprovedMessage)

    const after = await graphRepo.getGraph(wf)
    expect(after!.workPackages.every((w) => w.risk === 'HIGH'), '승인된 HIGH 가 증발했다(fail-open)').toBe(true)
    expect(after!.workPackages.every((w) => meetsMinRisk(w.risk, 'HIGH'))).toBe(true)
    expect(log, '폴백이 전부를 덮은 사실은 소리 나야 한다').toHaveBeenCalled()
  })
})
