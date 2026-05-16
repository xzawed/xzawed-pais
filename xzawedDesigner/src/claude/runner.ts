import Anthropic from '@anthropic-ai/sdk'
import type { ComponentSpec, UISpec } from '../types.js'

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
- cssClasses uses the target design system conventions`

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
  ): Promise<{ components: ComponentSpec[]; uiSpec: UISpec }> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [
            `Intent: ${intent}`,
            `Framework: ${targetFramework}`,
            `Design System: ${designSystem}`,
            `Context: ${JSON.stringify(context, null, 2)}`,
          ].join('\n'),
        }],
      })

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')

      return this.parseResponse(text, intent)
    } catch {
      return this.fallback(intent)
    }
  }

  parseResponse(text: string, intent: string): { components: ComponentSpec[]; uiSpec: UISpec } {
    let cleaned = text.trim()

    if (cleaned.startsWith('```')) {
      const firstNewline = cleaned.indexOf('\n')
      cleaned = firstNewline !== -1 ? cleaned.slice(firstNewline + 1) : cleaned.slice(3)
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, cleaned.lastIndexOf('```')).trim()
    }

    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start === -1 || end === -1) return this.fallback(intent)

    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>
      const components = Array.isArray(parsed['components'])
        ? (parsed['components'] as ComponentSpec[])
        : []
      if (components.length === 0) return this.fallback(intent)

      const uiSpec = (parsed['uiSpec'] as UISpec | undefined) ?? {
        type: 'mockup_viewer' as const,
        title: intent.slice(0, 60),
        content: intent,
      }
      return { components, uiSpec }
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
