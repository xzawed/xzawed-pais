import type { UISpec } from './ui-spec.js'

export type OrchestratorMessageType = 'task_request' | 'info_response' | 'abort' | 'decompose_request'
export type ManagerMessageType = 'status_update' | 'info_request' | 'task_complete' | 'error' | 'knowledge_changed'

export interface UserContext {
  userId: string
  projectId: string
  workspaceRoot: string
  githubRepo?: { owner: string; repo: string; branch: string }
}

export type OrchestratorToManagerMessage =
  | {
      sessionId: string
      messageId: string
      timestamp: number
      type: 'task_request'
      payload: {
        intent: string
        context: Record<string, unknown>
        priority: 'normal' | 'high'
        userContext?: UserContext
      }
    }
  | {
      sessionId: string
      messageId: string
      timestamp: number
      type: 'info_response'
      payload: { answer: string }
    }
  | {
      sessionId: string
      messageId: string
      timestamp: number
      type: 'abort'
      payload: Record<string, never>
    }
  | {
      sessionId: string
      messageId: string
      timestamp: number
      type: 'decompose_request'
      payload: { intent: string; userContext?: UserContext }
    }

/** 승인 게이트 요청 메타 — info_request에 실려 단계 결과 검토·승인/수정/중단을 UI에 표시한다. */
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
    /** knowledge_changed 이벤트의 대상 프로젝트 — 위키가 즉시 새로고침할지 판단. */
    projectId?: string
  }
}
