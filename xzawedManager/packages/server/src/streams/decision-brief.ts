import type { DecisionRequest, FaultAttribution } from '../db/decision.types.js'

/** lease 상한 초과로 ESCALATED된 WP 정보(handleLeaseSweep이 전달). */
export interface EscalationInfo {
  workflowId: string
  wpId: string
  attempt: number
  stepN: number
  /** C0/C1: 생성 시점 프로젝트 스코프(graph_dag.userContext.projectId). 미해석은 null. */
  projectId?: string | null
  /** G11 Slice 4: 생성 시점 테넌트 스코프(graph_dag.userContext.tenantId, lease.ts resolveScope 경유). 미해석은 null. */
  tenantId?: string | null
}

/** `DecisionRepo.createRequest` 입력의 구조적 부분집합 — repo 직접 결합 회피(M3). */
export interface DecisionRequestInput {
  requestId: string
  type: DecisionRequest['type']
  workflowId: string
  correlationId: string
  wpId?: string | null
  context?: DecisionRequest['context']
  severity?: DecisionRequest['severity']
  projectId?: string | null
  /** G11 Slice 4: 테넌트 태그(생성 시점 userContext.tenantId). 저장소 인자이지 브리프 내용이 아니므로
   *  순수 빌더는 미설정 — 호출부가 store.createRequest 스프레드 시 얹는다. */
  tenantId?: string | null
  /** B1: 결정 TTL 만료 시각(ISO). 핸들러가 now+TTL로 주입·순수 빌더는 미설정. */
  expiresAt?: string | null
}

/**
 * DecisionRepo의 createRequest만 의존(구조적). G11 Slice 4 리뷰 수정: `tenantId`를 **seam에서 필수화**
 * (`DecisionRequestInput.tenantId`는 옵셔널로 남겨 순수 빌더는 무영향 — dispatch.ts `onDegradedHighRisk`
 * 선례 형태). 이전엔 이 인터페이스가 옵셔널을 그대로 노출해 `DecisionRepo.createRequest`의 필수 인자가
 * 호출부까지 도달하지 못했다(초과 프로퍼티 검사로 착시된 "9곳 에러" — 실제 강제는 0).
 */
export interface DecisionBriefStore {
  createRequest(req: DecisionRequestInput & { tenantId: string | null }): Promise<{ eventId: string } | null>
}

/** B1: now(ms)+ttlMs → ISO 만료 시각. ttlMs 미설정/비양수면 undefined(만료 없음·회귀 0). 순수. */
export function expiresAtFrom(now: number, ttlMs: number | undefined): string | undefined {
  if (!ttlMs || ttlMs <= 0) return undefined
  return new Date(now + ttlMs).toISOString()
}

/**
 * §11 결정론 결함 귀속(LLM 0·N6): escalate = impl 계층 K회(maxAttempts) 정직 재시도 소진.
 * 구현으로 해소 안 됨 → 계약사슬 상위(Task/plan) 검토 신호. 상위 귀속 확정은 사람 결정(P6 라우팅).
 */
export function localizeFault(info: EscalationInfo): FaultAttribution {
  return { faultTier: 'impl_exhausted', counters: { impl: info.attempt + 1, task: 0, plan: 0 } }
}

/**
 * §15 결함 의사결정 브리프: WP 에스컬레이션(lease 상한 초과)을 **사람 결정 요청**으로 구조화한다.
 * 사람에게 위치·기대 vs 실제·선택지를 제공하고(§15), 결정은 §4 choice로 다운스트림 라우팅된다.
 * requestId는 (wf,wpId,attempt) 결정론 → 재호출 멱등(`createRequest` ON CONFLICT DO NOTHING).
 */
export function buildDefectBrief(info: EscalationInfo): DecisionRequestInput {
  const { workflowId, wpId, attempt, stepN } = info
  // attribution을 단일 출처로 산출하고 시도 횟수(tries)는 거기서 파생 — attempt+1을 한 곳에서만 계산.
  const attribution = localizeFault(info)
  const tries = attribution.counters.impl
  return {
    requestId: `${workflowId}:${wpId}:${attempt}`,
    type: 'defect_brief',
    workflowId,
    correlationId: workflowId,
    wpId,
    severity: 'blocking',
    projectId: info.projectId ?? null,
    context: {
      location: `WP ${wpId} (step ${stepN})`,
      expectedVsActual: `구현 계층에서 ${tries}회 정직 재시도 모두 검증 실패 — 구현으로 해소 불가. 계약 사슬상 Task(스펙 모호/불가능) 또는 plan(기획 모순) 검토 필요.`,
      impact: ['이 WP에 의존하는 후행 작업이 차단됨(lease escalated).'],
      evidenceRefs: [`wp.escalated@${workflowId}/${wpId}`, `attempt=${tries}`],
      // D10: decision-consumer는 defect_brief에서 fix_reverify만 능동 처리한다(escalated lease reopen→재디스패치).
      // spec_fix(재분해)·accept_known(수용)·reject(saga)는 핸들러가 없어 RESOLVED만 남기는 무음 no-op이므로
      // 거짓 affordance를 제거하기 위해 핸들 가능한 choice만 노출한다(미구현 동작 버튼 비표시).
      // 후속 슬라이스가 핸들러를 추가하면 그 choice를 다시 노출한다(degraded-signoff-brief가 핸들 가능 choice만 나열하는 선례).
      options: ['fix_reverify'],
      attribution,
    },
  }
}

/**
 * 에스컬레이션 → DecisionRequest 핸들러. `handleLeaseSweep`의 `onEscalated`에 주입돼 escalate 성공 시
 * 결함 브리프를 영속한다(발행만 되고 사라지던 escalation을 사람 도달 핸드오프로 폐합·M8/M9).
 * throw 방어는 호출자(handleLeaseSweep)가 best-effort로 감싼다 — 브리프 부재가 sweep을 멈추지 않게.
 */
export function makeEscalationBrief(
  store: DecisionBriefStore,
  opts?: { now?: () => number; ttlMs?: number },
): (info: EscalationInfo) => Promise<void> {
  return async (info) => {
    const nowFn = opts?.now ?? Date.now
    const expiresAt = expiresAtFrom(nowFn(), opts?.ttlMs)
    await store.createRequest({ ...buildDefectBrief(info), tenantId: info.tenantId ?? null, ...(expiresAt && { expiresAt }) })
  }
}
