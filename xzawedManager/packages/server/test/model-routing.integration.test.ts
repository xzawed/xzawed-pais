import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { Pool } from 'pg'
import { createPool, runMigrations, closePool } from '../src/db/pool.js'
import { RiskClassificationRepo } from '../src/db/risk-classification.repo.js'
import { TaskGraphRepo } from '../src/db/task-graph.repo.js'
import { handleWpDispatchSignal } from '../src/streams/worker.js'
import { scoreClassification } from '@xzawed/agent-streams'
import type { WorkPackage } from '@xzawed/agent-streams'

// CI(turborepo 잡)는 TEST_DATABASE_URL을 주입 — 게이트 통일(risk-routing 통합 패턴).
const url = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL']

/** develop_code WP 팩토리. owningRole=developer → ROLE_TO_AGENT['developer']='Developer' → modelRouting.Developer 조회. */
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
    risk: 'HIGH',
    attributionCounters: { impl: 0, task: 0, plan: 0 },
    status: 'draft',
  } as WorkPackage
}

/** dispatch_signal 메시지 팩토리(execution-worker 통합 패턴). */
function dispatchSignal(wf: string, wpId: string, attempt: number) {
  return {
    envelope: {
      eventId: '1',
      correlationId: wf,
      causationId: null,
      workflowId: wf,
      stepId: `wp.dispatch_signal:${wpId}`,
      attemptId: attempt,
      idempotencyKey: `${wf}:wp.dispatch_signal:${wpId}:${attempt}`,
      occurredAt: 1,
    },
    type: 'wp.dispatch_signal' as const,
    payload: { wpId, attempt },
  }
}

// D5 E2E 통합 — 승인 HIGH 분류 → 워커가 opus concrete id 해석 → buildWorkerInput.model=opus.
// DB URL 없으면 skip. prefix 'wf-d5-' 스코프 정리.
describe.skipIf(!url)('D5 model routing (integration)', () => {
  let pool: Pool

  beforeAll(async () => {
    pool = createPool(url!)
    await runMigrations(pool)
  })

  afterAll(async () => {
    await pool
      .query("DELETE FROM manager_outbox WHERE message::text LIKE '%wf-d5-%'")
      .catch(() => undefined)
    await pool
      .query("DELETE FROM manager_events WHERE session_id LIKE 'wf-d5-%'")
      .catch(() => undefined)
    await pool
      .query("DELETE FROM risk_classifications WHERE workflow_id LIKE 'wf-d5-%'")
      .catch(() => undefined)
    await pool
      .query("DELETE FROM task_graphs WHERE workflow_id LIKE 'wf-d5-%'")
      .catch(() => undefined)
    await closePool()
  })

  it('승인 HIGH 분류 → 워커가 opus id를 develop_code 입력에 주입', async () => {
    const riskRepo = new RiskClassificationRepo(pool)
    const graphRepo = new TaskGraphRepo(pool)
    const wf = `wf-d5-${Date.now()}`

    // HIPAA 컴플라이언스 claim(support 3 → confidence 1 → HIGH). §5 HIGH→modelRouting 전부 opus.
    const classification = scoreClassification({
      projectId: 'p',
      complianceFrameworks: ['HIPAA'],
      claims: [{ text: 'PHI', dimension: 'compliance', support: 3, citations: ['a', 'b', 'c'] }],
    })
    expect(classification.risk).toBe('HIGH')
    // §5 HIGH → Developer=opus(라우팅 결정론 단언).
    expect(classification.modelRouting.Developer).toBe('opus')

    // 1) 분류 영속(pending) + 사람 승인(→ approved·N6 라우팅 확정).
    await riskRepo.upsert({ workflowId: wf, classification })
    const approveResult = await riskRepo.approve(wf, 'alice')
    expect(approveResult).not.toBeNull()

    // 2) develop_code WP가 있는 그래프 영속.
    await graphRepo.upsertGraph({ workflowId: wf, workPackages: [wp('wpd')] })

    // 3) dispatch_signal 처리 — riskStore+modelRouting 주입 시 D5 경로 활성.
    const captured: Record<string, unknown>[] = []
    const handler = {
      execute: vi.fn().mockImplementation((input: unknown) => {
        captured.push(input as Record<string, unknown>)
        return Promise.resolve({ success: true })
      }),
    }

    const out = await handleWpDispatchSignal(
      dispatchSignal(wf, 'wpd', 0),
      {
        repo: graphRepo,
        handlers: { develop_code: handler },
        publish: async () => '1-0',
        riskStore: riskRepo,
        modelRouting: { opus: 'claude-opus-4-8', sonnet: 'claude-sonnet-4-6' },
      },
    )

    // 워커 완료(wp.completion 발행 직전까지).
    expect(out).toMatchObject({ status: 'completed', wpId: 'wpd' })

    // D5 핵심: buildWorkerInput이 routedModel='claude-opus-4-8'을 주입.
    expect(captured[0]).toMatchObject({ model: 'claude-opus-4-8' })
  })
})
