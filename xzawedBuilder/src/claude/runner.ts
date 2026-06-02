import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { answerViaClaude, extractKnowledgeViaClaude } from '@xzawed/agent-streams'
import type { BuildError } from '../types.js'

const API_TIMEOUT_MS = Number(process.env['CLAUDE_TIMEOUT_MS'] ?? '120000')

const BuildErrorSchema = z.object({
  file: z.string().optional(),
  line: z.number().optional(),
  message: z.string(),
  suggestion: z.string(),
})

const SYSTEM_PROMPT = `You are a build error analyzer. Given a build log, extract errors as a JSON array.
Return ONLY valid JSON array: [{"file":"path","line":42,"message":"error text","suggestion":"fix suggestion"}]
Omit file and line if not present. Always include message and suggestion.`

const KNOWLEDGE_PROMPT = `You extract DURABLE domain knowledge from a build run for a project's long-term wiki.

Return ONLY a JSON object:
{"knowledge": ["one durable build decision per line"]}

Capture ONLY lasting decisions worth remembering across the whole project, such as:
- Build tool / toolchain choices (e.g. "빌드는 Turborepo로 모노레포 오케스트레이션")
- Build configuration decisions (e.g. "TypeScript strict 모드, dist/로 컴파일")
- Artifact / output conventions (e.g. "산출물은 dist/index.js 단일 엔트리")

Do NOT emit transient run state — never "build succeeded", "build failed", error counts, durations, or one-off error details.
If there is nothing durable, return {"knowledge": []}.`

export class ClaudeRunner {
  private readonly client: Anthropic

  constructor(apiKey: string, private readonly model: string) {
    this.client = new Anthropic({ apiKey })
  }

  /** 다른 에이전트의 질의(query)에 빌드 관점에서 답한다. */
  async answerQuery(query: string, context: Record<string, unknown>): Promise<string> {
    return answerViaClaude(
      this.client,
      this.model,
      'You are a build/toolchain expert. Answer the question concisely from a build perspective. Plain text, no JSON.',
      query,
      context,
    )
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

      const parseResult = z.array(BuildErrorSchema).safeParse(JSON.parse(jsonMatch[0]))
      return parseResult.success ? (parseResult.data as BuildError[]) : this.fallback(output)
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

  /**
   * 빌드 로그에서 지속적(durable) 빌드 도메인 지식만 추출한다.
   * 일시 상태(성공/실패·오류 카운트)는 제외하며, 지식이 없거나 호출 실패 시 빈 배열을 반환한다.
   */
  async extractKnowledge(output: string): Promise<string[]> {
    return extractKnowledgeViaClaude(this.client, this.model, KNOWLEDGE_PROMPT, output, API_TIMEOUT_MS)
  }
}
