import { describe, it, expect } from 'vitest'
import { scoreClassification } from '@xzawed/agent-streams'
import { createPool, runMigrations, closePool } from '../src/db/pool.js'
import { RiskClassificationRepo } from '../src/db/risk-classification.repo.js'

// CI(turborepo 잡)는 TEST_DATABASE_URL을 주입 — 게이트 통일(oracle-loop·decision 통합 패턴).
const url = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL']

// P2r-2 영속 루프를 실 Postgres로 실증: upsert(pending)→승인→approvedForWorkflow 노출, 재채점=재승인(N6).
// DB URL 없으면 skip. prefix 'wf-risk-' 스코프 정리.
describe.skipIf(!url)('P2r-2 리스크 분류 영속(영속→승인→라우팅 확정)', () => {
  async function cleanup(pool: ReturnType<typeof createPool>): Promise<void> {
    await pool.query("DELETE FROM manager_outbox WHERE message::text LIKE '%wf-risk-%'").catch(() => undefined)
    await pool.query("DELETE FROM manager_events WHERE session_id LIKE 'wf-risk-%'").catch(() => undefined)
    await pool.query("DELETE FROM risk_classifications WHERE workflow_id LIKE 'wf-risk-%'").catch(() => undefined)
  }

  it('upsert(pending) → getByWorkflow → approve → approvedForWorkflow가 분류 노출 + 멱등 재승인 차단', async () => {
    const pool = createPool(url!)
    try {
      await runMigrations(pool)
      const repo = new RiskClassificationRepo(pool)
      const wf = `wf-risk-${Date.now()}`

      // HIPAA 컴플라이언스 claim(support 3 → confidence 1 → HIGH).
      const classification = scoreClassification({
        projectId: wf,
        complianceFrameworks: ['HIPAA'],
        claims: [{ text: 'PHI 취급 → HIPAA 적용', dimension: 'compliance', support: 3, citations: ['hipaa.gov#164'] }],
      })
      expect(classification.risk).toBe('HIGH')

      // 1) 영속(pending) — 승인 전이라 라우팅 미확정(N6).
      await repo.upsert({ workflowId: wf, classification })
      expect((await repo.getByWorkflow(wf))?.status).toBe('pending')
      expect(await repo.approvedForWorkflow(wf)).toBeNull()

      // 2) 사람 승인 → status=approved, audit 기록.
      const approved = await repo.approve(wf, 'human-1')
      expect(approved).not.toBeNull()
      const after = await repo.getByWorkflow(wf)
      expect(after?.status).toBe('approved')
      expect(after?.classification.audit.approvedBy).toBe('human-1')
      expect(after?.classification.audit.approvedAt).not.toBeNull()

      // 3) 승인된 분류만 라우팅 확정(N6) — modelRouting 노출.
      const routing = await repo.approvedForWorkflow(wf)
      expect(routing?.risk).toBe('HIGH')
      expect(routing?.modelRouting.PM).toBe('opus')   // HIGH → 전부 opus(§5)
      expect(routing?.modelRouting.Developer).toBe('opus')

      // 멱등 재승인 차단: 이미 approved면 null·이벤트 미적재.
      expect(await repo.approve(wf, 'human-2')).toBeNull()

      // 이벤트 로그: risk.approved 1건(M4/M7/M9).
      const { rows } = await pool.query<{ event_type: string }>(
        "SELECT event_type FROM manager_events WHERE session_id = $1", [wf],
      )
      expect(rows.map((r) => r.event_type)).toEqual(['risk.approved'])
    } finally {
      await cleanup(pool)
      await closePool()
    }
  })

  it('재채점(upsert)은 version++·status=pending 리셋 → 승인 무효화(N6 재승인 필요)', async () => {
    const pool = createPool(url!)
    try {
      await runMigrations(pool)
      const repo = new RiskClassificationRepo(pool)
      const wf = `wf-risk-re-${Date.now()}`
      const low = scoreClassification({ projectId: wf, claims: [{ text: 'static site', dimension: 'complexity', support: 1, citations: [] }] })

      await repo.upsert({ workflowId: wf, classification: low })
      await repo.approve(wf, 'human-1')
      expect(await repo.approvedForWorkflow(wf)).not.toBeNull()

      // 재채점(HIGH로 변동) → upsert가 version++·pending 리셋 → 이전 승인 무효(라우팅 재확정 필요).
      const high = scoreClassification({
        projectId: wf, complianceFrameworks: ['PCI-DSS'],
        claims: [{ text: '카드 데이터 처리', dimension: 'compliance', support: 3, citations: ['pcisecuritystandards.org'] }],
      })
      await repo.upsert({ workflowId: wf, classification: high })
      const after = await repo.getByWorkflow(wf)
      expect(after?.status).toBe('pending')
      expect(after?.version).toBe(2)
      expect(await repo.approvedForWorkflow(wf)).toBeNull()  // 재승인 전까지 라우팅 미확정
    } finally {
      await cleanup(pool)
      await closePool()
    }
  })

  it('upsert가 version을 반환한다(첫 1·재upsert 2)', async () => {
    const pool = createPool(url!)
    try {
      await runMigrations(pool)
      const repo = new RiskClassificationRepo(pool)
      const c = scoreClassification({ projectId: 'p', claims: [{ text: 'x', dimension: 'domain', support: 1, citations: ['a'] }] })
      const wf = `wf-rcv-${Date.now()}`

      const r1 = await repo.upsert({ workflowId: wf, classification: c })
      expect(r1.version).toBe(1)

      const r2 = await repo.upsert({ workflowId: wf, classification: c })
      expect(r2.version).toBe(2)
    } finally {
      await cleanup(pool)
      await closePool()
    }
  })
})
