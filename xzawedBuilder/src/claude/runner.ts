import Anthropic from '@anthropic-ai/sdk'
import type { BuildError } from '../types.js'

const SYSTEM_PROMPT = `You are a build error analyzer. Given a build log, extract errors as a JSON array.
Return ONLY valid JSON array: [{"file":"path","line":42,"message":"error text","suggestion":"fix suggestion"}]
Omit file and line if not present. Always include message and suggestion.`

export class ClaudeRunner {
  private readonly client: Anthropic

  constructor(apiKey: string, private readonly model: string) {
    this.client = new Anthropic({ apiKey })
  }

  async analyzeBuildFailure(output: string): Promise<BuildError[]> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Build log:\n\`\`\`\n${output}\n\`\`\`` }],
      })

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')

      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (!jsonMatch) return this.fallback(output)

      return JSON.parse(jsonMatch[0]) as BuildError[]
    } catch {
      return this.fallback(output)
    }
  }

  private fallback(output: string): BuildError[] {
    return [{
      message: output.slice(0, 500),
      suggestion: 'Claude 분석 실패 — 빌드 로그를 직접 확인하세요',
    }]
  }
}
