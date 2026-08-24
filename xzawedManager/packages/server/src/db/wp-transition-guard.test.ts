import { describe, it, expect, vi } from 'vitest'
import type { PoolClient } from 'pg'
import { makeEnvelope } from '@xzawed/agent-streams'
import { appendWpEvent } from './dispatch.repo.js'
import { TaskGraphRepo } from './task-graph.repo.js'
import { DRAFTED_STATE, DISPATCHED_STATE, DONE_STATE, ESCALATED_STATE } from '../streams/dispatch-constants.js'

/**
 * 전이 검증(S6.1) — `appendWpEvent` 는 `wp_state_log` 로 가는 **프로덕션 단일 초크포인트**다
 * (recordDispatch·recordReclaim·recordEscalation·reopenLease·recordCompletion 5개 writer 가 전부 여기를 지난다).
 *
 * CHECK 제약이 값 집합을 막고, 이 가드가 **순서**를 막는다. 둘은 다른 것을 막는다 —
 * `DONE → DISPATCHED` 는 값은 전부 유효하지만 있어서는 안 되는 전이다.
 */

function fakeClient() {
  const query = vi.fn(async (sql: string) => {
    if (/INSERT INTO wp_state_log/i.test(sql)) return { rows: [{ seq: 1 }] }
    return { rows: [] }
  })
  return { client: { query } as unknown as PoolClient, query }
}

const env = () => makeEnvelope({ workflowId: 'wf-1', idempotencyKey: 'wf-1:wp-a:0' })

const base = {
  workflowId: 'wf-1', wpId: 'wp-a', attempt: 0, stepN: 0,
  eventType: 'wp.dispatched', reason: null, tenantId: null,
}

describe('appendWpEvent — 전이 가드', () => {
  it.each([
    [DRAFTED_STATE, DISPATCHED_STATE],
    [DISPATCHED_STATE, DISPATCHED_STATE],
    [DISPATCHED_STATE, ESCALATED_STATE],
    [ESCALATED_STATE, DISPATCHED_STATE],
    [DISPATCHED_STATE, DONE_STATE],
  ] as const)('프로덕션 전이 %s → %s 를 통과시킨다', async (fromState, toState) => {
    const { client } = fakeClient()
    await expect(appendWpEvent(client, env(), { ...base, fromState, toState })).resolves.toMatchObject({ seq: 1 })
  })

  it('최초 전이(from 없음)는 허용한다', async () => {
    const { client } = fakeClient()
    await expect(appendWpEvent(client, env(), { ...base, fromState: null, toState: DRAFTED_STATE }))
      .resolves.toMatchObject({ seq: 1 })
  })

  it('정의되지 않은 전이는 거부하고 로그를 쓰지 않는다(fail-closed)', async () => {
    const { client, query } = fakeClient()
    await expect(appendWpEvent(client, env(), { ...base, fromState: DONE_STATE, toState: DISPATCHED_STATE }))
      .rejects.toThrow(/전이/)
    // 거부는 INSERT 이전이어야 한다 — 부분 기록이 남으면 감사 로그가 거짓말을 한다.
    expect(query.mock.calls.some((c) => /INSERT INTO/i.test(String(c[0])))).toBe(false)
  })

  it('enum 밖 값은 거부한다', async () => {
    const { client } = fakeClient()
    await expect(appendWpEvent(client, env(), {
      ...base, fromState: DISPATCHED_STATE, toState: 'IN_PROGRESS' as never,
    })).rejects.toThrow(/상태/)
  })
})

/**
 * **두 번째 writer 도 같은 가드를 지나야 한다.** `TaskGraphRepo.appendTransition` 은 오늘 프로덕션
 * 호출자가 0곳이지만 `wp_state_log` 에 직접 INSERT 한다 — DB CHECK 는 값만 막고 순서는 못 막으므로,
 * 나중에 실 호출자가 붙으면 `DONE → DISPATCHED` 같은 전이가 조용히 기록된다.
 */
describe('TaskGraphRepo.appendTransition — 같은 전이 가드', () => {
  function repoWith() {
    const query = vi.fn(async () => ({ rows: [{ seq: 7 }] }))
    return { repo: new TaskGraphRepo({ query } as never, () => 1), query }
  }

  it('허용 전이는 기록한다', async () => {
    const { repo } = repoWith()
    await expect(repo.appendTransition({
      workflowId: 'wf-1', wpId: 'wp-a', fromState: DRAFTED_STATE, toState: DISPATCHED_STATE,
    })).resolves.toEqual({ seq: 7 })
  })

  it('최초 전이(from 없음)를 기록한다', async () => {
    const { repo } = repoWith()
    await expect(repo.appendTransition({ workflowId: 'wf-1', wpId: 'wp-a', toState: DRAFTED_STATE }))
      .resolves.toEqual({ seq: 7 })
  })

  it('허용되지 않은 전이는 거부하고 INSERT 하지 않는다', async () => {
    const { repo, query } = repoWith()
    await expect(repo.appendTransition({
      workflowId: 'wf-1', wpId: 'wp-a', fromState: DONE_STATE, toState: DISPATCHED_STATE,
    })).rejects.toThrow(/전이/)
    expect(query).not.toHaveBeenCalled()
  })

  it('enum 밖 값은 거부한다', async () => {
    const { repo } = repoWith()
    await expect(repo.appendTransition({
      workflowId: 'wf-1', wpId: 'wp-a', toState: 'IN_PROGRESS' as never,
    })).rejects.toThrow(/상태/)
  })
})
