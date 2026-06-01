export class ClarificationNeededError extends Error {
  constructor(
    public readonly content: string,
    public readonly uiSpec?: unknown,
  ) {
    super(`Clarification needed: ${content}`)
    this.name = 'ClarificationNeededError'
  }
}

export class AgentQueryError extends Error {
  constructor(
    public readonly to: string,
    public readonly question: string,
    public readonly kind: 'active_request' | 'cross_check' = 'active_request',
  ) {
    super(`Agent query to ${to}: ${question}`)
    this.name = 'AgentQueryError'
  }
}

/** 사용자가 승인 게이트에서 중단(abort)을 선택했을 때 — 루프를 빠져나가 세션을 종료시킨다. */
export class GateAbortError extends Error {
  constructor(public readonly stage: string) {
    super(`Session aborted by user at gate: ${stage}`)
    this.name = 'GateAbortError'
  }
}
