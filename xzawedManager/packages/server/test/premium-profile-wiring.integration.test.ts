import { describe, it, expect, vi } from 'vitest'
import type { Redis } from 'ioredis'
import { makeEnvelope } from '@xzawed/agent-streams'
import type { WorkPackage } from '@xzawed/agent-streams'
import { createPool, runMigrations, closePool } from '../src/db/pool.js'
import { TaskGraphRepo } from '../src/db/task-graph.repo.js'
import { DispatchStore } from '../src/db/dispatch.repo.js'
import { LeaseStore } from '../src/db/lease.repo.js'
import { createRedisClient } from '../src/streams/redis.client.js'
import { RedisEventBus } from '@xzawed/agent-streams'
import { createSupervisor } from '../src/streams/supervisor.js'

/**
 * G9 Slice C — 프리미엄(autonomous) 프로필 **배선 증명** E2E (실 Redis 소비자).
 *
 * Slice A가 증명 못 하는 것을 증명한다: `createSupervisor`가 조립하는 **실 BaseConsumer 루프**가
 * Redis 스트림을 통해 decomposition→dispatch→worker(verify)→completion→unblock→재디스패치 아크를
 * 실제로 닫는가. 이 코드베이스의 역사적 리스크는 "미배선"(플래그 on인데 소비자 휴면)이며, Slice A는
 * 핸들러를 직접 호출해 소비자를 우회하므로 그 리스크를 구조적으로 증명하지 못한다.
 *
 * 결정론: decompose LLM은 `decomposition.emitted` 직접 시드로 우회하고, 외부 에이전트는 fake
 * AgentExecutor로 대체한다. 유일한 비결정성은 비동기 소비자 수렴 → 바운드 폴링으로 통제한다.
 *
 * 게이트: REDIS_URL + TEST_DATABASE_URL 둘 다 있어야 실행(Manager turborepo 잡은 redis 없어 skip,
 * 전용 manager-redis-integration 잡에서만 활성).
 */

const dbUrl = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL']
const redisUrl = process.env['REDIS_URL']

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const DECOMP_STREAM = 'manager:decomposition:main'
const DECOMP_GROUP = 'manager-taskgraph-consumers'

async function cleanupDb(pool: import('pg').Pool): Promise<void> {
  await pool.query("DELETE FROM manager_outbox WHERE event_id IN (SELECT event_id FROM manager_events WHERE session_id LIKE 'wf-g9c-%')").catch(() => undefined)
  await pool.query("DELETE FROM manager_events WHERE session_id LIKE 'wf-g9c-%'").catch(() => undefined)
  await pool.query("DELETE FROM wp_state_log WHERE workflow_id LIKE 'wf-g9c-%'").catch(() => undefined)
  await pool.query("DELETE FROM wp_leases WHERE workflow_id LIKE 'wf-g9c-%'").catch(() => undefined)
  await pool.query("DELETE FROM task_graphs WHERE workflow_id LIKE 'wf-g9c-%'").catch(() => undefined)
}

describe.skipIf(!dbUrl || !redisUrl)('G9 배선 증명 E2E (실 Redis 소비자가 프리미엄 아크를 닫는다)', () => {
  it('decomposition.emitted 시드 → 실 소비자 루프가 dispatch→verify→completion→재디스패치로 전부 DONE', async () => {
    const pool = createPool(dbUrl!)
    // makeRedis가 만드는 모든 연결을 추적 → teardown에서 disconnect(블로킹 XREADGROUP 즉시 종료).
    const conns: Redis[] = []
    const track = (): Redis => { const r = createRedisClient(redisUrl!); conns.push(r); return r }
    const wf = `wf-g9c-${Date.now()}`

    // 시딩 레이스 방지: ensureGroup은 '$'로 그룹을 만들어 그 전 발행 메시지를 놓친다. decomposition 그룹만
    // '0'으로 선-생성하면(start의 ensureGroup은 BUSYGROUP 무시) start 이후 시드가 확실히 전달된다.
    const seedConn = track()
    await seedConn.xgroup('CREATE', DECOMP_STREAM, DECOMP_GROUP, '0', 'MKSTREAM').catch(() => undefined)

    const bus = new RedisEventBus(track())
    const repo = new TaskGraphRepo(pool)

    // fake 결정론 에이전트 핸들러 — judgePrimaryResult 계약 만족(Slice A와 동일).
    const develop = vi.fn().mockResolvedValue({ artifacts: [] })
    const build = vi.fn().mockResolvedValue({ success: true })
    const test = vi.fn().mockResolvedValue({ success: true, passed: 3, failed: 0 })
    const handlers = { develop_code: { execute: develop }, build_project: { execute: build }, run_tests: { execute: test } }

    const supervisor = createSupervisor(
      track,
      {
        repo,
        dispatchStore: new DispatchStore(pool),
        leaseStore: new LeaseStore(pool),
        publish: (stream, message) => bus.publish(stream, message),
        handlers,
      },
      {
        sweepMs: 1_000, visibilityMs: 600_000, maxAttempts: 3,
        oracleDor: false, // 프로필 기본(기본 DoR: oracleRef != null)
        taskWorker: true, // = MANAGER_TASK_WORKER(실 WorkerConsumer 배선)
        wpVerify: true,   // = MANAGER_WP_VERIFY(완료 전 fail-closed 검증)
      },
    )

    try {
      await runMigrations(pool)
      supervisor.start()

      // develop_code WP 2개(a→b 의존). userContext.workspaceRoot 절대경로(AbsoluteUserContextSchema·파생 검증 조건).
      const uc = { userId: 'u1', projectId: 'p1', workspaceRoot: '/workspace/g9c' }
      const a: WorkPackage = { id: 'a', storyId: 's1', owningRole: 'developer', oracleRef: 'or-a', acceptanceCriteria: ['AC1'], dependencies: [], attributionCounters: {}, status: 'draft' }
      const b: WorkPackage = { id: 'b', storyId: 's2', owningRole: 'developer', oracleRef: 'or-b', acceptanceCriteria: ['AC2'], dependencies: ['a'], attributionCounters: {}, status: 'draft' }

      // 분해 LLM 우회: decomposition.emitted를 직접 시드(실 DecompositionConsumer가 소비→그래프 영속→handleDispatch).
      await bus.publish(DECOMP_STREAM, {
        envelope: makeEnvelope({ correlationId: wf, causationId: null, workflowId: wf, stepId: 'decomposition.emitted', attemptId: 0 }, Date.now()),
        type: 'decomposition.emitted',
        payload: { workPackages: [a, b], oracleDrafts: [], userContext: uc },
      })

      // 바운드 폴링: 실 소비자 루프가 아크를 닫을 때까지(fake 핸들러 즉시 반환이라 빠르게 수렴).
      const deadline = Date.now() + 30_000
      let done = false
      while (Date.now() < deadline) {
        const states = await repo.latestStates(wf)
        if (states.get('a')?.toState === 'DONE' && states.get('b')?.toState === 'DONE') { done = true; break }
        await sleep(200)
      }
      expect(done).toBe(true)

      // 배선 증명: 두 WP 모두 실 소비자 경로로 DONE·lease released·검증 게이트가 각 WP에 build+test 실행.
      const states = await repo.latestStates(wf)
      expect(states.get('a')?.toState).toBe('DONE')
      expect(states.get('b')?.toState).toBe('DONE')
      const leaseStore2 = new LeaseStore(pool)
      expect((await leaseStore2.getLease(wf, 'a'))?.status).toBe('released')
      expect((await leaseStore2.getLease(wf, 'b'))?.status).toBe('released')
      expect(build).toHaveBeenCalled()
      expect(test).toHaveBeenCalled()
    } finally {
      supervisor.stop()
      // redis 스트림 정리(disconnect 전·살아있는 연결로) — 공유 로컬 redis 누적 방지. CI는 fresh redis라 무해.
      await seedConn.del(DECOMP_STREAM).catch(() => undefined)
      // disconnect(force)로 블로킹 XREADGROUP을 즉시 종료(quit은 pending read 대기로 hang 가능).
      for (const c of conns) { try { c.disconnect() } catch { /* noop */ } }
      await cleanupDb(pool).catch(() => undefined)
      await closePool()
    }
  }, 40_000)
})
