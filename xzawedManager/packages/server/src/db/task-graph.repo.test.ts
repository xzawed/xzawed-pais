import { describe, it, expect, vi } from 'vitest'
import { TaskGraphRepo } from './task-graph.repo.js'
import type { WorkPackage } from '@xzawed/agent-streams'

function mockPool(result: unknown = { rows: [] }) {
  return { query: vi.fn().mockResolvedValue(result) } as unknown as
    import('pg').Pool & { query: ReturnType<typeof vi.fn> }
}

const wp: WorkPackage = {
  id: 'wp-1', storyId: 'story-1', owningRole: 'developer',
  oracleRef: null, acceptanceCriteria: ['AC1'], dependencies: [],
  attributionCounters: {}, status: 'draft',
}

describe('TaskGraphRepo.upsertGraph', () => {
  it('graph_dag를 {workPackages} JSON으로 직렬화하고 ON CONFLICT version++ INSERT한다', async () => {
    const pool = mockPool({ rows: [{ version: 1 }] })
    const res = await new TaskGraphRepo(pool).upsertGraph({ workflowId: 'wf-1', workPackages: [wp] })
    const [sql, params] = pool.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO task_graphs/i)
    expect(sql).toMatch(/ON CONFLICT \(workflow_id\) DO UPDATE/i)
    expect(sql).toMatch(/version\s*=\s*task_graphs\.version\s*\+\s*1/i)
    expect(params[0]).toBe('wf-1')
    expect(JSON.parse(params[1] as string)).toEqual({ workPackages: [wp] })
    expect(params[2]).toBeNull() // eventId 기본 null
    expect(res).toEqual({ version: 1 })
  })

  it('eventId가 있으면 세 번째 파라미터로 싣는다', async () => {
    const pool = mockPool({ rows: [{ version: 2 }] })
    const res = await new TaskGraphRepo(pool).upsertGraph({
      workflowId: 'wf-1', workPackages: [wp], eventId: 'evt-9',
    })
    expect(pool.query.mock.calls[0][1][2]).toBe('evt-9')
    expect(res).toEqual({ version: 2 })
  })

  it('RETURNING 행이 없으면 throw한다(부분 실패 방어)', async () => {
    const pool = mockPool({ rows: [] })
    await expect(new TaskGraphRepo(pool).upsertGraph({ workflowId: 'wf-1', workPackages: [wp] }))
      .rejects.toThrow(/no row returned/i)
  })
})

describe('TaskGraphRepo.getGraph', () => {
  it('행이 없으면 null을 반환한다', async () => {
    const pool = mockPool({ rows: [] })
    expect(await new TaskGraphRepo(pool).getGraph('wf-x')).toBeNull()
  })

  it('graph_dag.workPackages를 WorkPackageSchema로 재검증해 반환한다', async () => {
    const pool = mockPool({ rows: [{ graph_dag: { workPackages: [wp] }, event_id: 'evt-9', version: 3 }] })
    const out = await new TaskGraphRepo(pool).getGraph('wf-1')
    expect(pool.query.mock.calls[0][0]).toMatch(/SELECT graph_dag, event_id, version FROM task_graphs WHERE workflow_id = \$1/i)
    expect(out).toEqual({ workflowId: 'wf-1', workPackages: [wp], eventId: 'evt-9', version: 3 })
  })

  it('workPackages가 없으면 빈 배열로 파싱한다', async () => {
    const pool = mockPool({ rows: [{ graph_dag: {}, event_id: null, version: 1 }] })
    const out = await new TaskGraphRepo(pool).getGraph('wf-1')
    expect(out?.workPackages).toEqual([])
  })

  it('저장 데이터가 WorkPackage 스키마 위반이면 throw한다', async () => {
    const pool = mockPool({ rows: [{ graph_dag: { workPackages: [{ id: '' }] }, event_id: null, version: 1 }] })
    await expect(new TaskGraphRepo(pool).getGraph('wf-1')).rejects.toThrow()
  })
})

describe('TaskGraphRepo.appendTransition', () => {
  it('wp_state_log에 INSERT only로 전이를 기록하고 seq를 Number로 반환한다', async () => {
    const pool = mockPool({ rows: [{ seq: '5' }] }) // pg BIGSERIAL은 문자열
    const res = await new TaskGraphRepo(pool, () => 1234).appendTransition({
      workflowId: 'wf-1', wpId: 'wp-1', toState: 'READY',
    })
    const [sql, params] = pool.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO wp_state_log/i)
    expect(sql).not.toMatch(/UPDATE|DELETE/i)
    // params: workflow_id, wp_id, from_state, to_state, event_id, reason, occurred_at
    expect(params).toEqual(['wf-1', 'wp-1', null, 'READY', null, null, 1234])
    expect(res).toEqual({ seq: 5 })
  })

  it('fromState·eventId·reason이 있으면 파라미터로 싣는다', async () => {
    const pool = mockPool({ rows: [{ seq: '6' }] })
    await new TaskGraphRepo(pool, () => 1).appendTransition({
      workflowId: 'wf-1', wpId: 'wp-1', fromState: 'DRAFTED', toState: 'READY',
      eventId: 'evt-2', reason: 'DoR met',
    })
    expect(pool.query.mock.calls[0][1]).toEqual(['wf-1', 'wp-1', 'DRAFTED', 'READY', 'evt-2', 'DoR met', 1])
  })

  it('RETURNING 행이 없으면 throw한다', async () => {
    const pool = mockPool({ rows: [] })
    await expect(new TaskGraphRepo(pool).appendTransition({ workflowId: 'wf-1', wpId: 'wp-1', toState: 'READY' }))
      .rejects.toThrow(/no row returned/i)
  })
})

describe('TaskGraphRepo.latestStates', () => {
  it('DISTINCT ON (wp_id) seq DESC로 WP별 최신 상태를 Map으로 반환한다', async () => {
    const pool = mockPool({ rows: [
      { seq: '9', workflow_id: 'wf-1', wp_id: 'wp-1', from_state: 'READY', to_state: 'DISPATCHED', event_id: null, reason: null, occurred_at: '200' },
      { seq: '7', workflow_id: 'wf-1', wp_id: 'wp-2', from_state: null, to_state: 'READY', event_id: null, reason: null, occurred_at: '150' },
    ] })
    const out = await new TaskGraphRepo(pool).latestStates('wf-1')
    expect(pool.query.mock.calls[0][0]).toMatch(/DISTINCT ON \(wp_id\)[\s\S]*ORDER BY wp_id, seq DESC/i)
    expect(out.get('wp-1')).toEqual({
      seq: 9, workflowId: 'wf-1', wpId: 'wp-1', fromState: 'READY', toState: 'DISPATCHED',
      eventId: null, reason: null, occurredAt: 200,
    })
    expect(out.get('wp-2')?.toState).toBe('READY')
    expect(out.size).toBe(2)
  })
})

describe('TaskGraphRepo.transitions', () => {
  it('한 WP의 전이 이력을 seq ASC로 반환한다(BIGINT 문자열→Number)', async () => {
    const pool = mockPool({ rows: [
      { seq: '1', workflow_id: 'wf-1', wp_id: 'wp-1', from_state: null, to_state: 'DRAFTED', event_id: null, reason: null, occurred_at: '100' },
      { seq: '2', workflow_id: 'wf-1', wp_id: 'wp-1', from_state: 'DRAFTED', to_state: 'READY', event_id: 'e1', reason: 'DoR', occurred_at: '110' },
    ] })
    const out = await new TaskGraphRepo(pool).transitions('wf-1', 'wp-1')
    expect(pool.query.mock.calls[0][0]).toMatch(/WHERE workflow_id = \$1 AND wp_id = \$2[\s\S]*ORDER BY seq ASC/i)
    expect(pool.query.mock.calls[0][1]).toEqual(['wf-1', 'wp-1'])
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ seq: 1, toState: 'DRAFTED', occurredAt: 100 })
    expect(out[1]).toMatchObject({ seq: 2, fromState: 'DRAFTED', toState: 'READY', eventId: 'e1', reason: 'DoR' })
  })
})
