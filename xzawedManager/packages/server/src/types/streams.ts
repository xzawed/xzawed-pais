import type { UserContext } from './user-context.js'

export type { UserContext }
export type OrchestratorMessageType = 'task_request' | 'info_response' | 'abort' | 'decompose_request'
export type ManagerMessageType = 'status_update' | 'info_request' | 'task_complete' | 'error' | 'knowledge_changed'

interface BaseMessage {
  sessionId: string
  messageId: string
  timestamp: number
}

export interface TaskRequestMessage extends BaseMessage {
  type: 'task_request'
  payload: {
    intent: string
    context: Record<string, unknown>
    priority: 'normal' | 'high'
    userContext?: UserContext | undefined
    /** 전역 게이트 모드(설정 UI에서 전달) — Manager가 세션 기본 승인 모드로 적용. */
    gateMode?: 'manual' | 'auto' | undefined
  }
}

export interface InfoResponseMessage extends BaseMessage {
  type: 'info_response'
  payload: { answer: string }
}

export interface AbortMessage extends BaseMessage {
  type: 'abort'
  payload: Record<string, never>
}

export interface DecomposeRequestMessage extends BaseMessage {
  type: 'decompose_request'
  payload: {
    intent: string
    /** P4a-2: 워크플로 워크스페이스 컨텍스트 — 그래프에 영속돼 실행 워커가 에이전트 호출에 주입. */
    userContext?: UserContext | undefined
  }
}

export type OrchestratorToManagerMessage =
  | TaskRequestMessage
  | InfoResponseMessage
  | AbortMessage
  | DecomposeRequestMessage

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
    /** knowledge_changed 이벤트의 대상 프로젝트 — 위키가 즉시 새로고침할지 판단. */
    projectId?: string
    /** G5 고객 비용 가시성: 세션 누적 비용(USD·costOf 추정)·토큰 수. status_update마다 갱신. */
    costUsd?: number
    tokensUsed?: number
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

/** Designer 컴포넌트 트리 노드(재귀) — Orchestrator UiSpecPreview가 중첩 박스 와이어프레임으로 렌더. */
export interface ComponentSpec {
  name: string
  description: string
  props?: Record<string, string>
  children?: ComponentSpec[]
  cssClasses?: string[]
}

export interface UISpec {
  type: 'form' | 'mockup_viewer' | 'progress_board'
  title?: string
  fields?: UIField[]
  submitAction?: string
  content?: string
  /** Designer 컴포넌트 트리(design_ui 산출). 프론트가 리치 데모 렌더에 사용. */
  components?: ComponentSpec[]
}
