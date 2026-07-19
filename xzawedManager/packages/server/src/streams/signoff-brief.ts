import type { DecisionRequestInput, DecisionBriefStore } from './decision-brief.js'
import { expiresAtFrom } from './decision-brief.js'
import { resolveScope, type GraphQueryPort } from './lease.js'

/** gate.blocked 페이로드의 사인오프 브리프 입력(release-consumer가 전달). */
export interface SignoffBriefInfo {
  workflowId: string
  gateVersion: string
  blockingReasons: string[]
  perWp: Array<{ wpId: string; proven: boolean }>
}

/**
 * §15 사인오프 브리프: 차단된 릴리스 게이트(ReleaseGateResult)를 degraded_release DecisionRequest 입력으로 매핑.
 * **표준 DecisionContext 형태**(C0 buildDefectBrief와 동일 계약)라 C1 카드가 그대로 렌더.
 * requestId는 (workflowId, gateVersion) 결정론 → 재발행 멱등(createRequest ON CONFLICT DO NOTHING).
 */
export function buildSignoffBrief(info: SignoffBriefInfo, projectId?: string | null): DecisionRequestInput {
  const unproven = info.perWp.filter((w) => !w.proven)
  return {
    requestId: `${info.workflowId}:gate:${info.gateVersion}`,
    type: 'degraded_release',
    workflowId: info.workflowId,
    correlationId: info.workflowId,
    wpId: null,
    severity: 'blocking',
    projectId: projectId ?? null,
    context: {
      location: `릴리스 게이트 (gate ${info.gateVersion})`,
      expectedVsActual: `${unproven.length}개 WP 미증명 — 릴리스 게이트 차단. 위험을 알고 수용(accept_known)하거나 거부(reject).`,
      impact: info.blockingReasons,
      evidenceRefs: unproven.map((w) => w.wpId),
      options: ['accept_known', 'reject'],
    },
  }
}

/**
 * gate.blocked → DecisionRequest 핸들러(makeEscalationBrief 패턴). projectId·tenantId 스레딩 후 createRequest.
 * 그래프 조회는 resolveScope(lease.ts, GraphQueryPort 정의처 공유)로 한 번만 — 조회 중복 없음.
 * throw 방어는 호출자(release-consumer)가 best-effort로 감싼다.
 */
export function makeSignoffBrief(
  store: DecisionBriefStore,
  graphStore?: GraphQueryPort,
  opts?: { now?: () => number; ttlMs?: number },
): (info: SignoffBriefInfo) => Promise<void> {
  return async (info) => {
    const { projectId, tenantId } = await resolveScope(graphStore, info.workflowId, 'signoff-brief')
    const nowFn = opts?.now ?? Date.now
    const expiresAt = expiresAtFrom(nowFn(), opts?.ttlMs)
    await store.createRequest({ ...buildSignoffBrief(info, projectId), tenantId, ...(expiresAt && { expiresAt }) })
  }
}
