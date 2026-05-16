import type { Session, ClaudeMode } from '@xzawed/shared'
import { randomUUID } from 'node:crypto'

export function createSession(userId: string, claudeMode: ClaudeMode): Session {
  const now = Date.now()
  return {
    id: randomUUID(),
    userId,
    state: 'active',
    claudeMode,
    createdAt: now,
    updatedAt: now,
  }
}
