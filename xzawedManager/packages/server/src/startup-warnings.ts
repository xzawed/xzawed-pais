/**
 * 기동 시 "플래그를 켰는데 전제가 없어 아무 일도 안 일어난다"를 표면화하는 경고 판정.
 *
 * **왜 순수 함수인가.** 이 판정들은 원래 `buildServer` 안에 인라인 `if`로 흩어져 있었다.
 * `buildServer`는 DB·Redis·Anthropic 배선을 통째로 끌고 와 테스트가 부르지 못하고, 실측하면
 * `server.ts`는 **라인 236 중 1 · 분기 396 중 0**만 덮인다. 그래서 이 경고들은 **한 번도 검증된
 * 적이 없었고**, 그 상태에서 실제로 틀린 것이 나왔다 — advisory 경고가 "동작하지 않습니다"라고
 * 말했지만 코드는 그 반대였다(아래 `advisory` 항목).
 *
 * 저장소는 이미 같은 처방을 세 번 썼다 — `makeServerOptions` · `releaseGateWarnings` ·
 * `shouldWireSupervisor`/`shouldWireDecisionRoute`. 이 파일은 나머지를 같은 자리로 옮긴다.
 *
 * **규칙: 메시지 문자열을 여기 말고 다른 곳에 쓰지 않는다.** `server.ts`는 반환 배열을 돌며
 * `app.log.warn`만 한다. 조건이 바뀌면 `startup-warnings.test.ts`가 먼저 깨진다.
 */
import { releaseGateWarnings } from './streams/server-release-gate.js'
import { meetsMinRisk, nonMonotonicThetaTiers, resolveThetaByRisk } from './streams/verify.js'

type Risk = 'LOW' | 'MEDIUM' | 'HIGH'

/**
 * 경고 판정에 필요한 것 전부. **플래그만이 아니라 파생 상태도 받는다** — `hasPool`·`hasOracleStore`
 * 처럼 런타임에만 알 수 있는 값이 전제인 경고가 많고, 그것을 flag 로 재계산하면 배선과 어긋난다
 * (그 어긋남이 정확히 이 파일이 막으려는 결함이다).
 */
export interface StartupWiring {
  taskManager: boolean
  taskWorker: boolean
  decompose: boolean
  degradedMode: boolean
  degradedEnforce: boolean
  degradedSignoff: boolean
  deployGate: boolean
  releaseGate: boolean
  releaseSignoff: boolean
  oracleDraft: boolean
  oracleInvariants: boolean
  oracleDecision: boolean
  goldenSignoff: boolean
  wpVerify: boolean
  wpConformance: boolean
  wpImpact: boolean
  wpProperty: boolean
  wpMutation: boolean
  wpSecurity: boolean
  wpAdvisory: boolean
  decisionBrief: boolean
  decisionRouting: boolean
  decisionExpiry: boolean
  riskClassify: boolean
  riskRouting: boolean
  riskDecision: boolean
  modelRouting: boolean
  /** 파생: `DATABASE_URL` 로 pg 풀이 만들어졌는가. */
  hasPool: boolean
  /** 파생: OracleRepo 가 실제로 생성됐는가(`server.ts` 의 OR 목록 + pool). */
  hasOracleStore: boolean
  /** 파생: 강등 신호원. 둘 다 없으면 DEGRADED_MODE 는 관측할 것이 없다. */
  hasBudget: boolean
  hasProviderCircuit: boolean
  mutationMinRisk: Risk
  mutationTheta: number
  thetaLow: number | undefined
  thetaMedium: number | undefined
  thetaHigh: number | undefined
}

/** mutation 발화 전제(θ 캘리브레이션과 구분 — 이쪽은 "돌기는 하는가"다). */
function mutationWarnings(w: StartupWiring): string[] {
  if (!w.wpMutation) return []
  const out: string[] = []
  if (!w.wpVerify) {
    out.push('MANAGER_WP_MUTATION=true 이지만 MANAGER_WP_VERIFY가 꺼져 있어 mutation 채널이 동작하지 않습니다(verifyWp 미경유).')
  }
  // G7: wp.risk 는 risk 분류→승인→라우팅 체인이 HIGH 로 write-back 해야 올라간다. min-risk=HIGH 인데
  // 그 체인이 불완전하면 wp.risk 는 기본 MEDIUM 에 머물러 mutation 이 **항상 skip** 된다.
  if (w.wpVerify && w.mutationMinRisk === 'HIGH' && (!w.riskClassify || !w.riskRouting)) {
    out.push(
      'MANAGER_WP_MUTATION=true·MANAGER_MUTATION_MIN_RISK=HIGH 인데 risk write-back 체인(MANAGER_RISK_CLASSIFY+MANAGER_RISK_ROUTING)이 불완전해 wp.risk가 기본 MEDIUM에 머물러 mutation이 항상 skip됩니다(무음 no-op). risk 체인을 켜 HIGH 승인·write-back하거나, MANAGER_MUTATION_MIN_RISK를 MEDIUM/LOW로 낮추세요.',
    )
  }
  return out
}

/** mutation θ 등급별 경고 — 조건이 셋 다 다르고 서로를 가리므로 한 함수에 모은다. */
function mutationThetaWarnings(w: StartupWiring): string[] {
  if (!(w.wpMutation && w.wpVerify)) return []
  const out: string[] = []
  const set: Record<'LOW' | 'MEDIUM' | 'HIGH', number | undefined> = {
    LOW: w.thetaLow, MEDIUM: w.thetaMedium, HIGH: w.thetaHigh,
  }
  // S5.4: per-tier θ 를 설정했는데 min-risk 가 그 등급을 애초에 걸러 내면 그 값은 닿지 않는다.
  const unreachable = (['LOW', 'MEDIUM'] as const).filter(
    (t) => set[t] !== undefined && !meetsMinRisk(t, w.mutationMinRisk),
  )
  if (unreachable.length > 0) {
    out.push(
      `MANAGER_MUTATION_THETA_${unreachable.join('·')} 를 설정했지만 MANAGER_MUTATION_MIN_RISK=${w.mutationMinRisk} 가 그 등급을 mutation 대상에서 제외해 이 θ 는 적용되지 않습니다. min-risk 를 낮추거나 해당 θ 설정을 제거하세요.`,
    )
  }
  // G7 경고는 min-risk=HIGH 만 본다. 리스크 체인이 꺼져 있으면 min-risk 와 무관하게 전 WP 가
  // 분해 기본값 MEDIUM 에 머물러 LOW·HIGH 티어 θ 가 영원히 닿지 않는다 — G7 이 침묵하는 구멍.
  const deadTiers = (['LOW', 'HIGH'] as const).filter((t) => set[t] !== undefined)
  if ((!w.riskClassify || !w.riskRouting) && deadTiers.length > 0) {
    out.push(
      `MANAGER_MUTATION_THETA_${deadTiers.join('·')} 를 설정했지만 risk 분류·라우팅 체인(MANAGER_RISK_CLASSIFY+MANAGER_RISK_ROUTING)이 불완전해 모든 WP 의 risk 가 기본 MEDIUM 에 머뭅니다 — 이 θ 는 적용되지 않습니다. risk 체인을 켜세요.`,
    )
  }
  // 저위험 WP 에 고위험보다 엄격한 바닥을 요구하는 것은 거의 항상 오타다. 보안 불변식이 아니라
  // 캘리브레이션 취향이라 거부하지 않고 알리기만 한다.
  const tiers = resolveThetaByRisk(w.mutationTheta, { LOW: w.thetaLow, MEDIUM: w.thetaMedium, HIGH: w.thetaHigh })
  if (nonMonotonicThetaTiers(tiers)) {
    out.push(
      `mutation θ 가 등급 순서를 거스릅니다(LOW=${tiers.LOW}·MEDIUM=${tiers.MEDIUM}·HIGH=${tiers.HIGH}). 저위험 WP 에 고위험보다 엄격한 바닥을 요구하고 있는지 확인하세요.`,
    )
  }
  return out
}

/**
 * 검증 채널 4종(conformance·impact·property)의 경고는 문장 구조가 같고 주어만 다르다.
 * 서비스명만 다른 사본을 만들면 Sonar CPD 가 잡으므로(문자열 리터럴을 정규화해 비교한다) 합친다.
 */
function oracleChannelWarnings(
  enabled: boolean, envName: string, label: string, w: StartupWiring,
): string[] {
  if (!enabled) return []
  const out: string[] = []
  if (!w.wpVerify) {
    out.push(`${envName}=true 이지만 MANAGER_WP_VERIFY가 꺼져 있어 ${label} 채널이 동작하지 않습니다(verifyWp 미경유).`)
  }
  if (!w.hasOracleStore) {
    out.push(`${envName}=true 이지만 oracleStore(DATABASE_URL+OracleRepo)가 없어 ${label}가 항상 skip됩니다.`)
  }
  return out
}

/** 강등 체인. */
function degradedWarnings(w: StartupWiring): string[] {
  const out: string[] = []
  if (w.degradedMode && !w.hasBudget && !w.hasProviderCircuit) {
    out.push('MANAGER_DEGRADED_MODE=true 이지만 budget/provider 서킷이 둘 다 미구성 — 강등 신호원이 없습니다.')
  }
  if (w.degradedEnforce && !w.degradedMode) {
    out.push('MANAGER_DEGRADED_ENFORCE=true 이지만 MANAGER_DEGRADED_MODE=false — 모드 추적 없이는 enforcement가 무력합니다.')
  }
  if (w.degradedEnforce && !w.taskManager) {
    out.push('MANAGER_DEGRADED_ENFORCE=true 이지만 TASK_MANAGER_ENABLED=false — Supervisor가 없어 디스패치 보류/재개가 무력합니다.')
  }
  if (w.degradedSignoff && (!w.hasPool || !w.degradedEnforce || !w.decisionRouting)) {
    out.push('MANAGER_DEGRADED_SIGNOFF는 MANAGER_DEGRADED_ENFORCE(getMode)+MANAGER_DECISION_ROUTING+DATABASE_URL 전제 — 미충족 시 DEGRADED HIGH-risk 사인오프 비활성')
  }
  return out
}

/** 오라클 초안·불변식·승인 체인. */
function oracleChainWarnings(w: StartupWiring): string[] {
  const out: string[] = []
  if (w.oracleDraft && !(w.taskManager && w.hasPool)) {
    out.push('MANAGER_ORACLE_DRAFT=true 이지만 TASK_MANAGER_ENABLED+DATABASE_URL 전제가 없어 초안 오라클이 영속되지 않습니다(소비자 부재).')
  }
  if (w.oracleInvariants && !w.oracleDraft) {
    out.push('[oracle] MANAGER_ORACLE_INVARIANTS=true이나 MANAGER_ORACLE_DRAFT off — 초안 파이프라인 부재로 invariant 초안이 생성되지 않습니다(no-op).')
  }
  if (w.oracleInvariants && !w.wpProperty) {
    out.push('[oracle] MANAGER_ORACLE_INVARIANTS=true이나 MANAGER_WP_PROPERTY off — invariant가 생성·승인되나 property 채널이 소비하지 않습니다(휴면).')
  }
  if (w.oracleDecision && (!w.hasPool || !w.oracleDraft || !w.decisionRouting)) {
    out.push('[oracle] MANAGER_ORACLE_DECISION=true이나 전제(MANAGER_ORACLE_DRAFT+MANAGER_DECISION_ROUTING+DATABASE_URL) 미충족 — C3 오라클 승인 흐름 부분 비활성')
  }
  // 전제는 `MANAGER_TASK_WORKER` 다 — 메시지가 그렇게 적고 있고 원본 조건도 그것이었다.
  // `TASK_MANAGER_ENABLED` 로 바꿔 쓰면 워커만 꺼진 구성에서 조용해진다(추출하면서 한 번 그랬고
  // Grok 반증이 잡았다). 워커 자체가 안 뜨는 구성은 위 workerWarnings 가 따로 알린다.
  if (w.goldenSignoff && (!w.hasPool || !w.wpImpact || !w.decisionRouting || !w.taskWorker)) {
    out.push('[golden] MANAGER_GOLDEN_SIGNOFF=true이나 전제(MANAGER_WP_IMPACT+MANAGER_DECISION_ROUTING+MANAGER_TASK_WORKER+DATABASE_URL) 미충족 — golden freeze 사인오프 흐름 부분 비활성')
  }
  return out
}

/** 결정·리스크 라우팅 체인. */
function decisionWarnings(w: StartupWiring): string[] {
  const out: string[] = []
  if (w.decisionRouting && !w.decisionBrief) {
    out.push('MANAGER_DECISION_ROUTING=true 이지만 MANAGER_DECISION_BRIEF가 꺼져 있어 라우팅할 결정 브리프가 생성되지 않습니다.')
  }
  if (w.releaseSignoff && (!w.releaseGate || !w.decisionRouting)) {
    out.push('MANAGER_RELEASE_SIGNOFF는 MANAGER_RELEASE_GATE+MANAGER_DECISION_ROUTING 전제 — gate.blocked 미발행/미소비 시 사인오프 미생성')
  }
  if (w.decisionExpiry && !w.hasPool) {
    out.push('MANAGER_DECISION_EXPIRY=true 이지만 DATABASE_URL이 없어 결정 만료 sweep이 비활성입니다.')
  }
  if (w.decisionExpiry && w.hasPool && !w.taskManager) {
    out.push('MANAGER_DECISION_EXPIRY=true 이지만 TASK_MANAGER_ENABLED가 꺼져 있어 Supervisor가 미배선 — 결정 만료 sweep·expiresAt 주입이 비활성입니다.')
  }
  if (w.riskDecision && (!w.hasPool || !w.riskClassify || !w.decisionRouting)) {
    out.push('[risk] MANAGER_RISK_DECISION=true이나 전제(MANAGER_RISK_CLASSIFY+MANAGER_DECISION_ROUTING+DATABASE_URL) 미충족 — C5 승인 흐름 부분 비활성')
  }
  if (w.riskClassify && !w.hasPool) {
    out.push('[risk] MANAGER_RISK_CLASSIFY=true이나 DATABASE_URL 없음 — 분류 영속 불가(미배선)')
  }
  if (w.riskClassify && w.hasPool && !w.decompose) {
    out.push('[risk] MANAGER_RISK_CLASSIFY=true이나 MANAGER_DECOMPOSE_ENABLED off — decompose_request 핸들러 미도달로 분류 미발생(no-op)')
  }
  if (w.riskRouting && !w.hasPool) {
    out.push('[risk] MANAGER_RISK_ROUTING=true이나 DATABASE_URL 없음 — 승인/write-back 불가(미배선)')
  }
  if (w.riskRouting && w.hasPool && !w.taskManager) {
    out.push('[risk] MANAGER_RISK_ROUTING=true이나 TASK_MANAGER_ENABLED off — Supervisor 미배선으로 risk.approved 소비자 미가동(승인 라우트만 동작)')
  }
  return out
}

/** 실행 워커·검증 게이트·advisory. */
function workerWarnings(w: StartupWiring): string[] {
  const out: string[] = []
  if (w.taskWorker && !(w.taskManager && w.hasPool)) {
    out.push('MANAGER_TASK_WORKER=true 이지만 TASK_MANAGER_ENABLED+DATABASE_URL 전제가 없어 실행 워커가 배선되지 않습니다(WP 미실행).')
  }
  // 역: Supervisor 는 배선되나 실행 워커가 없으면 dispatch 된 WP 가 DISPATCHED 에서 무음 정지한다.
  if (w.taskManager && w.hasPool && !w.taskWorker) {
    out.push('TASK_MANAGER_ENABLED=true 이지만 MANAGER_TASK_WORKER=false — Supervisor가 WP를 DISPATCHED로 올리나 실행 워커가 없어 WP가 무음 정지합니다(lease 만료 시 escalation으로만 드러남).')
  }
  if (w.wpVerify && !w.taskWorker) {
    out.push('MANAGER_WP_VERIFY=true 이지만 MANAGER_TASK_WORKER가 꺼져 있어 검증 게이트가 동작하지 않습니다.')
  }
  if (w.wpSecurity && !w.wpVerify) {
    out.push('MANAGER_WP_SECURITY=true 이지만 MANAGER_WP_VERIFY가 꺼져 있어 security 채널이 동작하지 않습니다(verifyWp 미경유).')
  }
  // **advisory 는 통과한 verdict 를 전제한다(사람 결정, 2026-08-28).** 정상 동작과 안정성이 먼저다.
  //
  // 이 경고는 두 번 뒤집혔다. 원래 "MANAGER_WP_VERIFY 가 꺼져 있어 동작하지 않는다"고 말했는데
  // 코드는 반대였고(#645 에서 경고를 코드에 맞췄다), 이번에는 **코드를 의도에 맞췄다**.
  // 그래서 다시 전제다 — 다만 이제는 참이고, `worker.advisory.test.ts` 가 그것을 봉인한다.
  if (w.wpAdvisory && !w.wpVerify) {
    out.push('MANAGER_WP_ADVISORY=true 이지만 MANAGER_WP_VERIFY가 꺼져 있어 advisory가 생산되지 않습니다. advisory는 검증을 통과한 산출물에만 제안하므로 판정이 없으면 건너뜁니다.')
  }
  // 검증을 켜도 워커가 배선되지 않으면 WP 자체가 실행되지 않는다 — 별개의 전제다.
  if (w.wpAdvisory && !(w.taskManager && w.hasPool && w.taskWorker)) {
    out.push('MANAGER_WP_ADVISORY=true 이지만 실행 워커 전제(TASK_MANAGER_ENABLED+MANAGER_TASK_WORKER+DATABASE_URL)가 없어 advisory가 생산되지 않습니다.')
  }
  if (w.wpAdvisory && !w.hasPool) {
    out.push('MANAGER_WP_ADVISORY=true 이지만 DATABASE_URL이 없어 advisory가 영속되지 않습니다(AdvisoryRepo 부재).')
  }
  return out
}

/** 배포 게이트·분해·모델 라우팅. */
function miscWarnings(w: StartupWiring): string[] {
  const out: string[] = []
  if (w.deployGate && !w.releaseGate) {
    out.push('MANAGER_DEPLOY_GATE=true 이지만 MANAGER_RELEASE_GATE가 꺼져 있어 게이트가 기록되지 않아 deploy 검사가 항상 허용됩니다.')
  }
  if (w.deployGate && !w.hasPool) {
    out.push('MANAGER_DEPLOY_GATE=true 이지만 DATABASE_URL이 없어 게이트 조회 불가 — deploy 검사가 비활성입니다.')
  }
  if (w.decompose && !w.hasPool) {
    out.push('MANAGER_DECOMPOSE_ENABLED=true 이지만 DATABASE_URL이 없어 분해 emission이 트랜잭셔널 아웃박스를 경유하지 않습니다(raw 발행·내구성 없음).')
  }
  if (w.decompose && !w.decisionRouting) {
    out.push('[decompose] MANAGER_DECISION_ROUTING off — 분해 불일치가 C1 UI에 surface되지 않음(error 스트림만 노출).')
  }
  if (w.modelRouting && (!w.hasPool || !w.taskWorker)) {
    out.push('[model-routing] MANAGER_MODEL_ROUTING=true이나 전제(MANAGER_TASK_WORKER+DATABASE_URL) 미충족 — 모델 라우팅 비활성(CLAUDE_MODEL 폴백)')
  }
  return out
}

/**
 * 기동 경고 전량. `server.ts` 는 이 배열을 돌며 `app.log.warn` 만 한다.
 *
 * 순서는 **체인 단위**다(강등 → 배포·분해·모델 → 오라클 → 워커·검증 → mutation θ → 릴리스 게이트
 * → 결정·리스크). 이전에는 배선 코드 사이에 흩어져 있어 순서가 배선 순서를 따랐다 — 운영자가
 * 읽는 순서로 바뀐다.
 */
export function startupWarnings(w: StartupWiring): string[] {
  return [
    ...degradedWarnings(w),
    ...miscWarnings(w),
    ...oracleChainWarnings(w),
    ...workerWarnings(w),
    ...oracleChannelWarnings(w.wpConformance, 'MANAGER_WP_CONFORMANCE', 'conformance', w),
    ...oracleChannelWarnings(w.wpImpact, 'MANAGER_WP_IMPACT', 'impact', w),
    ...oracleChannelWarnings(w.wpProperty, 'MANAGER_WP_PROPERTY', 'property', w),
    ...mutationWarnings(w),
    ...mutationThetaWarnings(w),
    ...releaseGateWarnings({
      releaseGate: w.releaseGate, taskManager: w.taskManager, wpVerify: w.wpVerify, hasPool: w.hasPool,
    }),
    ...decisionWarnings(w),
  ]
}
