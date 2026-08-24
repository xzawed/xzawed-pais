import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createPool, runMigrations, closePool } from '../src/db/pool.js'
import { TaskGraphRepo } from '../src/db/task-graph.repo.js'
import type { WorkPackage } from '@xzawed/agent-streams'
import type { Pool } from 'pg'

/**
 * `graph_dag` **lost update**(S6.2 후속).
 *
 * `task_graphs.graph_dag` 를 쓰는 곳이 둘이다 — `upsertGraph`(재분해·재진입 병합)와
 * `updateWpRisks`(리스크 승인 write-back). 후자는 read-modify-write 인데 `WHERE workflow_id = $1`
 * 뿐이라 **읽은 뒤 남이 바꿔도 그대로 덮어쓴다.**
 *
 * S6.2 이전에는 "덮어쓰기가 원래 동작"이라 눈에 띄지 않았다. 이제는 이 경합이
 * **재진입 병합이 보존한 진행 중 WP 를 되돌릴 수 있다** — 슬라이스의 보장을 무효화하는 경로다.
 */

const url = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL']
const d = url ? describe : describe.skip

const wp = (id: string, ac: string[] = []): WorkPackage => ({
  id, storyId: 'story-1', owningRole: 'developer', oracleRef: null,
  acceptanceCriteria: ac, dependencies: [], attributionCounters: {}, status: 'DRAFTED',
})

d('graph_dag 동시 쓰기 (pg)', () => {
  let pool: Pool
  let repo: TaskGraphRepo

  beforeAll(async () => {
    pool = createPool(url!)
    await runMigrations(pool)
    repo = new TaskGraphRepo(pool)
  })
  afterAll(async () => {
    await pool.query("DELETE FROM wp_state_log WHERE workflow_id LIKE 'wf-lu-%'")
    await pool.query("DELETE FROM task_graphs WHERE workflow_id LIKE 'wf-lu-%'")
    await closePool()
  })

  /**
   * **창을 탐지하는 게 아니라 없앤다.** 버전 검사를 붙이면 경합을 알아채지만 재시도 루프가
   * 필요하고 그 자체가 새 실패 모드다. 단일 UPDATE 로 read-modify-write 를 원자화하면
   * 창 자체가 존재하지 않는다(마이그레이션 018 이 `graph_dag` 를 다룬 방식과 같다).
   *
   * 그래서 이 테스트는 "stale write 가 거부되는가"가 아니라
   * **"어떤 순서로 끼어들어도 남의 쓰기를 되돌리지 않는가"** 를 본다.
   */
  it('직전 재분해 결과를 되돌리지 않는다(원자 갱신)', async () => {
    const wfId = `wf-lu-${Date.now()}-race`
    await repo.upsertGraph({ workflowId: wfId, workPackages: [wp('a', ['원본']), wp('b')] })
    // 재분해가 병합 결과를 영속 — b 가 빠지고 c 가 들어온다.
    await repo.upsertGraph({ workflowId: wfId, workPackages: [wp('a', ['원본']), wp('c')] })

    const res = await repo.updateWpRisks(wfId, 'HIGH')

    const after = await repo.getGraph(wfId)
    expect(after?.workPackages.map((w) => w.id).sort(), 'b 가 되살아났다(lost update)').toEqual(['a', 'c'])
    expect(res.updated).toBe(2)
    expect(after?.workPackages.every((w) => w.risk === 'HIGH')).toBe(true)
  })

  it('전 WP risk 를 갱신하되 다른 필드와 순서를 보존한다', async () => {
    const wfId = `wf-lu-${Date.now()}-ok`
    await repo.upsertGraph({ workflowId: wfId, workPackages: [wp('a', ['AC-A']), wp('b', ['AC-B'])] })
    const before = await repo.getGraph(wfId)

    const res = await repo.updateWpRisks(wfId, 'HIGH')

    expect(res.updated).toBe(2)
    const after = await repo.getGraph(wfId)
    expect(after?.workPackages.map((w) => w.id)).toEqual(['a', 'b'])
    expect(after?.workPackages.map((w) => w.acceptanceCriteria)).toEqual([['AC-A'], ['AC-B']])
    expect(after?.workPackages.every((w) => w.risk === 'HIGH')).toBe(true)
    // version 은 재분해가 아니므로 불변이다.
    expect(after?.version).toBe(before!.version)
  })

  it('userContext 를 보존한다(graph_dag 형제 키)', async () => {
    const wfId = `wf-lu-${Date.now()}-uc`
    const userContext = { userId: 'u1', projectId: 'p1', workspaceRoot: 'F:/ws', tenantId: 't1' }
    await repo.upsertGraph({ workflowId: wfId, workPackages: [wp('a')], userContext })

    await repo.updateWpRisks(wfId, 'HIGH')

    const after = await repo.getGraph(wfId)
    expect(after?.userContext).toMatchObject({ projectId: 'p1', tenantId: 't1' })
  })

  it('그래프가 없으면 no-op', async () => {
    const res = await repo.updateWpRisks(`wf-lu-${Date.now()}-none`, 'HIGH')
    expect(res.updated).toBe(0)
  })
})
