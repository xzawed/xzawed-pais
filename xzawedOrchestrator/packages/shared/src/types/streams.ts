import type { UISpec } from './ui-spec.js'

export type OrchestratorMessageType = 'task_request' | 'info_response' | 'abort'
export type ManagerMessageType = 'status_update' | 'info_request' | 'task_complete' | 'error'

export interface OrchestratorToManagerMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: OrchestratorMessageType
  payload: {
    intent: string
    context: Record<string, unknown>
    priority: 'normal' | 'high'
  }
}

export interface ManagerToOrchestratorMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: ManagerMessageType
  payload: {
    agentId: string
    content: string
    uiSpec?: UISpec
  }
}
