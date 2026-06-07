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
