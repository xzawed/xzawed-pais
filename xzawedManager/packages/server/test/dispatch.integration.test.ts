import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createPool, runMigrations, closePool } from '../src/db/pool.js'
import { TaskGraphRepo } from '../src/db/task-graph.repo.js'
import { DispatchStore } from '../src/db/dispatch.repo.js'
import { handleDispatch } from '../src/streams/dispatch.js'
import type { WorkPackage } from '@xzawed/agent-streams'
import type { Pool } from 'pg'

const url = process.env['DATABASE_URL']
const d = url ? describe : describe.skip

const wp = (id: string, deps: string[] = []): WorkPackage => ({
  id, storyId: 'story-1', owningRole: 'developer', oracleRef: 'oracle-1',
  acceptanceCriteria: [], dependencies: deps, attributionCounters: {}, status: 'draft',
})

d('디스패치 통합 (pg)', () => {
  let pool: Pool
  const cleanup = async (p: Pool) => {
    // 'wf-disp-%' prefix 스코프 정리(이전 크래시 잔여 행 + 형제 통합 테스트와의 로컬 병렬 간섭 최소화).
    await p.query("DELETE FROM manager_outbox WHERE stream LIKE 'manager:events:wf-disp-%'")
    await p.query("DELETE FROM manager_events WHERE session_id LIKE 'wf-disp-%'")
    await p.query("DELETE FROM wp_state_log WHERE workflow_id LIKE 'wf-disp-%'")
    await p.query("DELETE FROM wp_leases WHERE workflow_id LIKE 'wf-disp-%'")
    await p.query("DELETE FROM task_graphs WHERE workflow_id LIKE 'wf-disp-%'")
  }
  beforeAll(async () => {
    pool = createPool(url!)
    await runMigrations(pool)
    await cleanup(pool) // 시작 전 자기 prefix 사전정리
  })
  afterAll(async () => {
    await cleanup(pool)
    await closePool()
  })

  it('영속 그래프의 ready WP를 wp_state_log·manager_events·manager_outbox에 원자 기록한다', async () => {
    const wfId = `wf-disp-${Date.now()}-a`
    const repo = new TaskGraphRepo(pool)
    const store = new DispatchStore(pool)
    await repo.upsertGraph({ workflowId: wfId, workPackages: [wp('a'), wp('b')] })

    const out = await handleDispatch(wfId, { repo, store })
    expect(out.status).toBe('dispatched')
    expect(out.dispatched.map((x) => x.wpId)).toEqual(['a', 'b'])
    expect(out.skipped).toBe(0)

    const log = await pool.query(
      `SELECT wp_id, from_state, to_state, event_id FROM wp_state_log WHERE workflow_id = $1 ORDER BY wp_id`,
      [wfId],
    )
    expect(log.rows.map((r) => r.to_state)).toEqual(['DISPATCHED', 'DISPATCHED'])
    expect(log.rows.every((r) => r.from_state === 'DRAFTED' && r.event_id)).toBe(true)

    const ev = await pool.query(
      `SELECT event_type FROM manager_events WHERE session_id = $1 AND event_type = 'wp.dispatched'`, [wfId],
    )
    expect(ev.rows).toHaveLength(2)

    const ob = await pool.query(
      `SELECT published_at FROM manager_outbox WHERE stream = $1`, [`manager:events:${wfId}`],
    )
    expect(ob.rows).toHaveLength(2)
    expect(ob.rows.every((r) => r.published_at === null)).toBe(true) // 릴레이 미발행

    const latest = await repo.latestStates(wfId)
    expect(latest.get('a')?.toState).toBe('DISPATCHED')
    expect(latest.get('b')?.toState).toBe('DISPATCHED')

    // P1d-5a: 각 디스패치가 active lease(attempt 0·expires_at)를 획득
    const leases = await pool.query(
      `SELECT wp_id, attempt, status, expires_at FROM wp_leases WHERE workflow_id = $1 ORDER BY wp_id`, [wfId],
    )
    expect(leases.rows.map((r) => r.wp_id)).toEqual(['a', 'b'])
    expect(leases.rows.every((r) => r.attempt === 0 && r.status === 'active' && Number(r.expires_at) > 0)).toBe(true)
  })

  it('같은 (wf, wp)에 recordDispatch를 두 번 하면 두 번째는 lease PK로 deduped된다(§8 #2 DB 레벨 dedup)', async () => {
    const wfId = `wf-disp-${Date.now()}-dedup`
    const store = new DispatchStore(pool)
    const input = { workflowId: wfId, wpId: 'x', stepN: 0, fromState: 'DRAFTED', visibilityMs: 5000 }
    const first = await store.recordDispatch(input)
    const second = await store.recordDispatch(input)
    expect(first.status).toBe('recorded')
    expect(second.status).toBe('deduped') // lease PK + ON CONFLICT DO NOTHING

    const leases = await pool.query(`SELECT wp_id FROM wp_leases WHERE workflow_id = $1`, [wfId])
    expect(leases.rows).toHaveLength(1) // lease 1행
    const ev = await pool.query(
      `SELECT seq FROM manager_events WHERE session_id = $1 AND event_type = 'wp.dispatched'`, [wfId])
    expect(ev.rows).toHaveLength(1) // 이벤트 1건(중복 적재 0)
  })

  it('멱등: 재실행하면 이미 DISPATCHED인 WP는 skip하고 중복 기록을 만들지 않는다', async () => {
    const wfId = `wf-disp-${Date.now()}-b`
    const repo = new TaskGraphRepo(pool)
    const store = new DispatchStore(pool)
    await repo.upsertGraph({ workflowId: wfId, workPackages: [wp('a')] })

    const first = await handleDispatch(wfId, { repo, store })
    expect(first.dispatched).toHaveLength(1)
    const second = await handleDispatch(wfId, { repo, store })
    expect(second.dispatched).toHaveLength(0)
    expect(second.skipped).toBe(1)

    const log = await pool.query(`SELECT seq FROM wp_state_log WHERE workflow_id = $1`, [wfId])
    expect(log.rows).toHaveLength(1) // 재실행에도 중복 전이 0
    const ev = await pool.query(
      `SELECT seq FROM manager_events WHERE session_id = $1 AND event_type = 'wp.dispatched'`, [wfId],
    )
    expect(ev.rows).toHaveLength(1)
  })

  it('선형 그래프는 루트만 디스패치하고 후행은 DoR 미충족으로 보류한다', async () => {
    const wfId = `wf-disp-${Date.now()}-c`
    const repo = new TaskGraphRepo(pool)
    const store = new DispatchStore(pool)
    await repo.upsertGraph({ workflowId: wfId, workPackages: [wp('a'), wp('b', ['a']), wp('c', ['b'])] })

    const out = await handleDispatch(wfId, { repo, store })
    expect(out.dispatched.map((x) => x.wpId)).toEqual(['a']) // b,c는 a 미완으로 blocked
    const log = await pool.query(`SELECT wp_id FROM wp_state_log WHERE workflow_id = $1`, [wfId])
    expect(log.rows.map((r) => r.wp_id)).toEqual(['a'])
  })

  it('루프 중간 실패 시 완료분은 보존되고 재실행이 이어받는다(per-WP tx 원자성 + resumable)', async () => {
    const wfId = `wf-disp-${Date.now()}-d`
    const repo = new TaskGraphRepo(pool)
    const realStore = new DispatchStore(pool)
    await repo.upsertGraph({ workflowId: wfId, workPackages: [wp('a'), wp('b'), wp('c')] })

    // 2번째 recordDispatch에서 실패 주입 → handleDispatch가 throw, 'a'만 적재되고 'b'·'c'는 미적재
    let calls = 0
    const flakyStore = {
      recordDispatch: (input: Parameters<DispatchStore['recordDispatch']>[0]) => {
        calls += 1
        if (calls === 2) return Promise.reject(new Error('injected'))
        return realStore.recordDispatch(input)
      },
    } as unknown as DispatchStore

    await expect(handleDispatch(wfId, { repo, store: flakyStore })).rejects.toThrow('injected')

    // 완료분('a')만 보존 — manager_events·wp_state_log·manager_outbox 모두 1건씩
    const log1 = await pool.query(`SELECT wp_id FROM wp_state_log WHERE workflow_id = $1 ORDER BY wp_id`, [wfId])
    expect(log1.rows.map((r) => r.wp_id)).toEqual(['a'])
    const ev1 = await pool.query(`SELECT seq FROM manager_events WHERE session_id = $1`, [wfId])
    expect(ev1.rows).toHaveLength(1)
    const ob1 = await pool.query(`SELECT id FROM manager_outbox WHERE stream = $1`, [`manager:events:${wfId}`])
    expect(ob1.rows).toHaveLength(1)

    // 재실행(정상 store): 'a'는 skip, 'b'·'c'만 새로 적재(중복 0)
    const out = await handleDispatch(wfId, { repo, store: realStore })
    expect(out.dispatched.map((x) => x.wpId)).toEqual(['b', 'c'])
    expect(out.skipped).toBe(1) // 'a'
    const log2 = await pool.query(`SELECT wp_id FROM wp_state_log WHERE workflow_id = $1 ORDER BY wp_id`, [wfId])
    expect(log2.rows.map((r) => r.wp_id)).toEqual(['a', 'b', 'c']) // 'a' 중복 없음
  })
})
