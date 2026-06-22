import type { DecisionRequestInput, DecisionBriefStore } from './decision-brief.js'
import { expiresAtFrom } from './decision-brief.js'

/** N2: DEGRADED 운영 중 보류된 HIGH-risk WP 정보(handleDispatch가 전달). */
export interface DegradedDispatchInfo {
  workflowId: string
  wpId: string
  stepN: number
  projectId?: string | null
}

/**
 * N2 사인오프 브리프: DEGRADED 모드 HIGH-risk WP 디스패치 보류를 degraded_dispatch DecisionRequest로 매핑.
 * **표준 DecisionContext**(buildDefectBrief/buildSignoffBrief와 동일 계약)라 C1 카드가 그대로 렌더.
 * requestId는 (workflowId, wpId) 결정론 → 재호출 멱등(createRequest ON CONFLICT DO NOTHING).
 */
export function buildDegradedDispatchBrief(info: DegradedDispatchInfo): DecisionRequestInput {
  return {
    requestId: `${info.workflowId}:degraded:${info.wpId}`,
    type: 'degraded_dispatch',
    workflowId: info.workflowId,
    correlationId: info.workflowId,
    wpId: info.wpId,
    severity: 'blocking',
    projectId: info.projectId ?? null,
    context: {
      location: `WP ${info.wpId} (step ${info.stepN})`,
      expectedVsActual: '운영 모드 DEGRADED 중 HIGH-risk WP 자동 디스패치 보류 — 위험을 알고 진행(accept_known)하거나 거부(reject).',
      impact: ['운영 강등(DEGRADED) 중 HIGH-risk 작업 자동 진행 보류.'],
      evidenceRefs: [`wp.held@${info.workflowId}/${info.wpId}`, 'risk=HIGH', 'mode=DEGRADED'],
      options: ['accept_known', 'reject'],
    },
  }
}

/**
 * 보류 → DecisionRequest 핸들러(makeSignoffBrief 패턴). expiresAt(B1 TTL) 병합 후 createRequest(멱등).
 * throw 방어는 호출자(handleDispatch 루프 — best-effort)가 감싼다.
 */
export function makeDegradedDispatchBrief(
  store: DecisionBriefStore,
  opts?: { now?: () => number; ttlMs?: number },
): (info: DegradedDispatchInfo) => Promise<void> {
  return async (info) => {
    const nowFn = opts?.now ?? Date.now
    const expiresAt = expiresAtFrom(nowFn(), opts?.ttlMs)
    await store.createRequest({ ...buildDegradedDispatchBrief(info), ...(expiresAt && { expiresAt }) })
  }
}
