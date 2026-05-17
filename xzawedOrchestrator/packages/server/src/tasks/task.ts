export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface Task {
  id: string
  sessionId: string
  status: TaskStatus
  intent: string
  result?: string
  createdAt: number
  updatedAt: number
}
