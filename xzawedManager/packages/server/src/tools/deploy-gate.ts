/**
 * P5-2b 배포 게이팅 — 순수 판정 코어 + 좁은 포트.
 * deploy_project가 repo가 아닌 이 포트에만 의존(C0 GraphQueryPort 패턴·결합도 최소).
 * ReleaseDeployGate 구현체는 Task 4에서 같은 파일에 additive로 추가된다.
 */

/** Orchestrator가 프로젝트 미선택 세션에 보내는 마법 문자열(sessions.route.ts:118). 부재와 동일 취급(fail-open). */
export const PROJECTLESS_SENTINEL = 'default'

export interface DeployGateVerdict {
  allowed: boolean
  /** 차단 시 tool_result 오류 메시지에 들어갈 사람 가독 사유. */
  reason?: string
}

export interface DeployGatePort {
  /** 프로젝트의 배포 허용 여부. 절대 throw 안 함(N3) — 어떤 오류든 allowed=true(fail-open). */
  checkDeploy(projectId: string | undefined): Promise<DeployGateVerdict>
}

/**
 * 순수 결정론 판정 — 게이트/사인오프 차원 4분기.
 * hasApprovedSignoff는 gate.status==='blocked'일 때만 의미 있는 우회 수단 —
 * passed/null 경로에서는 평가하지 않는다(호출부가 false로 전달).
 */
export function evaluateDeployGate(input: {
  gate: { status: 'passed' | 'blocked'; workflowId: string } | null
  hasApprovedSignoff: boolean
}): DeployGateVerdict {
  const { gate, hasApprovedSignoff } = input
  if (gate === null) return { allowed: true }
  if (gate.status === 'passed') return { allowed: true }
  // gate.status === 'blocked'
  if (hasApprovedSignoff) return { allowed: true }
  return {
    allowed: false,
    reason:
      `릴리스 게이트가 BLOCKED(workflow ${gate.workflowId})이고 승인된 릴리스 사인오프가 없습니다. ` +
      `차단 WP를 해소하거나 릴리스 사인오프(accept_known)를 받은 뒤 배포하세요.`,
  }
}
