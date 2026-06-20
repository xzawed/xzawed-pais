import type { DecisionRequestInput, DecisionBriefStore } from './decision-brief.js'
import type { GraphQueryPort } from './lease.js'
import type { WpGateView } from '../db/release-gate.types.js'

/** gate.blocked 페이로드의 사인오프 브리프 입력(release-consumer가 전달). */
export interface SignoffBriefInfo {
  workflowId: string
  gateVersion: string
  blockingReasons: string[]
  perWp: WpGateView[]
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

/** 그래프에서 projectId 조회 — 미주입·미존재·실패는 null(N3 never-throw·C0 패턴). */
async function resolveProjectId(graphStore: GraphQueryPort | undefined, workflowId: string): Promise<string | null> {
  if (!graphStore) return null
  try {
    return (await graphStore.getGraph(workflowId))?.userContext?.projectId ?? null
  } catch (err) {
    console.warn('[signoff-brief] projectId 조회 실패(best-effort·null 강등):', err)
    return null
  }
}

/**
 * gate.blocked → DecisionRequest 핸들러(makeEscalationBrief 패턴). projectId 스레딩 후 createRequest.
 * throw 방어는 호출자(release-consumer)가 best-effort로 감싼다.
 */
export function makeSignoffBrief(store: DecisionBriefStore, graphStore?: GraphQueryPort): (info: SignoffBriefInfo) => Promise<void> {
  return async (info) => {
    const projectId = await resolveProjectId(graphStore, info.workflowId)
    await store.createRequest(buildSignoffBrief(info, projectId))
  }
}
