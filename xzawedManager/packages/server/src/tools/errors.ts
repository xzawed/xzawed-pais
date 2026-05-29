export class ClarificationNeededError extends Error {
  constructor(
    public readonly content: string,
    public readonly uiSpec?: unknown,
  ) {
    super(`Clarification needed: ${content}`)
    this.name = 'ClarificationNeededError'
  }
}
