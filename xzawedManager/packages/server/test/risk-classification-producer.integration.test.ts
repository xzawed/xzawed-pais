import { describe, it, expect } from 'vitest'
import { createPool, runMigrations, closePool } from '../src/db/pool.js'
import { RiskClassificationRepo } from '../src/db/risk-classification.repo.js'
import { produceRiskClassification } from '../src/decompose/risk-producer.js'

// CI(turborepo 잡)는 TEST_DATABASE_URL 주입 — 기존 통합 패턴 통일.
const url = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL']

// P2r-3 생산자 DB 통합: produce → upsert → getByWorkflow가 pending 분류를 반환함을 실 Postgres로 실증.
// DB URL 없으면 skip. prefix 'wf-rcp-' 스코프 정리.
describe.skipIf(!url)('P2r-3 리스크 분류 생산자 DB 통합(produce→upsert→pending 조회)', () => {
  async function cleanup(pool: ReturnType<typeof createPool>): Promise<void> {
    await pool.query("DELETE FROM risk_classifications WHERE workflow_id LIKE 'wf-rcp-%'").catch(() => undefined)
  }

  it('produce → upsert → getByWorkflow가 pending 분류 반환(projectId·complianceFrameworks 정확)', async () => {
    const pool = createPool(url!)
    try {
      await runMigrations(pool)
      const repo = new RiskClassificationRepo(pool)

      // 3개 독립 인용으로 support=3 → confidence=1 → HIGH risk (HIPAA compliance claim).
      const responseJson = JSON.stringify({
        claims: [{ text: 'PHI→HIPAA', dimension: 'compliance', support: 3, citations: ['hipaa.gov', '45-cfr-164', 'hhs-privacy'] }],
        complianceFrameworks: ['HIPAA'],
      })
      const claude = {
        messages: {
          create: async () => ({ content: [{ type: 'text', text: responseJson }] }),
        },
      }

      const r = await produceRiskClassification(
        'build a clinical portal that handles patient health records',
        'wf-rcp-1',
        { claude: claude as never, model: 'm', timeoutMs: 50, repo },
        { userId: 'u', projectId: 'proj-rcp', workspaceRoot: '/ws' } as never,
      )

      expect(r.classified).toBe(true)

      const stored = await repo.getByWorkflow('wf-rcp-1')
      expect(stored?.status).toBe('pending')
      expect(stored?.classification.projectId).toBe('proj-rcp')
      expect(stored?.classification.complianceFrameworks).toContain('HIPAA')
    } finally {
      await cleanup(pool)
      await closePool()
    }
  })
})
