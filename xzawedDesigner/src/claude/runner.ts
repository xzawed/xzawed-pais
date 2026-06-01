import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { AgentQuery, parseAgentQuery, answerViaClaude, callClaudeText } from '@xzawed/agent-streams'
import { ComponentSpecSchema, UISpecSchema } from '../types.js'
import type { ComponentSpec, UISpec } from '../types.js'

const DesignResponseSchema = z.object({
  components: z.array(ComponentSpecSchema).min(1),
  uiSpec: UISpecSchema.optional(),
})

const API_TIMEOUT_MS = Number(process.env["CLAUDE_TIMEOUT_MS"] ?? "120000")

const SYSTEM_PROMPT = `You are a UI/UX design agent. Given a design intent and context, produce component specifications.

Return ONLY valid JSON in this exact structure:
{
  "components": [
    {
      "name": "LoginForm",
      "description": "User authentication form",
      "props": {
        "onSubmit": "(credentials: {email: string; password: string}) => void",
        "isLoading": "boolean"
      },
      "children": [
        {
          "name": "EmailInput",
          "description": "Controlled email input",
          "props": { "value": "string", "onChange": "(v: string) => void" },
          "cssClasses": ["input", "input-email"]
        }
      ],
      "cssClasses": ["form", "login-form"]
    }
  ],
  "uiSpec": {
    "type": "mockup_viewer",
    "title": "Login Page",
    "content": "Single-page login with email/password inputs"
  }
}

Rules:
- Return ONLY the JSON object, no text before or after
- props values are TypeScript type strings
- children is optional; omit if the component has no sub-components
- cssClasses uses the target design system conventions

COLLABORATION — instead of components, you MAY return one of these to talk to another agent:

Format 2 — active request (you need another expert's input to design correctly):
{ "agent_query": true, "to": "developer", "question": "Can you implement a real-time inventory display?", "kind": "active_request" }

Format 3 — cross-check (ALWAYS verify your understanding of the received intent with the originating agent before designing):
{ "agent_query": true, "to": "planner", "question": "I understood the goal as X with constraints Y — is that correct?", "kind": "cross_check" }

Collaboration rules:
- "to" is one of: planner, developer, tester, builder, watcher, security
- ALWAYS cross-check (Format 3) your understanding before producing components, unless an answer was already provided to you
- Use active request (Format 2) only when you genuinely need another expert's input
- When an answer from another agent is provided in the prompt, incorporate it and return Format 1 (components)`

export class ClaudeRunner {
  private readonly client: Anthropic

  constructor(apiKey: string, private readonly model: string) {
    this.client = new Anthropic({ apiKey })
  }

  async generateDesign(
    intent: string,
    context: Record<string, unknown>,
    targetFramework: string,
    designSystem: string,
    clarificationContext?: string,
  ): Promise<{ components: ComponentSpec[]; uiSpec: UISpec } | AgentQuery> {
    const userContent = [
      `Intent: ${intent}`,
      `Framework: ${targetFramework}`,
      `Design System: ${designSystem}`,
      `Context: ${JSON.stringify(context, null, 2)}`,
      clarificationContext ? `Answer from another agent: ${clarificationContext}` : '',
    ].filter(Boolean).join('\n')

    const text = await callClaudeText(this.client, this.model, 4096, SYSTEM_PROMPT, userContent, API_TIMEOUT_MS)
    return this.parseResponse(text, intent)
  }

  /** 다른 에이전트의 질의(query)에 디자인 관점에서 답한다. */
  async answerQuery(query: string, context: Record<string, unknown>): Promise<string> {
    return answerViaClaude(
      this.client,
      this.model,
      'You are a UI/UX design expert. Answer the question concisely from a design perspective. Plain text, no JSON.',
      query,
      context,
    )
  }

  parseResponse(text: string, intent: string): { components: ComponentSpec[]; uiSpec: UISpec } | AgentQuery {
    let cleaned = extractJSON(text)

    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start === -1 || end === -1) return this.fallback(intent)

    try {
      const raw: unknown = JSON.parse(cleaned.slice(start, end + 1))
      const agentQuery = parseAgentQuery(raw as Record<string, unknown>)
      if (agentQuery) return agentQuery

      const result = DesignResponseSchema.safeParse(raw)
      if (!result.success) {
        console.warn('[Designer] response validation failed:', result.error.issues)
        return this.fallback(intent)
      }

      const { components, uiSpec } = result.data
      return {
        components,
        uiSpec: uiSpec ?? {
          type: 'mockup_viewer',
          title: intent.slice(0, 60),
          content: intent,
        },
      }
    } catch {
      return this.fallback(intent)
    }
  }

  private fallback(intent: string): { components: ComponentSpec[]; uiSpec: UISpec } {
    return {
      components: [{
        name: 'Component',
        description: intent.slice(0, 120),
        props: { children: 'React.ReactNode' },
      }],
      uiSpec: {
        type: 'mockup_viewer',
        title: intent.slice(0, 60),
        content: intent,
      },
    }
  }
}

function extractJSON(text: string): string {
  let cleaned = text.trim()
  if (cleaned.startsWith('```')) {
    const firstNewline = cleaned.indexOf('\n')
    cleaned = firstNewline !== -1 ? cleaned.slice(firstNewline + 1) : cleaned.slice(3)
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, cleaned.lastIndexOf('```')).trim()
  }
  return cleaned
}
