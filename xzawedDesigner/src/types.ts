import { z } from 'zod'

export const UISpecSchema = z.object({
  type: z.enum(['mockup_viewer', 'form', 'progress_board']),
  title: z.string().optional(),
  content: z.string().optional(),
})

export type UISpec = z.infer<typeof UISpecSchema>

// ComponentSpec is a recursive structure. The interface uses `| undefined`
// on optional arrays to be compatible with Zod's inferred type when
// exactOptionalPropertyTypes is enabled.
export interface ComponentSpec {
  name: string
  description: string
  props: Record<string, string>
  children?: ComponentSpec[] | undefined
  cssClasses?: string[] | undefined
}

export const ComponentSpecSchema: z.ZodType<ComponentSpec> = z.lazy(() =>
  z.object({
    name: z.string().min(1),
    description: z.string(),
    props: z.record(z.string()),
    children: z.array(ComponentSpecSchema).optional(),
    cssClasses: z.array(z.string()).optional(),
  })
)

export interface DesignerToManagerMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'design_complete' | 'error' | 'agent_query'
  payload: {
    components?: ComponentSpec[]
    uiSpec?: UISpec
    content: string
    // agent_query 발신 시 사용 (다른 에이전트에게 질의)
    to?: string
    question?: string
    kind?: 'active_request' | 'cross_check'
  }
}

const UserContextSchema = z.object({
  userId: z.string(),
  projectId: z.string(),
  workspaceRoot: z.string(),
  githubRepo: z.object({ owner: z.string(), repo: z.string(), branch: z.string() }).optional(),
})

export const ManagerToDesignerMessageSchema = z.object({
  sessionId: z.string().uuid(),
  messageId: z.string(),
  timestamp: z.number(),
  type: z.enum(['design_request', 'abort']),
  payload: z.object({
    intent: z.string().min(1).max(4000),
    context: z.record(z.unknown()),
    targetFramework: z.string().optional(),
    designSystem: z.string().optional(),
    userContext: UserContextSchema.optional(),
    // 협업: 다른 에이전트 질의 응답(clarificationContext) 또는 질의 답변 모드(query)
    clarificationContext: z.string().optional(),
    query: z.string().optional(),
    queryKind: z.enum(['active_request', 'cross_check']).optional(),
  }),
})

export type ManagerToDesignerMessage = z.infer<typeof ManagerToDesignerMessageSchema>
