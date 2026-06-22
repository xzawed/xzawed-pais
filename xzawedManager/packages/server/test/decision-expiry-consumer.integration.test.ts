import { describe, it, expect } from 'vitest'
import { createPool, runMigrations, closePool } from '../src/db/pool.js'
import { DecisionRepo } from '../src/db/decision.repo.js'
import { buildDecisionExpiredHandler } from '../src/streams/decision-expiry-consumer.js'
import { DECISION_EXPIRED_EVENT } from '../src/db/decision.types.js'

// CI(turborepo 잡)는 TEST_DATABASE_URL을 주입 — 게이트 통일(decision/decision-routing 통합 패턴).
const url = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL']

/** 'wf-de-%' prefix 스코프 정리 — 형제 통합 테스트와의 병렬 간섭 방지. */
async function cleanup(pool: import('pg').Pool): Promise<void> {
  await pool.query("DELETE FROM manager_outbox WHERE event_id IN (SELECT event_id FROM manager_events WHERE session_id LIKE 'wf-de-%')").catch(() => undefined)
  await pool.query("DELETE FROM manager_events WHERE session_id LIKE 'wf-de-%'").catch(() => undefined)
  await pool.query("DELETE FROM decision_requests WHERE workflow_id LIKE 'wf-de-%'").catch(() => undefined)
}

describe.skipIf(!url)('B1 만료 결정 소비자: 재에스컬레이션→상한 종단 폐루프(pg)', () => {
  it('만료 blocking → reesc1 재생성(PENDING·expiresAt) → reesc1 만료 → 상한(1) 종단', async () => {
    const pool = createPool(url!)
    try {
      await runMigrations(pool)
      await cleanup(pool) // 사전 정리 — 직전 런이 finally 전에 크래시했어도 고정 ID 충돌(멱등 no-op) 방지
      const repo = new DecisionRepo(pool)
      const wf = 'wf-de-1'
      const base = `${wf}:wp-1:0`

      // 1) base 요청 생성(PENDING·과거 expiresAt·blocking).
      await repo.createRequest({
        requestId: base,
        type: 'defect_brief',
        workflowId: wf,
        correlationId: wf,
        wpId: 'wp-1',
        projectId: 'proj-de',
        severity: 'blocking',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      })

      // 2) 만료 전이 (PENDING→EXPIRED). 소비자는 decision.expired를 직접 수신하는 대신 핸들러를 직접 호출.
      await repo.expireRequest(base)

      // 3) 핸들러 구성(maxReescalations=1, ttlMs=1000).
      const handler = buildDecisionExpiredHandler({ decisionStore: repo, maxReescalations: 1, ttlMs: 1000 })

      // 4) decision.expired 메시지 핸들러 직접 실행 → reesc1 PENDING 생성.
      await handler({
        envelope: { workflowId: wf } as never,
        type: DECISION_EXPIRED_EVENT,
        payload: { requestId: base, status: 'EXPIRED', workflowId: wf },
      } as never)

      // 5) pendingByWorkflow → reesc1이 PENDING으로 존재.
      const pending1 = await repo.pendingByWorkflow(wf)
      const reesc1Id = `${base}:reesc1`
      const reesc1Ids = pending1.map((r) => r.requestId)
      expect(reesc1Ids).toContain(reesc1Id)

      // 6) reesc1 행 필드 검증: wpId, projectId, expiresAt 복사됨.
      const reesc1 = pending1.find((r) => r.requestId === reesc1Id)
      expect(reesc1?.wpId).toBe('wp-1')
      expect(reesc1?.projectId).toBe('proj-de')
      expect(reesc1?.expiresAt).not.toBeNull()

      // 7) reesc1 만료 → 핸들러 재실행: depth=1 >= maxReescalations=1 → 종단(reesc2 미생성).
      await repo.expireRequest(reesc1Id)
      await handler({
        envelope: { workflowId: wf } as never,
        type: DECISION_EXPIRED_EVENT,
        payload: { requestId: reesc1Id, status: 'EXPIRED', workflowId: wf },
      } as never)

      // 8) pendingByWorkflow → reesc2 없음(상한 종단).
      const pending2 = await repo.pendingByWorkflow(wf)
      const reesc2Id = `${base}:reesc2`
      expect(pending2.map((r) => r.requestId)).not.toContain(reesc2Id)
    } finally {
      await cleanup(pool)
      await closePool()
    }
  })
})
