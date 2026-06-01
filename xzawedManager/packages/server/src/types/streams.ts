import type { UserContext } from './user-context.js'

export type { UserContext }
export type OrchestratorMessageType = 'task_request' | 'info_response' | 'abort'
export type ManagerMessageType = 'status_update' | 'info_request' | 'task_complete' | 'error'

interface BaseMessage {
  sessionId: string
  messageId: string
  timestamp: number
}

export interface TaskRequestMessage extends BaseMessage {
  type: 'task_request'
  payload: { intent: string; context: Record<string, unknown>; priority: 'normal' | 'high'; userContext?: UserContext | undefined }
}

export interface InfoResponseMessage extends BaseMessage {
  type: 'info_response'
  payload: { answer: string }
}

export interface AbortMessage extends BaseMessage {
  type: 'abort'
  payload: Record<string, never>
}

export type OrchestratorToManagerMessage = TaskRequestMessage | InfoResponseMessage | AbortMessage

/** 승인 게이트 요청 메타 — info_request payload에 실어 Orchestrator UI가 승인/수정/중단을 렌더한다. */
export interface ApprovalRequest {
  stage: string
  summary: string
  mode: 'manual'
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
    approval?: ApprovalRequest
  }
}

export type UIFieldType = 'text' | 'textarea' | 'select' | 'checkbox_group' | 'number'

export interface UISelectOption {
  value: string
  label: string
}

export interface UIField {
  id: string
  type: UIFieldType
  label: string
  required?: boolean
  options?: UISelectOption[]
  placeholder?: string
}

export interface UISpec {
  type: 'form' | 'mockup_viewer' | 'progress_board'
  title?: string
  fields?: UIField[]
  submitAction?: string
  content?: string
}
