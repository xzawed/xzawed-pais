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

export interface UISpec {
  type: UISpecType
  title?: string
  fields?: UIField[]
  submitAction?: string
  content?: string
}
