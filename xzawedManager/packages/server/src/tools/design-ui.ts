import { z } from 'zod'
import type { ToolHandler } from './handler.interface.js'
import { RedisAgentHandler } from './redis-agent-handler.js'

interface ComponentSpec {
  name: string
  description: string
  props: Record<string, string>
  children?: ComponentSpec[]
  cssClasses?: string[]
}

interface UISpec {
  type: 'mockup_viewer' | 'form' | 'progress_board'
  title?: string
  content?: string
}

interface DesignUiInput {
  intent: string
  targetFramework?: string
  designSystem?: string
  context: Record<string, unknown>
}

interface DesignUiOutput {
  components: ComponentSpec[]
  uiSpec: UISpec
  content: string
}

const inputSchema = {
  type: 'object' as const,
  properties: {
    intent: { type: 'string', description: 'The UI/UX design intent to implement' },
    targetFramework: { type: 'string', description: 'Frontend framework (default: react)' },
    designSystem: { type: 'string', description: 'Design system to use (default: tailwind)' },
    context: { type: 'object', description: 'Additional context for design' },
  },
  required: ['intent', 'context'],
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const componentSpecSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    name: z.string(),
    description: z.string(),
    props: z.record(z.string()),
    children: z.array(componentSpecSchema).optional(),
    cssClasses: z.array(z.string()).optional(),
  }),
)

const uiSpecSchema = z.object({
  type: z.enum(['mockup_viewer', 'form', 'progress_board']),
  title: z.string().optional(),
  content: z.string().optional(),
})

const outputSchema = z.object({
  components: z.array(componentSpecSchema).default([]),
  uiSpec: uiSpecSchema.default({ type: 'mockup_viewer' }),
  content: z.string().default(''),
})

export function createDesignUiHandler(redisUrl: string): ToolHandler<DesignUiInput, DesignUiOutput> {
  return new RedisAgentHandler<DesignUiInput, DesignUiOutput>(
    redisUrl,
    'designer',
    'design_request',
    'design_complete',
    'design_ui',
    'Design UI components and layout specification for a given intent',
    inputSchema,
    outputSchema as unknown as z.ZodType<DesignUiOutput>,
  )
}
