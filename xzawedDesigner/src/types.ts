import { z } from 'zod'

export interface ComponentSpec {
  name: string
  description: string
  props: Record<string, string>
  children?: ComponentSpec[]
  cssClasses?: string[]
}

export interface UISpec {
  type: 'mockup_viewer' | 'form' | 'progress_board'
  title?: string
  content?: string
}

export interface DesignerToManagerMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'design_complete' | 'error'
  payload: {
    components?: ComponentSpec[]
    uiSpec?: UISpec
    content: string
  }
}

const UserContextSchema = z.object({
  userId: z.string(),
  projectId: z.string(),
  workspaceRoot: z.string(),
  githubRepo: z.object({ owner: z.string(), repo: z.string(), branch: z.string() }).optional(),
})

export const ManagerToDesignerMessageSchema = z.object({
  sessionId: z.string(),
  messageId: z.string(),
  timestamp: z.number(),
  type: z.enum(['design_request', 'abort']),
  payload: z.object({
    intent: z.string(),
    context: z.record(z.unknown()),
    targetFramework: z.string().optional(),
    designSystem: z.string().optional(),
    userContext: UserContextSchema.optional(),
  }),
})

export type ManagerToDesignerMessage = z.infer<typeof ManagerToDesignerMessageSchema>
