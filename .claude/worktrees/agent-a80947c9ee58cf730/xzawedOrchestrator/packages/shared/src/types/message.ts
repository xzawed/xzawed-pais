import type { UISpec } from './ui-spec.js'

export type MessageRole = 'user' | 'assistant' | 'system'

export interface Message {
  id: string
  sessionId: string
  role: MessageRole
  content: string
  timestamp: number
  uiSpec?: UISpec
}

export type Chunk =
  | { type: 'text'; content: string }
  | { type: 'done'; content: string }
  | { type: 'error'; content: string }
  | { type: 'claude_session'; content: string }
