import Anthropic from '@anthropic-ai/sdk'
import type { Step, UISpec } from '../types.js'

const SYSTEM_PROMPT = `You are a software project planning agent. Given a development intent and context, break it down into concrete, actionable steps.

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
  "estimatedTime": "2 hours"
}

Format 2 — When clarification is needed:
{
  "clarification_needed": true,
  "question": "What specific framework would you like to use?",
  "fields": [
    { "id": "framework", "label": "Frontend Framework", "type": "select", "options": ["React", "Vue", "Angular"], "required": true }
  ]
}

agentType values: "developer" | "designer" | "tester" | "builder" | "watcher" | "security"
Set dependencies as array of step ids that must complete first.
Only ask for clarification when truly essential information is missing.`

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

  async generatePlan(
    intent: string,
    context: Record<string, unknown>,
    priority: 'normal' | 'high'
  ): Promise<{ steps: Step[]; estimatedTime: string } | ClarificationNeeded> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: `Intent: ${intent}\nPriority: ${priority}\nContext: ${JSON.stringify(context, null, 2)}`,
        }],
      })

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')

      const start = text.indexOf('{')
      const end = text.lastIndexOf('}')
      if (start === -1 || end === -1) return this.fallback(intent)

      const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>

      if (parsed.clarification_needed === true) {
        return new ClarificationNeeded(
          String(parsed.question ?? 'Could you provide more details?'),
          Array.isArray(parsed.fields) ? (parsed.fields as UISpec['fields']) : []
        )
      }

      const steps = parsed.steps as Step[]
      if (!Array.isArray(steps) || steps.length === 0) return this.fallback(intent)

      return {
        steps,
        estimatedTime: String(parsed.estimatedTime ?? '1 hour'),
      }
    } catch {
      return this.fallback(intent)
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
