import { z } from 'zod'
import type { ToolHandler } from './handler.interface.js'
import { RedisAgentHandler } from './redis-agent-handler.js'
import type { Bulkhead } from '@xzawed/agent-streams'

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

/** 설계 수행 집계(S5.2b). 정본은 `xzawedDesigner/src/types.ts`의 `DesignAudit` — 서비스 간
 *  import 금지(M3)라 여기서 재선언한다. 변경 시 `/contract-drift-check`로 대조한다. */
interface DesignAudit {
  source: 'llm' | 'fallback'
  components: number
}

interface DesignUiOutput {
  components: ComponentSpec[]
  uiSpec: UISpec
  content: string
  knowledge?: string[]
  designed?: DesignAudit
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

/**
 * ⚠️ **`components`·`uiSpec`의 `.default()`를 걷어내지 않는다.**
 *
 * `design_complete` 를 발행하는 프로덕션 경로는 **둘**이다. `designer.ts` 의 `runMain` 은 두
 * 필드를 항상 채우지만, **교차질의 답변**은 shared `publishQueryAnswer` 가 발행하며
 * `payload: { content }` 뿐이다(`xzawedShared/src/streams/collaboration.ts`). 기본값을 걷어내면
 * `RedisAgentHandler` 의 `outputSchema.parse` 가 그 메시지에서 throw 하고, 그것은 **플래그 뒤가
 * 아니라 기본 실행되는 챗 경로**다(AgentQuery 교차질의 라우팅). S5.2b 를 만들면서 실제로 한 번
 * 깼고 Grok 반증이 잡았다 — 유닛 스위트는 초록이었다.
 *
 * **기본값이 증거를 위조하지 않는다**(그래서 남겨도 된다). `design_ui` 자기검증의 증거는
 * `designed` 집계이지 `components` 가 아니다 — 기본값으로 만들어진 `[]` 는 `designed` 부재로
 * 판정에서 걸린다(`judgeDesignUiWp`, fail-closed). 위조 가능한 자리를 없앤 것은 **증거를 다른
 * 필드로 옮겨서**이지 기본값을 지워서가 아니다.
 *
 * 회귀 잠금은 `streams/design-wp-selfverify.test.ts` 의 "교차질의 답변" 테스트가 갖는다.
 */
export const designUiOutputSchema = z.object({
  components: z.array(componentSpecSchema).default([]),
  uiSpec: uiSpecSchema.default({ type: 'mockup_viewer' }),
  content: z.string().default(''),
  knowledge: z.array(z.string()).optional(),
  // 여기 없으면 상위 스키마를 통과한 필드가 Zod strip에서 사라져 verify가 볼 수 없다(2단 strip).
  designed: z.object({
    source: z.enum(['llm', 'fallback']),
    components: z.number(),
  }).optional(),
})

export function createDesignUiHandler(redisUrl: string, bulkhead?: Bulkhead): ToolHandler<DesignUiInput, DesignUiOutput> {
  return new RedisAgentHandler<DesignUiInput, DesignUiOutput>(
    redisUrl,
    'designer',
    'design_request',
    'design_complete',
    'design_ui',
    'Design UI components and layout specification for a given intent',
    inputSchema,
    designUiOutputSchema as unknown as z.ZodType<DesignUiOutput>,
    undefined,
    bulkhead,
  )
}
