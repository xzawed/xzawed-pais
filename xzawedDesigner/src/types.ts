import { z } from 'zod'
import { collaborationPayloadFields } from '@xzawed/agent-streams'

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

/**
 * **설계 수행 집계**(S5.2b) — "설계가 실제로 산출됐는가"를 전선에 싣는다.
 *
 * `parseResponse` 의 폴백은 generic 스텁 컴포넌트 1개를 그대로 `design_complete` 로 발행하므로
 * **소비자 쪽에서 성공과 모양이 같다**. 컴포넌트 수만 보면 파싱 실패 경로도 통과하므로
 * `SecurityAuditable` 과 같은 이유로 생산자가 출처를 밝힌다 — 소비자가 유도할 수 없는 값이다.
 *
 * `components` 는 유도 가능한데도 함께 싣는다. 이 저장소는 **Zod 2단 strip 으로 필드가 조용히
 * 사라지는 사고**를 반복해 왔다(S5.1) — 집계와 배열 길이가 어긋나면 전선 유실이므로 소비자가
 * 그것을 fail-closed 로 잡을 수 있다.
 */
export interface DesignAudit {
  /** `llm` = 응답을 파싱·검증해 얻은 실제 설계. `fallback` = 파싱/검증 실패로 발행한 generic 스텁. */
  source: 'llm' | 'fallback'
  /** 같은 메시지에 실은 컴포넌트 수. */
  components: number
}

export interface DesignerToManagerMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'design_complete' | 'error' | 'agent_query'
  payload: {
    components?: ComponentSpec[]
    uiSpec?: UISpec
    designed?: DesignAudit
    knowledge?: string[]
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
    // 협업 공통 입력 필드(clarificationContext·query·queryKind)
    ...collaborationPayloadFields,
  }),
})

export type ManagerToDesignerMessage = z.infer<typeof ManagerToDesignerMessageSchema>
