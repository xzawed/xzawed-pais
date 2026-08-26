import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Pool } from 'pg'
import { createPool, runMigrations, closePool } from '../src/db/pool.js'
import { TaskGraphRepo } from '../src/db/task-graph.repo.js'
import type { WorkPackage } from '@xzawed/agent-streams'

const url = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL']

function wp(id: string, risk: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM'): WorkPackage {
  return {
    id, storyId: 's1', epicId: null, owningRole: 'developer',
    inputs: [], outputs: [], oracleRef: null, acceptanceCriteria: ['x'],
    dependencies: [], risk, attributionCounters: { impl: 0, task: 0, plan: 0 }, status: 'DRAFTED',
  } as WorkPackage
}

describe.skipIf(!url)('TaskGraphRepo.updateWpRisks (integration)', () => {
  let pool: Pool
  beforeAll(async () => { pool = createPool(url!); await runMigrations(pool) })
  afterAll(async () => { await pool.query("DELETE FROM task_graphs WHERE workflow_id LIKE 'wf-tgr-%'"); await closePool() })

  it('WP 별 등급을 갱신하고 version·id·userContext를 보존한다', async () => {
    const repo = new TaskGraphRepo(pool)
    const uc = { userId: 'u', projectId: 'p', workspaceRoot: '/abs/ws' }
    const { version: v0 } = await repo.upsertGraph({ workflowId: 'wf-tgr-1', workPackages: [wp('a'), wp('b')], userContext: uc })

    const res = await repo.updateWpRisks('wf-tgr-1', { a: 'HIGH', b: 'LOW' }, 'MEDIUM')
    expect(res).toEqual({ updated: 2, judged: 2 })

    const g = await repo.getGraph('wf-tgr-1')
    expect(g!.version).toBe(v0)                       // version 불변(재분해 아님)
    expect(g!.workPackages.map((w) => w.id).sort()).toEqual(['a', 'b'])  // id 불변
    expect(g!.userContext).toEqual(uc)                // userContext 보존
    // **핵심(F2 · S5.3b)** — 등급이 WP 별로 갈린다. 예전 SQL 은 둘 다 같은 값을 받았다.
    expect(g!.workPackages.find((w) => w.id === 'a')!.risk).toBe('HIGH')
    expect(g!.workPackages.find((w) => w.id === 'b')!.risk).toBe('LOW')
  })

  /**
   * 판정이 없는 WP 를 **방치하면 fail-open** 이다 — 사람이 HIGH 로 승인했는데 그 WP 는
   * 분해 기본값에 머물러 mutation 게이트가 조용히 꺼진다. 폴백으로 바닥을 남긴다.
   */
  it('맵에 없는 WP 는 폴백 등급을 받는다', async () => {
    const repo = new TaskGraphRepo(pool)
    await repo.upsertGraph({ workflowId: 'wf-tgr-partial', workPackages: [wp('a'), wp('unjudged', 'LOW')] })

    const res = await repo.updateWpRisks('wf-tgr-partial', { a: 'LOW' }, 'HIGH')
    expect(res).toEqual({ updated: 2, judged: 1 })

    const g = await repo.getGraph('wf-tgr-partial')
    // 판정이 있으면 폴백보다 우선한다 — 폴백이 판정을 덮으면 per-WP 가 무의미해진다.
    expect(g!.workPackages.find((w) => w.id === 'a')!.risk, '폴백이 판정을 덮었다').toBe('LOW')
    expect(g!.workPackages.find((w) => w.id === 'unjudged')!.risk, '판정 없는 WP 가 방치됐다').toBe('HIGH')
  })

  /** 그래프에 없는 id 는 아무 데도 안 붙는다 — judged 가 그 사실을 드러낸다. */
  it('그래프에 없는 id 는 judged 에 세지 않는다', async () => {
    const repo = new TaskGraphRepo(pool)
    await repo.upsertGraph({ workflowId: 'wf-tgr-ghost', workPackages: [wp('a')] })
    expect(await repo.updateWpRisks('wf-tgr-ghost', { a: 'HIGH', ghost: 'HIGH' }, 'MEDIUM'))
      .toEqual({ updated: 1, judged: 1 })
  })

  /** 구 아티팩트 경로 — 판정이 하나도 없어도 승인된 등급이 전 WP 에 남는다(변경 전과 동일). */
  it('빈 맵이면 전 WP 가 폴백을 받는다', async () => {
    const repo = new TaskGraphRepo(pool)
    await repo.upsertGraph({ workflowId: 'wf-tgr-empty', workPackages: [wp('a', 'MEDIUM'), wp('b', 'MEDIUM')] })
    expect(await repo.updateWpRisks('wf-tgr-empty', {}, 'HIGH')).toEqual({ updated: 2, judged: 0 })
    const g = await repo.getGraph('wf-tgr-empty')
    expect(g!.workPackages.every((w) => w.risk === 'HIGH'), '승인된 HIGH 가 반영 안 됐다(fail-open)').toBe(true)
  })

  it('그래프가 없으면 no-op({updated:0})', async () => {
    const repo = new TaskGraphRepo(pool)
    expect(await repo.updateWpRisks('wf-tgr-missing', { a: 'HIGH' }, 'MEDIUM')).toEqual({ updated: 0, judged: 0 })
  })
})

/**
 * **JSON null 은 `COALESCE` 를 통과한다**(Grok 반증의 잔여). SQL NULL 이 아니라 jsonb null 이라
 * 폴백이 안 걸리고 그대로 박히는데, 그러면 `getGraph` 의 Zod 가 **그래프 전체를** 거부해
 * 워크플로가 벽돌이 된다. 오늘은 타입·스키마가 이중으로 막지만 가드는 저장 지점에 있어야 한다.
 */
describe.skipIf(!url)('updateWpRisks — 오염 입력 방어', () => {
  let pool2: Pool
  beforeAll(async () => { pool2 = createPool(url!); await runMigrations(pool2) })
  afterAll(async () => { await pool2.query("DELETE FROM task_graphs WHERE workflow_id LIKE 'wf-tgd-%'"); await closePool() })

  it('등급이 아닌 값은 버리고 폴백을 준다(그래프를 못 읽게 만들지 않는다)', async () => {
    const repo = new TaskGraphRepo(pool2)
    await repo.upsertGraph({ workflowId: 'wf-tgd-1', workPackages: [wp('a'), wp('b')] })

    const res = await repo.updateWpRisks(
      'wf-tgd-1', { a: null, b: 'CRITICAL' } as never, 'HIGH',
    )
    expect(res).toEqual({ updated: 2, judged: 0 })

    // 핵심: 읽을 수 있어야 한다. 오염이 박히면 여기서 throw 한다.
    const g = await repo.getGraph('wf-tgd-1')
    expect(g!.workPackages.every((w) => w.risk === 'HIGH')).toBe(true)
  })

  it('유효한 등급은 그대로 두고 오염만 버린다', async () => {
    const repo = new TaskGraphRepo(pool2)
    await repo.upsertGraph({ workflowId: 'wf-tgd-2', workPackages: [wp('a'), wp('b')] })
    const res = await repo.updateWpRisks('wf-tgd-2', { a: 'LOW', b: null } as never, 'HIGH')
    expect(res).toEqual({ updated: 2, judged: 1 })
    const g = await repo.getGraph('wf-tgd-2')
    expect(g!.workPackages.find((w) => w.id === 'a')!.risk).toBe('LOW')
    expect(g!.workPackages.find((w) => w.id === 'b')!.risk).toBe('HIGH')
  })
})
