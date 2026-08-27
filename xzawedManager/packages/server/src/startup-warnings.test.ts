import { describe, test, expect } from 'vitest'
import { startupWarnings, type StartupWiring } from './startup-warnings.js'

/**
 * 전부 off·pool 없음이 기준선이다. **여기서 나오는 경고는 0이어야 한다** — 아무것도 켜지 않았는데
 * 경고가 나면 그 판정은 "전제 누락"이 아니라 다른 것을 말하고 있는 것이다.
 */
function base(over: Partial<StartupWiring> = {}): StartupWiring {
  return {
    taskManager: false, taskWorker: false, decompose: false,
    degradedMode: false, degradedEnforce: false, degradedSignoff: false,
    deployGate: false, releaseGate: false, releaseSignoff: false,
    oracleDraft: false, oracleInvariants: false, oracleDecision: false, goldenSignoff: false,
    wpVerify: false, wpConformance: false, wpImpact: false, wpProperty: false,
    wpMutation: false, wpSecurity: false, wpAdvisory: false,
    decisionBrief: false, decisionRouting: false, decisionExpiry: false,
    riskClassify: false, riskRouting: false, riskDecision: false, modelRouting: false,
    hasPool: false, hasOracleStore: false, hasBudget: false, hasProviderCircuit: false,
    mutationMinRisk: 'HIGH', mutationTheta: 0.6,
    thetaLow: undefined, thetaMedium: undefined, thetaHigh: undefined,
    ...over,
  }
}

/** 완전 배선 — 자율 스택을 전부 켜고 전제도 다 준 상태. 여기서도 경고가 0이어야 한다. */
function fullyWired(over: Partial<StartupWiring> = {}): StartupWiring {
  return base({
    taskManager: true, taskWorker: true, decompose: true,
    degradedMode: true, degradedEnforce: true, degradedSignoff: true,
    deployGate: true, releaseGate: true, releaseSignoff: true,
    oracleDraft: true, oracleInvariants: true, oracleDecision: true, goldenSignoff: true,
    wpVerify: true, wpConformance: true, wpImpact: true, wpProperty: true,
    wpMutation: true, wpSecurity: true, wpAdvisory: true,
    decisionBrief: true, decisionRouting: true, decisionExpiry: true,
    riskClassify: true, riskRouting: true, riskDecision: true, modelRouting: true,
    hasPool: true, hasOracleStore: true, hasBudget: true, hasProviderCircuit: true,
    ...over,
  })
}

const has = (w: StartupWiring, needle: string): boolean => startupWarnings(w).some((m) => m.includes(needle))

describe('startupWarnings — 기준선', () => {
  test('전부 off 면 경고 0 — 켠 것이 없으면 말할 것도 없다', () => {
    expect(startupWarnings(base())).toEqual([])
  })

  test('전부 on + 전제 충족이면 경고 0 — 완전 배선을 잔소리하지 않는다', () => {
    expect(startupWarnings(fullyWired())).toEqual([])
  })

  test('반환은 항상 문자열 배열이고 빈 문자열을 담지 않는다', () => {
    const msgs = startupWarnings(fullyWired({ taskManager: false }))
    expect(msgs.length).toBeGreaterThan(0)
    for (const m of msgs) expect(m.trim().length).toBeGreaterThan(0)
  })
})

describe('startupWarnings — 강등 체인', () => {
  test('DEGRADED_MODE 는 신호원(budget|provider)이 하나라도 있으면 조용하다', () => {
    expect(has(base({ degradedMode: true }), '강등 신호원이 없습니다')).toBe(true)
    expect(has(base({ degradedMode: true, hasBudget: true }), '강등 신호원이 없습니다')).toBe(false)
    expect(has(base({ degradedMode: true, hasProviderCircuit: true }), '강등 신호원이 없습니다')).toBe(false)
  })

  test('DEGRADED_ENFORCE 는 MODE 와 TASK_MANAGER 둘을 각각 요구한다', () => {
    expect(has(base({ degradedEnforce: true }), '모드 추적 없이는 enforcement가 무력')).toBe(true)
    expect(has(base({ degradedEnforce: true, degradedMode: true, hasBudget: true }), '모드 추적 없이는')).toBe(false)
    expect(has(base({ degradedEnforce: true }), '디스패치 보류/재개가 무력')).toBe(true)
    expect(has(base({ degradedEnforce: true, taskManager: true }), '디스패치 보류/재개가 무력')).toBe(false)
  })

  test('DEGRADED_SIGNOFF 는 세 전제 중 하나만 빠져도 경고한다', () => {
    const ok = { degradedSignoff: true, hasPool: true, degradedEnforce: true, decisionRouting: true }
    expect(has(base(ok), 'DEGRADED HIGH-risk 사인오프 비활성')).toBe(false)
    expect(has(base({ ...ok, hasPool: false }), 'DEGRADED HIGH-risk 사인오프 비활성')).toBe(true)
    expect(has(base({ ...ok, degradedEnforce: false }), 'DEGRADED HIGH-risk 사인오프 비활성')).toBe(true)
    expect(has(base({ ...ok, decisionRouting: false }), 'DEGRADED HIGH-risk 사인오프 비활성')).toBe(true)
  })
})

describe('startupWarnings — 워커·검증 게이트', () => {
  test('TASK_WORKER 는 supervisor 전제(TASK_MANAGER+pool)를 요구한다', () => {
    expect(has(base({ taskWorker: true }), '실행 워커가 배선되지 않습니다')).toBe(true)
    expect(has(base({ taskWorker: true, taskManager: true }), '실행 워커가 배선되지 않습니다')).toBe(true)
    expect(has(base({ taskWorker: true, taskManager: true, hasPool: true }), '실행 워커가 배선되지 않습니다')).toBe(false)
  })

  test('역방향 — Supervisor 만 켜면 WP 가 무음 정지한다는 경고가 나온다', () => {
    expect(has(base({ taskManager: true, hasPool: true }), 'WP가 무음 정지합니다')).toBe(true)
    expect(has(base({ taskManager: true, hasPool: true, taskWorker: true }), 'WP가 무음 정지합니다')).toBe(false)
    // pool 이 없으면 Supervisor 자체가 안 뜨므로 이 경고는 부적절하다.
    expect(has(base({ taskManager: true }), 'WP가 무음 정지합니다')).toBe(false)
  })

  test('WP_VERIFY 는 TASK_WORKER 를 요구한다', () => {
    expect(has(base({ wpVerify: true }), '검증 게이트가 동작하지 않습니다')).toBe(true)
    expect(has(base({ wpVerify: true, taskWorker: true }), '검증 게이트가 동작하지 않습니다')).toBe(false)
  })

  test('WP_SECURITY 는 WP_VERIFY 를 요구한다', () => {
    expect(has(base({ wpSecurity: true }), 'security 채널이 동작하지 않습니다')).toBe(true)
    expect(has(base({ wpSecurity: true, wpVerify: true }), 'security 채널이 동작하지 않습니다')).toBe(false)
  })
})

/**
 * **회귀 봉인 — 경고와 코드가 어긋나면 여기서 깨진다.**
 *
 * 이 경고는 두 번 뒤집혔다. 원래 "`MANAGER_WP_VERIFY` 가 꺼져 있어 advisory 가 동작하지 않는다"고
 * 말했는데 **코드는 반대였다**(검증이 꺼져도 생산됐다) — #645 에서 경고를 코드에 맞췄다.
 * 그 뒤 사람 결정으로 **코드를 의도에 맞췄다**(2026-08-28: 정상 동작·안정성이 먼저, 최적화는 그다음).
 * 그래서 지금은 다시 전제이고, 이번에는 **참이다** — `worker.advisory.test.ts` 가 워커 쪽을 봉인한다.
 *
 * 방향이 바뀌어도 이 봉인의 역할은 같다: **문구가 코드보다 많이/적게 주장하면 깨진다.**
 */
describe('startupWarnings — advisory 는 통과한 verdict 를 전제한다 (회귀 봉인)', () => {
  const fullyOn = { wpAdvisory: true, taskManager: true, taskWorker: true, hasPool: true, wpVerify: true }

  test('전제가 다 있으면 advisory 경고가 없다', () => {
    expect(has(base(fullyOn), 'advisory')).toBe(false)
  })

  test('WP_VERIFY 가 꺼져 있으면 경고한다 — 판정 없는 산출물에는 제안하지 않는다', () => {
    expect(has(base({ ...fullyOn, wpVerify: false }), 'MANAGER_WP_VERIFY가 꺼져 있어 advisory가 생산되지 않습니다')).toBe(true)
  })

  /** 워커 전제는 **별개 축**이다 — 검증을 켜도 WP 가 실행되지 않으면 도달하지 못한다. */
  test('실행 워커 전제 셋 중 하나만 빠져도 따로 경고한다', () => {
    for (const k of ['taskManager', 'taskWorker', 'hasPool'] as const) {
      expect(has(base({ ...fullyOn, [k]: false }), '실행 워커 전제')).toBe(true)
    }
    expect(has(base(fullyOn), '실행 워커 전제')).toBe(false)
  })

  test('pool 부재는 영속 불가로 또 따로 알린다(생산 여부와 다른 축)', () => {
    expect(has(base({ ...fullyOn, hasPool: false }), 'advisory가 영속되지 않습니다')).toBe(true)
    expect(has(base(fullyOn), 'advisory가 영속되지 않습니다')).toBe(false)
  })
})

describe('startupWarnings — 오라클 채널 3종', () => {
  const channels = [
    { flag: 'wpConformance', env: 'MANAGER_WP_CONFORMANCE', label: 'conformance' },
    { flag: 'wpImpact', env: 'MANAGER_WP_IMPACT', label: 'impact' },
    { flag: 'wpProperty', env: 'MANAGER_WP_PROPERTY', label: 'property' },
  ] as const

  for (const c of channels) {
    test(`${c.label} — WP_VERIFY 와 oracleStore 를 각각 요구한다`, () => {
      const on = base({ [c.flag]: true } as Partial<StartupWiring>)
      expect(has(on, `${c.label} 채널이 동작하지 않습니다`)).toBe(true)
      expect(has(on, `${c.label}가 항상 skip됩니다`)).toBe(true)

      const withVerify = base({ [c.flag]: true, wpVerify: true, taskWorker: true } as Partial<StartupWiring>)
      expect(has(withVerify, `${c.label} 채널이 동작하지 않습니다`)).toBe(false)
      expect(has(withVerify, `${c.label}가 항상 skip됩니다`)).toBe(true)

      const full = base({ [c.flag]: true, wpVerify: true, taskWorker: true, hasOracleStore: true } as Partial<StartupWiring>)
      expect(has(full, `${c.label}가 항상 skip됩니다`)).toBe(false)
    })

    test(`${c.label} — 메시지가 자기 env 이름을 담는다(다른 채널과 안 섞인다)`, () => {
      const msgs = startupWarnings(base({ [c.flag]: true } as Partial<StartupWiring>))
        .filter((m) => m.includes(c.label))
      expect(msgs.length).toBe(2)
      for (const m of msgs) expect(m).toContain(c.env)
    })
  }
})

describe('startupWarnings — mutation 발화 전제(G7)', () => {
  test('WP_MUTATION 은 WP_VERIFY 를 요구한다', () => {
    expect(has(base({ wpMutation: true }), 'mutation 채널이 동작하지 않습니다')).toBe(true)
    expect(has(base({ wpMutation: true, wpVerify: true, taskWorker: true }), 'mutation 채널이 동작하지 않습니다')).toBe(false)
  })

  test('min-risk=HIGH + risk 체인 불완전이면 항상 skip 을 알린다', () => {
    const on = { wpMutation: true, wpVerify: true, taskWorker: true, mutationMinRisk: 'HIGH' as const }
    expect(has(base(on), 'mutation이 항상 skip됩니다')).toBe(true)
    expect(has(base({ ...on, riskClassify: true }), 'mutation이 항상 skip됩니다')).toBe(true)
    expect(has(base({ ...on, riskClassify: true, riskRouting: true }), 'mutation이 항상 skip됩니다')).toBe(false)
  })

  test('min-risk 를 MEDIUM 으로 낮추면 G7 은 침묵한다 — 그때는 실제로 돈다', () => {
    const on = { wpMutation: true, wpVerify: true, taskWorker: true, mutationMinRisk: 'MEDIUM' as const }
    expect(has(base(on), 'mutation이 항상 skip됩니다')).toBe(false)
  })
})

describe('startupWarnings — mutation θ 캘리브레이션(S5.4)', () => {
  const on = { wpMutation: true, wpVerify: true, taskWorker: true, riskClassify: true, riskRouting: true }

  test('min-risk 가 거르는 등급의 θ 는 닿지 않는다고 알린다', () => {
    const w = base({ ...on, mutationMinRisk: 'HIGH', thetaLow: 0.5 })
    expect(has(w, '적용되지 않습니다')).toBe(true)
    expect(has(w, 'MANAGER_MUTATION_THETA_LOW')).toBe(true)
  })

  test('min-risk 를 낮추면 그 θ 는 닿는다 — 경고가 사라진다', () => {
    expect(has(base({ ...on, mutationMinRisk: 'LOW', thetaLow: 0.5 }), 'mutation 대상에서 제외해')).toBe(false)
  })

  test('risk 체인이 꺼져 있으면 LOW·HIGH θ 는 영원히 안 닿는다(G7 이 침묵하는 구멍)', () => {
    const w = base({ wpMutation: true, wpVerify: true, taskWorker: true, mutationMinRisk: 'MEDIUM', thetaHigh: 0.9 })
    expect(has(w, 'risk 가 기본 MEDIUM 에 머뭅니다')).toBe(true)
    const fixed = base({ ...on, mutationMinRisk: 'MEDIUM', thetaHigh: 0.9 })
    expect(has(fixed, 'risk 가 기본 MEDIUM 에 머뭅니다')).toBe(false)
  })

  test('θ 가 등급 순서를 거스르면 알린다(거부하지는 않는다)', () => {
    const w = base({ ...on, mutationMinRisk: 'LOW', thetaLow: 0.9, thetaMedium: 0.5, thetaHigh: 0.4 })
    expect(has(w, '등급 순서를 거스릅니다')).toBe(true)
    const mono = base({ ...on, mutationMinRisk: 'LOW', thetaLow: 0.4, thetaMedium: 0.5, thetaHigh: 0.9 })
    expect(has(mono, '등급 순서를 거스릅니다')).toBe(false)
  })

  test('mutation 이 꺼져 있으면 θ 경고를 내지 않는다 — 켜지도 않은 것을 잔소리하지 않는다', () => {
    expect(has(base({ thetaLow: 0.9, thetaHigh: 0.1 }), 'θ')).toBe(false)
  })
})

describe('startupWarnings — 오라클 체인', () => {
  test('ORACLE_DRAFT 는 TASK_MANAGER+pool 을 요구한다', () => {
    expect(has(base({ oracleDraft: true }), '초안 오라클이 영속되지 않습니다')).toBe(true)
    expect(has(base({ oracleDraft: true, taskManager: true }), '초안 오라클이 영속되지 않습니다')).toBe(true)
    expect(has(base({ oracleDraft: true, taskManager: true, hasPool: true }), '초안 오라클이 영속되지 않습니다')).toBe(false)
  })

  test('ORACLE_INVARIANTS 는 DRAFT(생성)와 WP_PROPERTY(소비)를 각각 요구한다', () => {
    expect(has(base({ oracleInvariants: true }), 'invariant 초안이 생성되지 않습니다')).toBe(true)
    expect(has(base({ oracleInvariants: true }), 'property 채널이 소비하지 않습니다')).toBe(true)
    const both = base({ oracleInvariants: true, oracleDraft: true, taskManager: true, hasPool: true, wpProperty: true, wpVerify: true, taskWorker: true, hasOracleStore: true })
    expect(has(both, 'invariant 초안이 생성되지 않습니다')).toBe(false)
    expect(has(both, 'property 채널이 소비하지 않습니다')).toBe(false)
  })

  test('ORACLE_DECISION 은 세 전제 중 하나만 빠져도 경고한다', () => {
    const ok = { oracleDecision: true, hasPool: true, oracleDraft: true, decisionRouting: true }
    expect(has(base(ok), 'C3 오라클 승인 흐름 부분 비활성')).toBe(false)
    for (const k of ['hasPool', 'oracleDraft', 'decisionRouting'] as const) {
      expect(has(base({ ...ok, [k]: false }), 'C3 오라클 승인 흐름 부분 비활성')).toBe(true)
    }
  })

  test('GOLDEN_SIGNOFF 는 네 전제 중 하나만 빠져도 경고한다', () => {
    const ok = { goldenSignoff: true, hasPool: true, wpImpact: true, decisionRouting: true, taskWorker: true }
    expect(has(base(ok), 'golden freeze 사인오프 흐름 부분 비활성')).toBe(false)
    for (const k of ['hasPool', 'wpImpact', 'decisionRouting', 'taskWorker'] as const) {
      expect(has(base({ ...ok, [k]: false }), 'golden freeze 사인오프 흐름 부분 비활성')).toBe(true)
    }
  })

  /**
   * 추출하면서 여기 `taskWorker` 를 `taskManager` 로 바꿔 쓴 적이 있다(Grok 반증이 잡았다).
   * 두 플래그는 독립이라 워커만 꺼진 구성에서 경고가 통째로 사라졌다.
   * **메시지가 이름을 대는 플래그와 실제로 검사하는 플래그가 같아야 한다.**
   */
  test('GOLDEN_SIGNOFF 가 검사하는 것은 MANAGER_TASK_WORKER 다 — TASK_MANAGER_ENABLED 가 아니다', () => {
    const ok = { goldenSignoff: true, hasPool: true, wpImpact: true, decisionRouting: true, taskWorker: true }
    // 워커만 꺼지면 경고해야 한다(Supervisor 는 켜져 있어도).
    expect(has(base({ ...ok, taskWorker: false, taskManager: true }), 'golden freeze 사인오프 흐름 부분 비활성')).toBe(true)
    // 반대로 Supervisor 만 꺼진 것은 이 경고의 조건이 아니다 — workerWarnings 가 따로 알린다.
    expect(has(base({ ...ok, taskManager: false }), 'golden freeze 사인오프 흐름 부분 비활성')).toBe(false)
  })
})

describe('startupWarnings — 결정·리스크 라우팅', () => {
  test('DECISION_ROUTING 은 BRIEF 를 요구한다', () => {
    expect(has(base({ decisionRouting: true }), '라우팅할 결정 브리프가 생성되지 않습니다')).toBe(true)
    expect(has(base({ decisionRouting: true, decisionBrief: true }), '라우팅할 결정 브리프가 생성되지 않습니다')).toBe(false)
  })

  test('DECISION_EXPIRY — pool 없음과 Supervisor 없음은 다른 경고다', () => {
    expect(has(base({ decisionExpiry: true }), '결정 만료 sweep이 비활성입니다')).toBe(true)
    const withPool = base({ decisionExpiry: true, hasPool: true })
    expect(has(withPool, '결정 만료 sweep이 비활성입니다')).toBe(false)
    expect(has(withPool, 'Supervisor가 미배선')).toBe(true)
    expect(has(base({ decisionExpiry: true, hasPool: true, taskManager: true }), 'Supervisor가 미배선')).toBe(false)
  })

  test('RISK_CLASSIFY — pool 부재와 decompose 부재는 서로 배타적으로 나온다', () => {
    const noPool = startupWarnings(base({ riskClassify: true })).filter((m) => m.startsWith('[risk] MANAGER_RISK_CLASSIFY'))
    expect(noPool.length).toBe(1)
    expect(noPool[0]).toContain('DATABASE_URL 없음')

    const noDecompose = startupWarnings(base({ riskClassify: true, hasPool: true }))
      .filter((m) => m.startsWith('[risk] MANAGER_RISK_CLASSIFY'))
    expect(noDecompose.length).toBe(1)
    expect(noDecompose[0]).toContain('분류 미발생')

    expect(has(base({ riskClassify: true, hasPool: true, decompose: true, decisionRouting: true }), '[risk] MANAGER_RISK_CLASSIFY')).toBe(false)
  })

  test('RISK_ROUTING — pool 부재와 Supervisor 부재도 배타적이다', () => {
    const noPool = startupWarnings(base({ riskRouting: true })).filter((m) => m.startsWith('[risk] MANAGER_RISK_ROUTING'))
    expect(noPool.length).toBe(1)
    expect(noPool[0]).toContain('승인/write-back 불가')

    const noSup = startupWarnings(base({ riskRouting: true, hasPool: true }))
      .filter((m) => m.startsWith('[risk] MANAGER_RISK_ROUTING'))
    expect(noSup.length).toBe(1)
    expect(noSup[0]).toContain('risk.approved 소비자 미가동')
  })

  test('RISK_DECISION 은 세 전제 중 하나만 빠져도 경고한다', () => {
    const ok = { riskDecision: true, hasPool: true, riskClassify: true, decisionRouting: true }
    expect(has(base(ok), 'C5 승인 흐름 부분 비활성')).toBe(false)
    for (const k of ['hasPool', 'riskClassify', 'decisionRouting'] as const) {
      expect(has(base({ ...ok, [k]: false }), 'C5 승인 흐름 부분 비활성')).toBe(true)
    }
  })
})

describe('startupWarnings — 배포·분해·모델 라우팅', () => {
  test('DEPLOY_GATE 는 RELEASE_GATE 와 pool 을 각각 요구한다', () => {
    expect(has(base({ deployGate: true }), 'deploy 검사가 항상 허용됩니다')).toBe(true)
    expect(has(base({ deployGate: true }), 'deploy 검사가 비활성입니다')).toBe(true)
    const ok = base({ deployGate: true, releaseGate: true, hasPool: true, taskManager: true, taskWorker: true, wpVerify: true })
    expect(has(ok, 'deploy 검사가 항상 허용됩니다')).toBe(false)
    expect(has(ok, 'deploy 검사가 비활성입니다')).toBe(false)
  })

  test('DECOMPOSE 는 pool(아웃박스)과 DECISION_ROUTING(UI 노출)을 각각 요구한다', () => {
    expect(has(base({ decompose: true }), '트랜잭셔널 아웃박스를 경유하지 않습니다')).toBe(true)
    expect(has(base({ decompose: true, hasPool: true }), '트랜잭셔널 아웃박스를 경유하지 않습니다')).toBe(false)
    expect(has(base({ decompose: true }), 'C1 UI에 surface되지 않음')).toBe(true)
    expect(has(base({ decompose: true, decisionRouting: true, decisionBrief: true }), 'C1 UI에 surface되지 않음')).toBe(false)
  })

  test('MODEL_ROUTING 은 TASK_WORKER 와 pool 을 요구한다', () => {
    expect(has(base({ modelRouting: true }), '모델 라우팅 비활성')).toBe(true)
    expect(has(base({ modelRouting: true, hasPool: true }), '모델 라우팅 비활성')).toBe(true)
    expect(has(base({ modelRouting: true, hasPool: true, taskWorker: true, taskManager: true }), '모델 라우팅 비활성')).toBe(false)
  })
})

describe('startupWarnings — 릴리스 게이트 위임', () => {
  test('releaseGateWarnings 결과가 합쳐져 나온다', () => {
    const msgs = startupWarnings(base({ releaseGate: true }))
    expect(msgs.some((m) => m.includes('MANAGER_RELEASE_GATE'))).toBe(true)
  })

  test('RELEASE_SIGNOFF 는 게이트와 라우팅 둘을 요구한다', () => {
    const ok = { releaseSignoff: true, releaseGate: true, decisionRouting: true }
    expect(has(base(ok), '사인오프 미생성')).toBe(false)
    expect(has(base({ ...ok, releaseGate: false }), '사인오프 미생성')).toBe(true)
    expect(has(base({ ...ok, decisionRouting: false }), '사인오프 미생성')).toBe(true)
  })
})
