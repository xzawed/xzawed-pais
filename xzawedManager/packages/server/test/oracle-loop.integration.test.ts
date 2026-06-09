import { describe, it, expect } from 'vitest'
import type { WorkPackage } from '@xzawed/agent-streams'
import { oracleSatisfiedSet } from '@xzawed/agent-streams'
import { createPool, runMigrations, closePool } from '../src/db/pool.js'
import { OracleRepo } from '../src/db/oracle.repo.js'
import { oracleIdFor } from '../src/db/oracle.types.js'

const url = process.env['DATABASE_URL']

// blocker#1(draft-only 영속)·#10(루프 실증) 포착: 실 Postgres로 영속→승인→DoR 충족 루프를 닫는다.
// DATABASE_URL 없으면 skip(로컬·CI 환경 따라). 새 migration 없음(given/when/then은 scenarios JSONB 내부).
describe.skipIf(!url)('P3-2 오라클 루프 통합(영속→승인→DoR)', () => {
  it('upsertDraft(drafted) → approve(전이) → approvedByWorkflow → oracleSatisfiedSet이 WP를 satisfied로 산출', async () => {
    const pool = createPool(url!)
    await runMigrations(pool)
    const repo = new OracleRepo(pool)
    const wf = `wf-${Date.now()}`

    // 1) PM 초안 영속(status=pending, 시나리오 status=drafted) — consumer가 위임하는 경로와 동일.
    await repo.upsertDraft({
      workflowId: wf,
      storyId: 's1',
      scenarios: [{ id: 's1-sc1', title: '', given: [], when: '', then: [], status: 'drafted' }],
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

    await closePool()
  })
})
