import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createPool, runMigrations, closePool } from '../src/db/pool.js'
import { TaskGraphRepo } from '../src/db/task-graph.repo.js'
import { handleDecompositionEmitted, type DecompositionEmittedMessage } from '../src/streams/decomposition-consumer.js'
import type { WorkPackage, EventEnvelope } from '@xzawed/agent-streams'
import type { Pool } from 'pg'
import { randomUUID } from 'node:crypto'

/**
 * 재진입 병합 **pg 통합**(S6.2).
 *
 * 계획서가 이 슬라이스에만 "유닛으로는 위음성"을 명시했다. 이유가 구조적이다 —
 * `mergeKeepInflight` 의 기본 술어는 `wp.status` 를 읽는데 `graph_dag` 의 status 는
 * 프로덕션에서 영원히 `DRAFTED` 라 **항상 공집합**이다. 진행 상태는 `wp_state_log` 에만 있으므로
 * "진짜 전이가 기록된 상태에서 재분해가 그것을 보존하는가"는 실 DB 왕복으로만 증명된다.
 *
 * **양방향으로 건다.** 보존만 확인하면 술어가 `() => true` 여도 통과한다 —
 * 전이가 없을 때 **갱신되는지**를 함께 봐야 술어가 실제로 로그를 읽는다는 증거가 된다.
 */

const url = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL']
const d = url ? describe : describe.skip

const wp = (id: string, deps: string[] = [], ac: string[] = []): WorkPackage => ({
  id, storyId: 'story-1', owningRole: 'developer', oracleRef: null,
  acceptanceCriteria: ac, dependencies: deps, attributionCounters: {}, status: 'DRAFTED',
})

const env = (workflowId: string): EventEnvelope => ({
  eventId: randomUUID(), correlationId: workflowId, causationId: null,
  idempotencyKey: `${workflowId}:dec:1`, workflowId, stepId: 'dec', attemptId: 0, occurredAt: 2000,
})

const msg = (workflowId: string, workPackages: WorkPackage[]): DecompositionEmittedMessage => ({
  envelope: env(workflowId), type: 'decomposition.emitted', payload: { workPackages, oracleDrafts: [] },
})

d('재진입 병합 통합 (pg)', () => {
  let pool: Pool
  let repo: TaskGraphRepo

  beforeAll(async () => {
    pool = createPool(url!)
    await runMigrations(pool)
    repo = new TaskGraphRepo(pool)
  })
  afterAll(async () => {
    // prefix 스코프 정리 — 비스코프 DELETE 는 병렬 형제 통합 테스트의 행을 지운다.
    await pool.query("DELETE FROM wp_state_log WHERE workflow_id LIKE 'wf-rem-%'")
    await pool.query("DELETE FROM task_graphs WHERE workflow_id LIKE 'wf-rem-%'")
    await closePool()
  })

  it('전이가 기록된 WP 는 재분해가 덮지 않는다(F1 봉합)', async () => {
    const wfId = `wf-rem-${Date.now()}-keep`
    await repo.upsertGraph({ workflowId: wfId, workPackages: [wp('a', [], ['원본']), wp('b')] })
    // 실제 writer 로 전이를 남긴다 — S6.1 가드를 통과하는 합법 전이.
    await repo.appendTransition({ workflowId: wfId, wpId: 'a', fromState: 'DRAFTED', toState: 'DISPATCHED' })

    const out = await handleDecompositionEmitted(
      msg(wfId, [wp('a', [], ['재분해']), wp('c')]),
      { repo, publish: vi.fn().mockResolvedValue('1-0') },
    )

    expect(out.status).toBe('persisted')
    const got = await repo.getGraph(wfId)
    const a = got?.workPackages.find((w) => w.id === 'a')
    expect(a?.acceptanceCriteria, '진행 중 WP 가 덮였다').toEqual(['원본'])
    expect(got?.workPackages.map((w) => w.id).sort()).toEqual(['a', 'c'])
  })

  it('전이가 없으면 같은 WP 가 갱신된다(술어가 로그를 실제로 읽는다는 반대 증거)', async () => {
    const wfId = `wf-rem-${Date.now()}-replace`
    await repo.upsertGraph({ workflowId: wfId, workPackages: [wp('a', [], ['원본'])] })
    // 전이 기록 없음.

    await handleDecompositionEmitted(
      msg(wfId, [wp('a', [], ['재분해'])]),
      { repo, publish: vi.fn().mockResolvedValue('1-0') },
    )

    const got = await repo.getGraph(wfId)
    expect(got?.workPackages.find((w) => w.id === 'a')?.acceptanceCriteria).toEqual(['재분해'])
  })

  it('DONE 으로 끝난 WP 도 되살아나지 않는다', async () => {
    const wfId = `wf-rem-${Date.now()}-done`
    await repo.upsertGraph({ workflowId: wfId, workPackages: [wp('a', [], ['완료본'])] })
    await repo.appendTransition({ workflowId: wfId, wpId: 'a', fromState: 'DRAFTED', toState: 'DISPATCHED' })
    await repo.appendTransition({ workflowId: wfId, wpId: 'a', fromState: 'DISPATCHED', toState: 'DONE' })

    await handleDecompositionEmitted(
      msg(wfId, [wp('a', [], ['재초안'])]),
      { repo, publish: vi.fn().mockResolvedValue('1-0') },
    )

    const got = await repo.getGraph(wfId)
    expect(got?.workPackages.find((w) => w.id === 'a')?.acceptanceCriteria).toEqual(['완료본'])
  })

  it('최신 전이만 본다 — ESCALATED 후 DISPATCHED 로 재개된 WP 도 보존', async () => {
    const wfId = `wf-rem-${Date.now()}-reopen`
    await repo.upsertGraph({ workflowId: wfId, workPackages: [wp('a', [], ['원본'])] })
    await repo.appendTransition({ workflowId: wfId, wpId: 'a', fromState: 'DRAFTED', toState: 'DISPATCHED' })
    await repo.appendTransition({ workflowId: wfId, wpId: 'a', fromState: 'DISPATCHED', toState: 'ESCALATED' })
    await repo.appendTransition({ workflowId: wfId, wpId: 'a', fromState: 'ESCALATED', toState: 'DISPATCHED' })

    await handleDecompositionEmitted(
      msg(wfId, [wp('a', [], ['재초안'])]),
      { repo, publish: vi.fn().mockResolvedValue('1-0') },
    )

    const got = await repo.getGraph(wfId)
    expect(got?.workPackages.find((w) => w.id === 'a')?.acceptanceCriteria).toEqual(['원본'])
  })

  it('보존 노드의 의존이 incoming 에서 빠져도 폐포가 유지된다(dangling 0)', async () => {
    const wfId = `wf-rem-${Date.now()}-closure`
    await repo.upsertGraph({ workflowId: wfId, workPackages: [wp('dep'), wp('a', ['dep'], ['원본'])] })
    await repo.appendTransition({ workflowId: wfId, wpId: 'a', fromState: 'DRAFTED', toState: 'DISPATCHED' })

    await handleDecompositionEmitted(
      msg(wfId, [wp('z')]),
      { repo, publish: vi.fn().mockResolvedValue('1-0') },
    )

    const got = await repo.getGraph(wfId)
    // dep 이 빠지면 a 의 의존이 dangling 이 되어 이후 buildTaskGraph 가 throw 한다.
    expect(got?.workPackages.map((w) => w.id).sort()).toEqual(['a', 'dep', 'z'])
  })

  it('최초 분해(기존 그래프 없음)는 incoming 을 그대로 영속한다', async () => {
    const wfId = `wf-rem-${Date.now()}-first`
    const out = await handleDecompositionEmitted(
      msg(wfId, [wp('a'), wp('b', ['a'])]),
      { repo, publish: vi.fn().mockResolvedValue('1-0') },
    )
    expect(out).toEqual({ status: 'persisted', version: 1 })
    const got = await repo.getGraph(wfId)
    expect(got?.workPackages.map((w) => w.id)).toEqual(['a', 'b'])
  })

  it('병합이 사이클을 만들면 영속하지 않고 기존 그래프를 남긴다', async () => {
    const wfId = `wf-rem-${Date.now()}-cycle`
    await repo.upsertGraph({ workflowId: wfId, workPackages: [wp('a', ['b'], ['원본']), wp('b')] })
    await repo.appendTransition({ workflowId: wfId, wpId: 'a', fromState: 'DRAFTED', toState: 'DISPATCHED' })
    const before = await repo.getGraph(wfId)

    // incoming: b → a. a 는 보존(a→b)이므로 합치면 a↔b 순환.
    const out = await handleDecompositionEmitted(
      msg(wfId, [wp('b', ['a']), wp('a')]),
      { repo, publish: vi.fn().mockResolvedValue('1-0') },
    )

    expect(out).toEqual({ status: 'inconsistent', reason: 'cycle' })
    const after = await repo.getGraph(wfId)
    expect(after?.version, '영속되면 안 된다').toBe(before?.version)
    expect(after?.workPackages.find((w) => w.id === 'a')?.acceptanceCriteria).toEqual(['원본'])
  })
})
