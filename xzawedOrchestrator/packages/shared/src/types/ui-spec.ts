export type UIFieldType =
  | 'text'
  | 'textarea'
  | 'select'
  | 'checkbox_group'
  | 'number'

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

export type UISpecType = 'form' | 'mockup_viewer' | 'progress_board'

/**
 * Designer가 산출하는 컴포넌트 트리 노드(재귀). 승인 게이트 데모에서 중첩 박스 와이어프레임으로 렌더한다.
 * Designer `ComponentSpec`과 동일 형태(서비스 간 계약) — 변경 시 양쪽 동기화 필요.
 */
export interface ComponentSpec {
  name: string
  description: string
  props?: Record<string, string>
  children?: ComponentSpec[]
  cssClasses?: string[]
}

export interface UISpec {
  type: UISpecType
  title?: string
  fields?: UIField[]
  submitAction?: string
  content?: string
  /** Designer 컴포넌트 트리(있으면 UiSpecPreview가 중첩 박스 와이어프레임으로 리치 렌더). */
  components?: ComponentSpec[]
}
