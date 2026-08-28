import { describe, it, expect, vi } from 'vitest'
import type { WorkPackage } from '@xzawed/agent-streams'
import { hasTraversalSegment } from '@xzawed/agent-streams'
import { isAbsolute, join, resolve } from 'node:path'
import { buildWorkerInput, handleWpDispatchSignal } from './worker.js'
import { toWireArtifacts } from './verify.js'
import { buildWorkerConsumerDeps } from './supervisor.js'

/**
 * **WP 산출물이 후행 WP 의 입력이 된다**(S6.3 / 결함 F7).
 *
 * `buildWorkerInput` 이 모든 WP 에 `artifacts: []` 를 하드코딩했다. Security 의
 * `requested` 는 `payload.artifacts.length` 라서 security_audit WP 의 static 감사는
 * **구조적으로 항상 0건**이었다 — S5.2a 는 그 사실 위에서 "deps 가 돌았으면 증거로 인정"하는
 * 판정을 세워야 했다.
 *
 * **분해가 예측한 I/O 가 아니라 실행이 실제로 낸 것을 쓴다.** Developer 는 이미 변경한 파일
 * 경로를 `artifacts` 로 돌려준다(`xzawedDeveloper/src/developer.ts`) — 예측할 필요가 없다.
 */

const wp = (over: Partial<WorkPackage> = {}): WorkPackage => ({
  id: 'a', storyId: 's1', owningRole: 'security', oracleRef: null,
  acceptanceCriteria: ['ac'], dependencies: [], attributionCounters: {}, status: 'DRAFTED',
  inputs: [], outputs: [], risk: 'MEDIUM',
  ...over,
} as unknown as WorkPackage)

const sig = () => ({
  envelope: { workflowId: 'wf1', eventId: 'e', correlationId: 'wf1', causationId: null, stepId: 's', attemptId: 1, occurredAt: 0, idempotencyKey: 'k' },
  type: 'wp.dispatch_signal', payload: { wpId: 'a', attempt: 1 },
}) as never

function deps(over: Record<string, unknown> = {}, w: WorkPackage = wp()) {
  return {
    repo: {
      getGraph: vi.fn().mockResolvedValue({ workPackages: [w], eventId: null, version: 1 }),
      latestStates: vi.fn().mockResolvedValue(new Map()),
    },
    publish: vi.fn().mockResolvedValue(undefined),
    handlers: { security_audit: { execute: vi.fn().mockResolvedValue({ issues: [] }) } },
    ...over,
  } as never
}

describe('buildWorkerInput — 선행 산출물을 그대로 싣는다', () => {
  it('넘긴 artifacts 가 에이전트 입력에 들어간다', () => {
    const input = buildWorkerInput(wp(), undefined, undefined, ['src/a.ts', 'src/b.ts'])
    expect(input['artifacts']).toEqual(['src/a.ts', 'src/b.ts'])
  })

  /** 회귀 0 — 미배선 경로는 이전과 같은 입력이어야 한다. */
  it('안 넘기면 빈 배열이다(이전 동작)', () => {
    expect(buildWorkerInput(wp())['artifacts']).toEqual([])
  })

  it('나머지 필드는 그대로다(에이전트 union safeParse 유지)', () => {
    const before = buildWorkerInput(wp())
    const after = buildWorkerInput(wp(), undefined, undefined, ['x.ts'])
    expect({ ...after, artifacts: [] }).toEqual(before)
  })
})

describe('워커 — 성공한 WP 의 산출물을 기록한다', () => {
  it('결과 artifacts 를 outputStore 에 쓴다', async () => {
    const outputStore = { record: vi.fn().mockResolvedValue(undefined), unionFor: vi.fn().mockResolvedValue([]) }
    const d = deps({
      outputStore,
      handlers: { develop_code: { execute: vi.fn().mockResolvedValue({ artifacts: ['src/x.ts', 'src/y.ts'] }) } },
    }, wp({ owningRole: 'developer' } as Partial<WorkPackage>))
    expect((await handleWpDispatchSignal(sig(), d)).status).toBe('completed')
    expect(outputStore.record).toHaveBeenCalledWith(expect.objectContaining({
      workflowId: 'wf1', wpId: 'a', artifacts: ['src/x.ts', 'src/y.ts'],
    }))
  })

  /** 검증 실패한 실행의 파일을 후행이 감사하면 안 된다 — 통과한 뒤에만 쓴다. */
  it('검증에 실패하면 기록하지 않는다', async () => {
    const outputStore = { record: vi.fn().mockResolvedValue(undefined), unionFor: vi.fn().mockResolvedValue([]) }
    const d = deps({
      outputStore, verifyEnabled: true,
      handlers: { run_tests: { execute: vi.fn().mockResolvedValue({ success: false, failed: 2, passed: 0 }) } },
    }, wp({ owningRole: 'tester' } as Partial<WorkPackage>))
    expect((await handleWpDispatchSignal(sig(), d)).status).toBe('verification_failed')
    expect(outputStore.record).not.toHaveBeenCalled()
  })

  it('기록이 throw 해도 완료는 발행된다(완료가 load-bearing 신호다)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const outputStore = { record: vi.fn().mockRejectedValue(new Error('db down')), unionFor: vi.fn().mockResolvedValue([]) }
    const d = deps({ outputStore })
    expect((await handleWpDispatchSignal(sig(), d)).status).toBe('completed')
  })

  it('미주입이면 기록을 시도하지 않는다(회귀 0)', async () => {
    const d = deps()
    expect((await handleWpDispatchSignal(sig(), d)).status).toBe('completed')
  })
})

describe('워커 — 선행 산출물을 입력으로 넘긴다', () => {
  it('dependencies 의 산출물을 조회해 에이전트 입력에 싣는다', async () => {
    const outputStore = {
      record: vi.fn().mockResolvedValue(undefined),
      unionFor: vi.fn().mockResolvedValue(['src/x.ts', 'src/y.ts']),
    }
    const execute = vi.fn().mockResolvedValue({ issues: [] })
    const d = deps({ outputStore, handlers: { security_audit: { execute } } }, wp({ dependencies: ['dev-1'] } as Partial<WorkPackage>))
    await handleWpDispatchSignal(sig(), d)
    expect(outputStore.unionFor).toHaveBeenCalledWith('wf1', ['dev-1'])
    expect((execute.mock.calls[0]![0] as { artifacts: string[] }).artifacts).toEqual(['src/x.ts', 'src/y.ts'])
  })

  it('dependencies 가 없으면 조회하지 않는다(왕복 0)', async () => {
    const outputStore = { record: vi.fn().mockResolvedValue(undefined), unionFor: vi.fn() }
    await handleWpDispatchSignal(sig(), deps({ outputStore }))
    expect(outputStore.unionFor).not.toHaveBeenCalled()
  })

  it('조회가 throw 하면 빈 입력으로 진행한다(WP 를 죽이지 않는다)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const outputStore = { record: vi.fn().mockResolvedValue(undefined), unionFor: vi.fn().mockRejectedValue(new Error('db down')) }
    const execute = vi.fn().mockResolvedValue({ issues: [] })
    const d = deps({ outputStore, handlers: { security_audit: { execute } } }, wp({ dependencies: ['dev-1'] } as Partial<WorkPackage>))
    expect((await handleWpDispatchSignal(sig(), d)).status).toBe('completed')
    expect((execute.mock.calls[0]![0] as { artifacts: string[] }).artifacts).toEqual([])
  })

  /**
   * **이 슬라이스의 측정 가능한 최종 상태.** security_audit WP 가 선행 develop_code 의 실제
   * 파일을 받으면 Security 의 `requested`(= `payload.artifacts.length`)가 0을 벗어난다.
   * 그 전에는 구조적으로 0이라 static 감사가 한 번도 돌지 않았다.
   */
  it('security_audit WP 의 requested 가 0을 벗어난다(F7 의 실질 효과)', async () => {
    const outputStore = {
      record: vi.fn().mockResolvedValue(undefined),
      unionFor: vi.fn().mockResolvedValue(['src/auth.ts']),
    }
    const execute = vi.fn().mockResolvedValue({ issues: [] })
    const d = deps({ outputStore, handlers: { security_audit: { execute } } }, wp({ dependencies: ['dev-1'] } as Partial<WorkPackage>))
    await handleWpDispatchSignal(sig(), d)
    const sent = execute.mock.calls[0]![0] as { artifacts: string[] }
    expect(sent.artifacts.length, 'Security 의 requested 가 여전히 0이 된다').toBeGreaterThan(0)
  })
})

/** S7.1 에서 배운 것 — 릴레이 한 홉이 빠지면 기능이 통째로 죽고 유닛은 전부 초록이다. */
describe('릴레이 배선 — outputStore 가 워커 deps 까지 도달한다', () => {
  const cfg = { wpVerify: true, visibilityMs: 1000, maxAttempts: 3, sweepMs: 1000, taskWorker: true } as never

  it('전체 deps 스프레드가 outputStore 를 나른다', () => {
    const outputStore = { record: vi.fn(), unionFor: vi.fn() }
    const d = {
      repo: {} as never, dispatchStore: {} as never, leaseStore: {} as never, publish: vi.fn(),
      handlers: { develop_code: { execute: vi.fn() } }, outputStore,
    }
    const worker = buildWorkerConsumerDeps({ ...d, handlers: d.handlers } as never, cfg)
    expect(worker.outputStore, 'createSupervisor 호출부에서 outputStore 가 유실됐다').toBe(outputStore)
  })

  it('미주입이면 키가 생기지 않는다', () => {
    const d = { repo: {} as never, dispatchStore: {} as never, leaseStore: {} as never, publish: vi.fn(), handlers: {} }
    const worker = buildWorkerConsumerDeps({ ...d, handlers: d.handlers } as never, cfg)
    expect('outputStore' in worker).toBe(false)
  })
})

/**
 * **전선 형식 정규화 — S5.1 이 남긴 함정을 그대로 밟을 뻔했다.**
 *
 * Security 의 인바운드 스키마는 `!isAbsolute && !includes('..')` 를 강제하는데
 * (`xzawedSecurity/src/types.ts`) **Developer 는 workspaceRoot 하위 절대경로를 낼 수 있다**
 * (`applyChange` 가 허용한다). 정규화 없이 산출물을 후행 입력으로 흘리면 safeParse 가 실패해
 * DLQ→120초 타임아웃이 된다 — 감사가 안 도는 것보다 나쁘다.
 */
describe('toWireArtifacts — 후행이 파싱할 수 있는 형태로만 넘긴다', () => {
  // 경로 리터럴을 쓰지 않는다 — Windows 구분자를 소스에 박으면 플랫폼마다 다른 것을 테스트하게 된다.
  const root = resolve('/ws')
  const inside = join(root, 'src', 'a.ts')
  const outside = join(resolve('/other'), 'x.ts')

  it('workspaceRoot 하위 절대경로를 상대경로로 바꾼다', () => {
    expect(toWireArtifacts([inside], root)).toEqual(['src/a.ts'])
  })

  it('이미 상대경로면 그대로 둔다', () => {
    expect(toWireArtifacts(['src/b.ts'], root)).toEqual(['src/b.ts'])
  })

  it('workspaceRoot 밖은 버린다(감사 대상이 아니다)', () => {
    expect(toWireArtifacts([outside], root)).toEqual([])
  })

  it('traversal 은 버린다', () => {
    expect(toWireArtifacts(['../etc/passwd'], root)).toEqual([])
  })

  /** 상대화할 근거가 없으면 이미 안전한 것만 남긴다 — 판단 못 하는 것을 통과시키지 않는다. */
  it('workspaceRoot 를 모르면 안전한 것만 남긴다', () => {
    expect(toWireArtifacts(['src/c.ts', inside, '../x'], undefined)).toEqual(['src/c.ts'])
  })

  it('중복과 빈 값을 지운다', () => {
    expect(toWireArtifacts(['a.ts', 'a.ts', ''], root)).toEqual(['a.ts'])
  })

  /** 이 불변식이 깨지면 후행 security_audit 가 DLQ→타임아웃으로 죽는다. */
  it('결과는 전부 Security 인바운드 술어를 만족한다', () => {
    const out = toWireArtifacts([inside, outside, '../x', 'ok/d.ts'], root)
    for (const p of out) {
      expect(isAbsolute(p), `${p} 가 절대경로다`).toBe(false)
      expect(hasTraversalSegment(p), `${p} 에 traversal 이 있다`).toBe(false)
    }
  })
})

/**
 * **판정을 어휘적 → 세그먼트로 바꿨다. 이 블록은 그 전후가 뒤집힌 자리다.**
 *
 * 이전 판은 `patches/v1..v2.diff` 같은 **정상 파일명을 드롭하는 것**을 계약으로 못박고
 * 있었다 — Security 인바운드가 `!includes('..')` 이라 보내면 메시지 전체가 DLQ 되기
 * 때문이었다. 생산자가 "소비자가 못 받는 값을 만들지 않는다"로 대응한 것이고, 대가는
 * **그 파일이 감사에서 빠지는 것**이었다.
 *
 * 이제 양쪽이 `isSafeRelativePath`(세그먼트 판정)를 **공유**하므로 그 대가가 없다.
 * 정상 파일명은 그대로 흘러가고 진짜 상위 이동만 걸린다.
 */
describe('toWireArtifacts — 세그먼트 판정: 정상 파일명은 흘려보낸다', () => {
  const root = resolve('/ws')

  it.each([
    ['patches/v1..v2.diff', '버전 범위 파일명'],
    ['a..b.ts', '이름 안의 연속 점'],
    ['foo/..hidden', '점 두 개로 시작하는 이름'],
    ['file..', '점으로 끝나는 이름'],
    ['...', '점 세 개'],
  ])('%s 는 탈출이 아니므로 그대로 보낸다(%s)', (p) => {
    expect(toWireArtifacts([p], root)).toEqual([p])
  })

  it.each([
    ['../escape.ts', '앞선 상위 이동'],
    ['a/../../etc/passwd', '중간 상위 이동'],
    ['a/..', '끝의 상위 이동'],
  ])('%s 는 진짜 탈출이므로 버린다(%s)', (p) => {
    expect(toWireArtifacts([p], root)).toEqual([])
  })

  it('정상 경로는 그대로 통과한다(과잉 차단이 아니다)', () => {
    expect(toWireArtifacts(['src/ok.ts', 'a.b.ts', 'x.min.js'], root)).toEqual(['src/ok.ts', 'a.b.ts', 'x.min.js'])
  })

  it('탈출 한 건이 섞여도 나머지는 살아 나간다', () => {
    expect(toWireArtifacts(['../escape.ts', 'src/ok.ts'], root)).toEqual(['src/ok.ts'])
  })

  /** 두 분기(root 유/무)가 **같은 관문**을 지나는지 — 규칙이 갈리면 한쪽만 새어 나간다. */
  it('workspaceRoot 유무와 무관하게 같은 술어를 만족한다', () => {
    const inputs = ['patches/v1..v2.diff', 'src/ok.ts', '../escape.ts', 'a..b.ts']
    for (const out of [toWireArtifacts(inputs, root), toWireArtifacts(inputs, undefined)]) {
      for (const p of out) {
        expect(isAbsolute(p)).toBe(false)
        expect(hasTraversalSegment(p)).toBe(false)
      }
      // 정상 파일명이 살아 나오는 것까지 확인한다 — "전부 드롭"도 술어는 만족한다.
      expect(out).toContain('patches/v1..v2.diff')
    }
  })
})
