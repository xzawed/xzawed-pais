import { describe, it, expect, vi } from 'vitest'
import { createPool, runMigrations, closePool } from '../src/db/pool.js'
import { TaskGraphRepo } from '../src/db/task-graph.repo.js'
import { DispatchStore } from '../src/db/dispatch.repo.js'
import { LeaseStore } from '../src/db/lease.repo.js'
import { handleDispatch, type DispatchDeps } from '../src/streams/dispatch.js'
import { handleWpDispatchSignal, type WorkerDeps } from '../src/streams/worker.js'
import { handleCompletion } from '../src/streams/completion.js'
import { PROFILES, resolveProfileEnv } from '../src/config.js'
import type { WorkPackage } from '@xzawed/agent-streams'

/**
 * G9 Slice A — 프리미엄(autonomous) 프로필 아크 E2E (in-process).
 *
 * 목적: `PAIS_PROFILE=autonomous`가 켜는 검증 게이트 하에서 build→WP→verify→완료 아크가
 * end-to-end로 닫힘을 **제로 flake**로 증명한다(품질 주장 근거). 실 PG + 실 dispatch/worker/completion
 * 함수를 in-process로 구동하되(소비자·Redis·LLM 없음) fake 에이전트 핸들러를 주입한다.
 *
 * ⚠️ fail-closed 사각(설계 스펙 2026-07-18): fake 핸들러는 반드시 judgePrimaryResult 계약을 만족해야
 * 게이트가 열린다 — build_project `{success:true}` · run_tests `{success:true,passed>0,failed:0}`.
 * 불만족 시 게이트가 조용히 fail-closed → DONE에 영원히 미도달. develop_code WP의 파생 검증은
 * userContext.workspaceRoot가 영속돼야만 실행된다(부재=fail-closed).
 *
 * 배선 증명(실 Redis 소비자 조립)은 Slice C 소관(별도 PR).
 */

// dispatch_signal 메시지 봉투(execution-worker.integration 패턴 재사용).
function sig(wf: string, wpId: string, attempt: number) {
  return {
    envelope: {
      eventId: '1', correlationId: wf, causationId: null, workflowId: wf,
      stepId: `wp.dispatch_signal:${wpId}`, attemptId: attempt,
      idempotencyKey: `${wf}:wp.dispatch_signal:${wpId}:${attempt}`, occurredAt: 1,
    },
    type: 'wp.dispatch_signal' as const,
    payload: { wpId, attempt },
  }
}

// CI(turborepo 잡)는 TEST_DATABASE_URL을 주입 — 게이트 통일(execution-worker.integration 패턴).
const url = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL']

/** 'wf-g9a-%' prefix 스코프 정리(FK 순서: outbox→events→state→leases→graphs). 형제 통합 테스트 병렬 간섭 방지. */
async function cleanup(pool: import('pg').Pool): Promise<void> {
  await pool.query("DELETE FROM manager_outbox WHERE event_id IN (SELECT event_id FROM manager_events WHERE session_id LIKE 'wf-g9a-%')").catch(() => undefined)
  await pool.query("DELETE FROM manager_events WHERE session_id LIKE 'wf-g9a-%'").catch(() => undefined)
  await pool.query("DELETE FROM wp_state_log WHERE workflow_id LIKE 'wf-g9a-%'").catch(() => undefined)
  await pool.query("DELETE FROM wp_leases WHERE workflow_id LIKE 'wf-g9a-%'").catch(() => undefined)
  await pool.query("DELETE FROM task_graphs WHERE workflow_id LIKE 'wf-g9a-%'").catch(() => undefined)
}

describe('G9 프리미엄 프로필 아크 E2E (autonomous 프로필이 build→WP→verify→완료를 폐합)', () => {
  it('autonomous 프로필 프리셋이 자율 아크 플래그(분해·워커·검증)를 켠다', () => {
    // 이 E2E가 임의 플래그가 아니라 **프리미엄 프로필**을 증명함을 고정한다 — verifyEnabled는 MANAGER_WP_VERIFY 모델.
    expect(PROFILES['autonomous']).toBeDefined()
    const env = resolveProfileEnv({ PAIS_PROFILE: 'autonomous' } as NodeJS.ProcessEnv)
    expect(env['TASK_MANAGER_ENABLED']).toBe('true')
    expect(env['MANAGER_DECOMPOSE_ENABLED']).toBe('true')
    expect(env['MANAGER_TASK_WORKER']).toBe('true')
    expect(env['MANAGER_WP_VERIFY']).toBe('true')
    // 프로필 정직성: RELEASE_GATE는 프리셋에 없다 → 아크 종단 신호는 "모든 WP DONE"(설계 스펙).
    expect(env['MANAGER_RELEASE_GATE']).toBeUndefined()
  })

  it.skipIf(!url)('의존 그래프(a→b)를 검증 게이트 하에 디스패치→verify→완료→unblock→재디스패치로 전부 DONE', async () => {
    const pool = createPool(url!)
    try {
      await runMigrations(pool)
      const repo = new TaskGraphRepo(pool)
      const store = new DispatchStore(pool)
      const leaseStore = new LeaseStore(pool)
      const wf = `wf-g9a-${Date.now()}`

      // develop_code WP 2개(a → b 의존). 검증 게이트 파생 체크(build+test)가 실행되려면 workspaceRoot 필수.
      //  oracleRef non-null: autonomous 프로필은 MANAGER_ORACLE_DOR를 켜지 않으므로 기본 DoR 게이트
      //  (readiness.ts: oracleRef != null)가 적용된다 — 분해가 생성하는 WP는 oracleRef를 가진다(실 프로필 경로).
      const uc = { userId: 'u1', projectId: 'p1', workspaceRoot: '/workspace/g9', tenantId: 'org-g9' }
      const a: WorkPackage = { id: 'a', storyId: 's1', owningRole: 'developer', oracleRef: 'or-a', acceptanceCriteria: ['AC1'], dependencies: [], attributionCounters: {}, status: 'draft' }
      const b: WorkPackage = { id: 'b', storyId: 's2', owningRole: 'developer', oracleRef: 'or-b', acceptanceCriteria: ['AC2'], dependencies: ['a'], attributionCounters: {}, status: 'draft' }
      await repo.upsertGraph({ workflowId: wf, workPackages: [a, b], eventId: null, userContext: uc })

      // fake 결정론 에이전트 핸들러 — judgePrimaryResult 계약 만족(fail-closed 사각 회피).
      //  develop_code: 산출물(artifacts). judgePrimaryResult('develop_code')는 무조건 ok — 파생 build/test가 실 게이트.
      //  build_project: {success:true} 필수. run_tests: {success:true,passed>0,failed:0} 필수(passed>0 = vacuous-pass 봉합).
      const develop = vi.fn().mockResolvedValue({ artifacts: [] })
      const build = vi.fn().mockResolvedValue({ success: true })
      const test = vi.fn().mockResolvedValue({ success: true, passed: 3, failed: 0 })
      const handlers = { develop_code: { execute: develop }, build_project: { execute: build }, run_tests: { execute: test } }

      // 워커 publish는 capture — 아크가 wp.completion을 실제로 발행함을 증명.
      const emitted: Array<{ type: string; payload: { wpId: string } }> = []
      const workerDeps: WorkerDeps = {
        repo, handlers,
        publish: async (_s, msg) => { emitted.push(msg as never); return '1-0' },
        verifyEnabled: true, // = MANAGER_WP_VERIFY(프로필). 파생 build+test 실행 + fail-closed 판정.
      }

      // dispatch/completion은 같은 DispatchDeps 공유 → 완료가 done-set에 반영돼 후행 unblock(재디스패치 일관).
      const dispatchDeps: DispatchDeps = { repo, store, visibilityMs: 600_000 }

      // 초기 디스패치: a만 ready(b는 a 의존). 의존 게이팅 증명.
      const d0 = await handleDispatch(wf, dispatchDeps)
      expect(d0.dispatched.map((x) => x.wpId)).toEqual(['a'])

      // 아크 드레인: 디스패치된 WP를 워커→검증→완료로 구동하고, 완료가 unblock한 후행을 이어서 처리.
      const pending = d0.dispatched.map((x) => x.wpId)
      const completedOrder: string[] = []
      let guard = 0
      while (pending.length > 0) {
        if (++guard > 20) throw new Error('아크가 수렴하지 않음(무한 루프 방지)')
        const wpId = pending.shift()!
        const w = await handleWpDispatchSignal(sig(wf, wpId, 0), workerDeps)
        expect(w).toEqual({ status: 'completed', wpId }) // 검증 게이트 통과 → 완료 발행
        const c = await handleCompletion(wf, wpId, { leaseStore, dispatch: dispatchDeps })
        expect(c.status).toBe('completed')
        completedOrder.push(wpId)
        for (const x of c.dispatched) pending.push(x.wpId)
      }

      // 아크 폐합 단언: 두 WP 모두 DONE·lease released, 위상 순서(a 먼저), wp.completion 발행.
      expect(completedOrder).toEqual(['a', 'b'])
      const states = await repo.latestStates(wf)
      expect(states.get('a')?.toState).toBe('DONE')
      expect(states.get('b')?.toState).toBe('DONE')
      expect((await leaseStore.getLease(wf, 'a'))?.status).toBe('released')
      expect((await leaseStore.getLease(wf, 'b'))?.status).toBe('released')
      expect(emitted.filter((m) => m.type === 'wp.completion').map((m) => m.payload.wpId).sort()).toEqual(['a', 'b'])

      // 검증 게이트가 실제로 파생 build+test를 각 WP에 실행했음(프로필 verify가 휴면이 아님).
      expect(build).toHaveBeenCalledTimes(2)
      expect(test).toHaveBeenCalledTimes(2)

      // G11 Slice 4: 태그가 아크 전 구간(그래프→lease→검증증거)에 실제로 박혔는지 end-to-end 확인.
      const graphTag = await pool.query<{ tenant_id: string | null }>(
        `SELECT tenant_id FROM task_graphs WHERE workflow_id = $1`, [wf],
      )
      expect(graphTag.rows[0]?.tenant_id).toBe('org-g9')

      const leaseTags = await pool.query<{ tenant_id: string | null }>(
        `SELECT tenant_id FROM wp_leases WHERE workflow_id = $1`, [wf],
      )
      expect(leaseTags.rows).toHaveLength(2)
      expect(leaseTags.rows.every((r) => r.tenant_id === 'org-g9')).toBe(true)
    } finally {
      await cleanup(pool)
      await closePool()
    }
  })
})
