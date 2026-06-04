import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { AgentQuery, parseAgentQuery, answerViaClaude, callClaudeText, formatDomainKnowledge } from '@xzawed/agent-streams'
import { AGENT_TYPES } from '../types.js'
import type { Step, UISpec } from '../types.js'

const API_TIMEOUT_MS = Number(process.env["CLAUDE_TIMEOUT_MS"] ?? "120000")

/** 프롬프트에 노출할 agentType 열거 문자열 — AGENT_TYPES 단일 소스에서 생성. */
const AGENT_TYPE_LIST = AGENT_TYPES.map((t) => `"${t}"`).join(' | ')

const StepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string(),
  agentType: z.enum(AGENT_TYPES),
  dependencies: z.array(z.string()),
  estimatedMinutes: z.number().positive().max(480),
})

const KnowledgeItemSchema = z.union([
  z.string(),
  z.object({ content: z.string(), category: z.string().optional() }),
])

const PlanResponseSchema = z.object({
  steps: z.array(StepSchema).min(1).max(50),
  estimatedTime: z.string().optional(),
  knowledge: z.array(KnowledgeItemSchema).optional(),
})

export const SYSTEM_PROMPT = `You are a software project planning agent. Given a development intent and context, break it down into concrete, actionable steps.

If the prompt includes a "이전 프로젝트 도메인 지식" section, you MUST respect and build upon those prior decisions and constraints.

Return ONLY valid JSON in one of these formats:

Format 1 — When the intent is clear:
{
  "steps": [
    {
      "id": "step-1",
      "title": "Short title",
      "description": "Detailed description of what to do",
      "agentType": "developer",
      "dependencies": [],
      "estimatedMinutes": 30
    }
  ],
  "estimatedTime": "2 hours",
  "knowledge": [{"content": "결제는 Stripe 사용", "category": "decision"}, {"content": "PII는 암호화 저장", "category": "constraint"}]
}
"knowledge"는 선택. 각 항목은 프로젝트 도메인 결정·제약·규칙 1개이며 category는 "decision" | "constraint" | "rule" | "tech" 중 하나(분류가 모호하면 생략 가능).

Format 2 — When clarification is needed:
{
  "clarification_needed": true,
  "question": "What specific framework would you like to use?",
  "fields": [
    { "id": "framework", "label": "Frontend Framework", "type": "select", "options": ["React", "Vue", "Angular"], "required": true }
  ]
}

Format 3 — When you need another expert agent's input to plan correctly:
{
  "agent_query": true,
  "to": "developer",
  "question": "Is a real-time WebSocket layer feasible within scope?",
  "kind": "active_request"
}

agentType / "to" values: ${AGENT_TYPE_LIST}
Set dependencies as array of step ids that must complete first.
Only ask the user for clarification (Format 2) when truly essential information is missing.
Use Format 3 only when another expert's input genuinely affects the plan. When an answer from another agent is provided, incorporate it and return Format 1.`

export class ClarificationNeeded {
  constructor(
    public readonly question: string,
    public readonly fields: UISpec['fields']
  ) {}
}

export class ClaudeRunner {
  private readonly client: Anthropic

  constructor(apiKey: string, private readonly model: string) {
    this.client = new Anthropic({ apiKey })
  }

  /** 다른 에이전트의 질의(query)에 기획 관점에서 답한다. */
  async answerQuery(query: string, context: Record<string, unknown>): Promise<string> {
    return answerViaClaude(
      this.client,
      this.model,
      'You are a software planning expert. Answer the question concisely from a planning/scoping perspective. Plain text, no JSON.',
      query,
      context,
    )
  }

  async generatePlan(
    intent: string,
    context: Record<string, unknown>,
    priority: 'normal' | 'high',
    clarificationContext?: string,
  ): Promise<{ steps: Step[]; estimatedTime: string; knowledge?: (string | { content: string; category?: string })[] } | ClarificationNeeded | AgentQuery> {
    const userContent = [
      formatDomainKnowledge(context),
      `Intent: ${intent}`,
      `Priority: ${priority}`,
      `Context: ${JSON.stringify(context, null, 2)}`,
      clarificationContext ? `Answer from another agent: ${clarificationContext}` : '',
    ].filter(Boolean).join('\n')

    const text = await callClaudeText(this.client, this.model, 2048, SYSTEM_PROMPT, userContent, API_TIMEOUT_MS)

    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end === -1) return this.fallback(intent)

    let parsed: Record<string, unknown>
    try {
      const raw: unknown = JSON.parse(text.slice(start, end + 1))
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return this.fallback(intent)
      parsed = raw as Record<string, unknown>
    } catch {
      return this.fallback(intent)
    }

    const agentQuery = parseAgentQuery(parsed)
    if (agentQuery) return agentQuery

    if (parsed.clarification_needed === true) {
      const ClarificationFieldSchema = z.object({
        id: z.string(),
        label: z.string(),
        type: z.enum(['text', 'select', 'textarea']),
        options: z.array(z.string()).optional(),
        required: z.boolean().optional(),
      })
      const fieldsResult = z.array(ClarificationFieldSchema).safeParse(parsed.fields)
      const validatedFields: UISpec['fields'] = fieldsResult.success
        ? fieldsResult.data.map(f => {
            const field: UISpec['fields'][number] = { id: f.id, label: f.label, type: f.type }
            if (f.options !== undefined) field.options = f.options
            if (f.required !== undefined) field.required = f.required
            return field
          })
        : []
      return new ClarificationNeeded(
        String(parsed.question ?? 'Could you provide more details?'),
        validatedFields
      )
    }

    const planResult = PlanResponseSchema.safeParse(parsed)
    if (!planResult.success) {
      console.warn('Plan response validation failed:', planResult.error.issues)
      return this.fallback(intent)
    }
    const { steps, knowledge } = planResult.data
    // exactOptionalPropertyTypes: category 미정의 시 키 자체를 생략해 정규화
    const normalized = knowledge?.map((k) =>
      typeof k === 'string'
        ? k
        : k.category !== undefined
          ? { content: k.content, category: k.category }
          : { content: k.content },
    )

    return {
      steps,
      estimatedTime: String(planResult.data.estimatedTime ?? '1 hour'),
      ...(normalized && normalized.length > 0 ? { knowledge: normalized } : {}),
    }
  }

  private fallback(intent: string): { steps: Step[]; estimatedTime: string } {
    return {
      steps: [{
        id: 'step-1',
        title: intent.slice(0, 60),
        description: intent,
        agentType: 'developer',
        dependencies: [],
        estimatedMinutes: 60,
      }],
      estimatedTime: '1 hour',
    }
  }
}
