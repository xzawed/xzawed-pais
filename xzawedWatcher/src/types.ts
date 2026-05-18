import { z } from 'zod'
import path from 'node:path'

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

const UserContextSchema = z.object({
  userId: z.string(),
  projectId: z.string(),
  workspaceRoot: z.string(),
  githubRepo: z.object({ owner: z.string(), repo: z.string(), branch: z.string() }).optional(),
})

export const ManagerToWatcherMessageSchema = z.object({
  sessionId: z.string(),
  messageId: z.string(),
  timestamp: z.number(),
  type: z.enum(['watch_request', 'stop_watch', 'abort']),
  payload: z.object({
    projectPath: z.string(),
    triggers: z.array(
      z.string().refine(
        s => !path.isAbsolute(s) && !s.includes('..'),
        { message: 'triggers must be relative glob patterns without path traversal' }
      )
    ),
    debounceMs: z.number().int().nonnegative().optional(),
    context: z.record(z.unknown()),
    userContext: UserContextSchema.optional(),
  }),
})

export type ManagerToWatcherMessage = z.infer<typeof ManagerToWatcherMessageSchema>
