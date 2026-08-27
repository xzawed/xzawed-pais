import { describe, test, expect, vi } from 'vitest'
import type { WorkPackage } from '@xzawed/agent-streams'
import { handleWpDispatchSignal, type WorkerDeps } from './worker.js'
import type { WpDispatchSignalMessage } from './dispatch-signal.js'

const wp = { id: 'wp-1', storyId: 's1', owningRole: 'developer', acceptanceCriteria: ['AC1'] } as unknown as WorkPackage
/** 검증이 켜지면 workspaceRoot 가 없을 때 fail-closed 다 — 파생 체크의 대상 경로가 불명이기 때문. */
const WS = { userId: 'u', projectId: 'p', workspaceRoot: '/ws' }
const msg = { envelope: { workflowId: 'wf-1' }, payload: { wpId: 'wp-1', attempt: 0 } } as unknown as WpDispatchSignalMessage

function baseDeps(over: Partial<WorkerDeps> = {}): WorkerDeps {
  return {
    repo: {
      getGraph: vi.fn().mockResolvedValue({ workPackages: [wp], userContext: WS }),
      latestStates: vi.fn().mockResolvedValue(new Map()),
    } as unknown as WorkerDeps['repo'],
    // verifyEnabled 면 파생 체크가 build_project·run_tests 를 실제로 부른다(N1: 선언이 아니라 실행 결과).
    handlers: {
      develop_code: { execute: vi.fn().mockResolvedValue({ artifacts: ['src/x.ts'] }) },
      build_project: { execute: vi.fn().mockResolvedValue({ success: true }) },
      run_tests: { execute: vi.fn().mockResolvedValue({ success: true, passed: 3, failed: 0 }) },
    },
    publish: vi.fn().mockResolvedValue(undefined),
    // 정책(2026-08-28): advisory 는 **통과한 verdict** 뒤에만 생산된다. develop_code 는 채널이
    // 전부 꺼진 기본 구성에서 verdict.ok 라 이 기준선은 "검증 통과 후"를 뜻한다.
    verifyEnabled: true,
    ...over,
  }
}
const okClaude = { messages: { create: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({ findings: [{ title: 'a', rationale: 'r' }] }) }] }) } }

describe('worker advisory 통합 (N3)', () => {
  test('N3-a: advisory가 findings를 내도 WP는 정상 완료(verdict 경로 불변)', async () => {
    const recordFindings = vi.fn().mockResolvedValue(undefined)
    const deps = baseDeps({
      advisoryEnabled: true, advisoryStore: { recordFindings }, claude: okClaude as never, model: 'm', timeoutMs: 1000,
    })
    const out = await handleWpDispatchSignal(msg, deps)
    expect(out).toEqual({ status: 'completed', wpId: 'wp-1' })
    expect(deps.publish).toHaveBeenCalled() // wp.completion 발행됨
    expect(recordFindings).toHaveBeenCalledTimes(1)
  })

  test('N3-b: advisory 생산자가 throw(LLM 오류)해도 WP는 정상 완료', async () => {
    const recordFindings = vi.fn().mockResolvedValue(undefined)
    const throwClaude = { messages: { create: vi.fn().mockRejectedValue(new Error('boom')) } }
    const deps = baseDeps({
      advisoryEnabled: true, advisoryStore: { recordFindings }, claude: throwClaude as never, model: 'm', timeoutMs: 1000,
    })
    const out = await handleWpDispatchSignal(msg, deps)
    expect(out).toEqual({ status: 'completed', wpId: 'wp-1' })
    expect(recordFindings).not.toHaveBeenCalled()
  })

  test('N3-c: advisory 비활성(미주입)이면 advisory 미호출·완료 동작 P4b 동일(회귀 0)', async () => {
    const deps = baseDeps() // advisoryEnabled 미주입
    const out = await handleWpDispatchSignal(msg, deps)
    expect(out).toEqual({ status: 'completed', wpId: 'wp-1' })
  })

  test('develop_code가 아닌 WP는 advisory 미호출', async () => {
    const recordFindings = vi.fn().mockResolvedValue(undefined)
    const designWp = { ...wp, owningRole: 'designer' } as WorkPackage
    const deps = baseDeps({
      repo: {
        getGraph: vi.fn().mockResolvedValue({ workPackages: [designWp], userContext: undefined }),
        latestStates: vi.fn().mockResolvedValue(new Map()),
      } as unknown as WorkerDeps['repo'],
      handlers: { design_ui: { execute: vi.fn().mockResolvedValue({ artifacts: [] }) } },
      advisoryEnabled: true, advisoryStore: { recordFindings }, claude: okClaude as never, model: 'm', timeoutMs: 1000,
    })
    await handleWpDispatchSignal(msg, deps)
    expect(recordFindings).not.toHaveBeenCalled()
  })
})

/**
 * **정책 봉인 — advisory 는 통과한 verdict 를 전제한다(사람 결정, 2026-08-28).**
 *
 * "정상 동작과 안정성이 먼저이고 최적화는 그다음"이다. 실측하면 이 정책의 절반은 원래도
 * 지켜지고 있었다 — 실패한 verdict 는 워커 호출부의 `if (gate) return gate` 가 이미 막았다.
 * 남은 구멍은 **검증이 꺼져 판정 자체가 없는** 경우였고, 그때도 advisory 가 생산됐다.
 *
 * 아래 둘이 그 정책의 양끝이다. 되돌리면 첫째가 깨진다.
 */
describe('advisory 는 통과한 verdict 를 전제한다 (정책 봉인)', () => {
  test('검증이 꺼져 있으면 advisory 를 생산하지 않는다 — WP 완료는 그대로다', async () => {
    const recordFindings = vi.fn().mockResolvedValue(undefined)
    const deps = baseDeps({
      verifyEnabled: false,
      advisoryEnabled: true, advisoryStore: { recordFindings }, claude: okClaude as never, model: 'm', timeoutMs: 1000,
    })
    const out = await handleWpDispatchSignal(msg, deps)
    expect(out).toEqual({ status: 'completed', wpId: 'wp-1' })
    expect(recordFindings).not.toHaveBeenCalled()
  })

  test('verdict 가 실패하면 advisory 를 생산하지 않는다 — 완료도 발행되지 않는다', async () => {
    const recordFindings = vi.fn().mockResolvedValue(undefined)
    const deps = baseDeps({
      // 파생 체크의 build 를 실패시켜 verdict 를 깬다(N1: 실행 결과로만 판정).
      handlers: {
        develop_code: { execute: vi.fn().mockResolvedValue({ artifacts: ['src/x.ts'] }) },
        build_project: { execute: vi.fn().mockResolvedValue({ success: false }) },
        run_tests: { execute: vi.fn().mockResolvedValue({ success: true, passed: 3, failed: 0 }) },
      },
      advisoryEnabled: true, advisoryStore: { recordFindings }, claude: okClaude as never, model: 'm', timeoutMs: 1000,
    })
    const out = await handleWpDispatchSignal(msg, deps)
    expect(out).toMatchObject({ status: 'verification_failed', wpId: 'wp-1' })
    expect(recordFindings).not.toHaveBeenCalled()
  })
})
