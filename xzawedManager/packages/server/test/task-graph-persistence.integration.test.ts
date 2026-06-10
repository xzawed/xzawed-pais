import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createPool, runMigrations, closePool } from '../src/db/pool.js'
import { TaskGraphRepo } from '../src/db/task-graph.repo.js'
import type { WorkPackage } from '@xzawed/agent-streams'
import type { Pool } from 'pg'

const url = process.env['DATABASE_URL']
const d = url ? describe : describe.skip

const wp = (id: string, deps: string[] = []): WorkPackage => ({
  id, storyId: 'story-1', owningRole: 'developer', oracleRef: null,
  acceptanceCriteria: [], dependencies: deps, attributionCounters: {}, status: 'draft',
})

d('task-graph 영속 통합 (pg)', () => {
  let pool: Pool
  beforeAll(async () => {
    pool = createPool(url!)
    await runMigrations(pool)
  })
  afterAll(async () => {
    await pool.query('DELETE FROM wp_state_log')
    await pool.query('DELETE FROM task_graphs')
    await closePool()
  })

  it('upsertGraph → getGraph 라운드트립이 WorkPackage 배열을 보존한다', async () => {
    const wfId = `wf-${Date.now()}-a`
    const repo = new TaskGraphRepo(pool)
    const { version } = await repo.upsertGraph({ workflowId: wfId, workPackages: [wp('wp-1'), wp('wp-2', ['wp-1'])] })
    expect(version).toBe(1)
    const got = await repo.getGraph(wfId)
    expect(got?.version).toBe(1)
    expect(got?.workPackages.map((w) => w.id)).toEqual(['wp-1', 'wp-2'])
    expect(got?.workPackages[1]?.dependencies).toEqual(['wp-1'])
  })

  it('재분해 시 같은 workflow_id를 upsert하면 version++·graph_dag 교체', async () => {
    const wfId = `wf-${Date.now()}-b`
    const repo = new TaskGraphRepo(pool)
    await repo.upsertGraph({ workflowId: wfId, workPackages: [wp('wp-1')] })
    const second = await repo.upsertGraph({ workflowId: wfId, workPackages: [wp('wp-1'), wp('wp-9')], eventId: null })
    expect(second.version).toBe(2)
    const got = await repo.getGraph(wfId)
    expect(got?.version).toBe(2)
    expect(got?.workPackages.map((w) => w.id)).toEqual(['wp-1', 'wp-9'])
  })

  it('userContext 라운드트립(githubRepo 중첩 포함) + 재분해가 userContext 없이 오면 null 교체(P4a-2 스펙 §6)', async () => {
    const wfId = `wf-${Date.now()}-uc`
    const repo = new TaskGraphRepo(pool)
    const uc = {
      userId: 'u1', projectId: 'p1', workspaceRoot: '/workspace/p1',
      githubRepo: { owner: 'o', repo: 'r', branch: 'main' },
    }
    await repo.upsertGraph({ workflowId: wfId, workPackages: [wp('wp-1')], userContext: uc })
    expect((await repo.getGraph(wfId))?.userContext).toEqual(uc) // JSONB 왕복 중첩 보존

    await repo.upsertGraph({ workflowId: wfId, workPackages: [wp('wp-1')] }) // 재분해(컨텍스트 미전달)
    const after = await repo.getGraph(wfId)
    expect(after?.version).toBe(2)
    expect(after?.userContext).toBeNull() // graph_dag 통째 교체 — 가변 프로젝션 의미(유실은 스펙 §6 문서화)
  })

  it('appendTransition 다중 → transitions seq ASC, latestStates는 WP별 최신', async () => {
    const wfId = `wf-${Date.now()}-c`
    const repo = new TaskGraphRepo(pool)
    await repo.appendTransition({ workflowId: wfId, wpId: 'wp-1', toState: 'DRAFTED' })
    await repo.appendTransition({ workflowId: wfId, wpId: 'wp-1', fromState: 'DRAFTED', toState: 'READY' })
    await repo.appendTransition({ workflowId: wfId, wpId: 'wp-2', toState: 'DRAFTED' })

    const hist = await repo.transitions(wfId, 'wp-1')
    expect(hist.map((h) => h.toState)).toEqual(['DRAFTED', 'READY'])
    expect(hist[0]!.seq).toBeLessThan(hist[1]!.seq)

    const latest = await repo.latestStates(wfId)
    expect(latest.get('wp-1')?.toState).toBe('READY')
    expect(latest.get('wp-2')?.toState).toBe('DRAFTED')
    expect(latest.size).toBe(2)
  })
})
