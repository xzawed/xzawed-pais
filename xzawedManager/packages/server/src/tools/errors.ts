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
