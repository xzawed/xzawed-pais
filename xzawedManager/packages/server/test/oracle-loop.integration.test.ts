import { describe, it, expect } from 'vitest'
import type { WorkPackage } from '@xzawed/agent-streams'
import { oracleSatisfiedSet } from '@xzawed/agent-streams'
import { createPool, runMigrations, closePool } from '../src/db/pool.js'
import { OracleRepo } from '../src/db/oracle.repo.js'
import { oracleIdFor } from '../src/db/oracle.types.js'

// CI(turborepo 잡)는 TEST_DATABASE_URL을 주입 — 게이트 통일(Orchestrator migrate.integration 패턴)
const url = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL']

// blocker#1(draft-only 영속)·#10(루프 실증) 포착: 실 Postgres로 영속→승인→DoR 충족 루프를 닫는다.
// DB URL 없으면 skip(로컬·CI 환경 따라). 새 migration 없음(given/when/then은 scenarios JSONB 내부).
describe.skipIf(!url)('P3-2 오라클 루프 통합(영속→승인→DoR)', () => {
  it('upsertDraft(drafted) → approve(전이) → approvedByWorkflow → oracleSatisfiedSet이 WP를 satisfied로 산출', async () => {
    const pool = createPool(url!)
    // try/finally: assertion 실패 시에도 pool teardown 보장(미정리 시 Vitest 행).
    try {
      await runMigrations(pool)
      const repo = new OracleRepo(pool)
      const wf = `wf-orc-${Date.now()}`

      // 1) PM 초안 영속(status=pending, 시나리오 status=drafted) — consumer가 위임하는 경로와 동일.
      await repo.upsertDraft({
        workflowId: wf,
        storyId: 's1',
        scenarios: [{ id: 's1-sc1', title: '', given: [], when: '', thenSteps: [], status: 'drafted' }],
        coverage: { ac1: ['s1-sc1'] },
      })

      // D1: oracleId는 oracleIdFor(wf, storyId)로만 파생(리터럴 `oracle-${wf}-s1` 금지 — sha256 해시 형태).
      const oracleId = oracleIdFor(wf, 's1')

      // 2) 사람 승인 한 번 → status=approved, drafted 시나리오 → human_approved 일괄 전이.
      const approved = await repo.approve(oracleId, 'human-1')
      expect(approved).not.toBeNull()

      // 3) approved 오라클을 satisfied-set 입력 뷰로 산출.
      const views = await repo.approvedByWorkflow(wf)
      expect(views).toHaveLength(1)

      // 4) DoR 충족 검증: 승인 한 번으로 그 story에 바인딩된 WP가 satisfied로 산출.
      const wp: WorkPackage = {
        id: 'a',
        storyId: 's1',
        owningRole: 'dev',
        oracleRef: null,
        acceptanceCriteria: ['ac1'],
        dependencies: [],
        attributionCounters: {},
        status: 'draft',
      }
      expect(oracleSatisfiedSet([wp], views).has('a')).toBe(true)

      // 멱등 재승인 차단(blocker#8): 이미 approved면 null·이벤트 미적재.
      expect(await repo.approve(oracleId, 'human-2')).toBeNull()
    } finally {
      // 'wf-orc-%' prefix 스코프 정리(형제 통합 테스트와의 병렬 간섭 방지 — FK 순서: outbox→events→oracles)
      await pool.query("DELETE FROM manager_outbox WHERE message::text LIKE '%wf-orc-%'").catch(() => undefined)
      await pool.query("DELETE FROM manager_events WHERE session_id LIKE 'wf-orc-%'").catch(() => undefined)
      await pool.query("DELETE FROM oracles WHERE workflow_id LIKE 'wf-orc-%'").catch(() => undefined)
      await closePool()
    }
  })

  // P4b-2 설계 §8: approvedOracleForStory가 실 Postgres에서 (a) 동일 story 다중 approved 중 최신 version을 선택하고
  // (b) 미승인(pending)·(c) 타 story는 null을 반환하는지 실증(이전엔 SQL 문자열 mock + 단일 happy-path만).
  it('approvedOracleForStory: 동일 story 다중 approved 중 최신 version·미승인/타 story→null (P4b-2)', async () => {
    const pool = createPool(url!)
    try {
      await runMigrations(pool)
      const repo = new OracleRepo(pool)
      const wf = `wf-orc-afs-${Date.now()}`

      // 같은 (wf, story)에 approved 오라클 2개(서로 다른 oracleId·version 1·2) — ORDER BY version DESC LIMIT 1이 최신을 골라야.
      await repo.upsert({
        oracleId: `${wf}-s1-v1`, workflowId: wf, storyId: 's1', version: 1, status: 'approved',
        scenarios: [{ id: 'old', title: 'old', given: [], when: '', thenSteps: ['x'], status: 'human_approved' }], coverage: { AC1: ['old'] },
        invariants: [], goldenRefs: [],
      })
      await repo.upsert({
        oracleId: `${wf}-s1-v2`, workflowId: wf, storyId: 's1', version: 2, status: 'approved',
        scenarios: [{ id: 'new', title: 'new', given: [], when: '', thenSteps: ['y'], status: 'human_approved' }], coverage: { AC1: ['new'] },
        invariants: [], goldenRefs: [],
      })
      const latest = await repo.approvedOracleForStory(wf, 's1')
      expect(latest?.scenarios.map((s) => s.id)).toEqual(['new'])  // 최신 version(2)
      expect(latest?.coverage).toEqual({ AC1: ['new'] })

      // (b) 미승인(pending) story → null
      await repo.upsertDraft({
        workflowId: wf, storyId: 's2',
        scenarios: [{ id: 's2-sc1', title: '', given: [], when: '', thenSteps: [], status: 'drafted' }], coverage: {},
      })
      expect(await repo.approvedOracleForStory(wf, 's2')).toBeNull()

      // (c) 타/미존재 story → null
      expect(await repo.approvedOracleForStory(wf, 's-none')).toBeNull()
    } finally {
      await pool.query("DELETE FROM manager_outbox WHERE message::text LIKE '%wf-orc-%'").catch(() => undefined)
      await pool.query("DELETE FROM manager_events WHERE session_id LIKE 'wf-orc-%'").catch(() => undefined)
      await pool.query("DELETE FROM oracles WHERE workflow_id LIKE 'wf-orc-%'").catch(() => undefined)
      await closePool()
    }
  })

  // P4b-3: 확장 아티팩트(invariants §4·golden_refs §5)가 migration 010 컬럼에 upsert→listByWorkflow로
  // 라운드트립(JSONB 보존). additive — approve는 invariants/golden_refs를 건드리지 않음(보존).
  it('upsert→listByWorkflow가 invariants·golden_refs를 보존(P4b-3 additive 스키마)', async () => {
    const pool = createPool(url!)
    try {
      await runMigrations(pool)
      const repo = new OracleRepo(pool)
      const wf = `wf-orc-igr-${Date.now()}`
      const invariants = [{ id: 'inv1', statement: '30분 경과 토큰은 거부', domain: '토큰 생성기', property: 'for all t: age(t)>30min => reject(t)', status: 'human_approved' as const }]
      const goldenRefs = [{ id: 'g1', inputFixture: 'ref', normalizedOutput: 'OK', normalizers: ['strip_timestamps'], frozenAt: '2026-06-11', frozenBy: 'human-1', fromDecision: 'dec-1', version: 1 }]
      await repo.upsert({
        oracleId: `${wf}-s1`, workflowId: wf, storyId: 's1', version: 1, status: 'pending',
        scenarios: [{ id: 'sc1', title: 't', given: [], when: 'w', thenSteps: ['ok'], status: 'drafted' }],
        coverage: { AC1: ['sc1'] }, invariants, goldenRefs,
      })
      const rows = await repo.listByWorkflow(wf)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.invariants).toEqual(invariants)
      expect(rows[0]?.golden_refs).toEqual(goldenRefs)

      // approve는 invariants/golden_refs 보존(scenarios만 전이) — additive 회귀 0 실증.
      await repo.approve(`${wf}-s1`, 'human-1')
      const after = await repo.listByWorkflow(wf)
      expect(after[0]?.invariants).toEqual(invariants)
      expect(after[0]?.golden_refs).toEqual(goldenRefs)
    } finally {
      await pool.query("DELETE FROM manager_outbox WHERE message::text LIKE '%wf-orc-%'").catch(() => undefined)
      await pool.query("DELETE FROM manager_events WHERE session_id LIKE 'wf-orc-%'").catch(() => undefined)
      await pool.query("DELETE FROM oracles WHERE workflow_id LIKE 'wf-orc-%'").catch(() => undefined)
      await closePool()
    }
  })
})
