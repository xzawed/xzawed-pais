import { z } from 'zod'

export interface FileEvent {
  path: string
  event: 'add' | 'change' | 'unlink'
  timestamp: number
}

export interface WatcherToManagerMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'watch_started' | 'file_changed' | 'watch_stopped' | 'error'
  payload: {
    watcherId?: string
    changes?: FileEvent[]
    content: string
  }
}

export const ManagerToWatcherMessageSchema = z.object({
  sessionId: z.string(),
  messageId: z.string(),
  timestamp: z.number(),
  type: z.enum(['watch_request', 'stop_watch', 'abort']),
  payload: z.object({
    projectPath: z.string(),
    triggers: z.array(z.string()),
    debounceMs: z.number().int().nonnegative().optional(),
    context: z.record(z.unknown()),
  }),
})

export type ManagerToWatcherMessage = z.infer<typeof ManagerToWatcherMessageSchema>
