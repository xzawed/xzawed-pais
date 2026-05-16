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
  }),
})

export type ManagerToDesignerMessage = z.infer<typeof ManagerToDesignerMessageSchema>
