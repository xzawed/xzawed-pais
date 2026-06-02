import Anthropic from '@anthropic-ai/sdk'
import { answerViaClaude, extractKnowledgeViaClaude } from '@xzawed/agent-streams'
import type { TestFailure } from '../types.js'

const API_TIMEOUT_MS = Number(process.env["CLAUDE_TIMEOUT_MS"] ?? "120000")

const SYSTEM_PROMPT = `You are a test failure analyzer. Given test output, extract all failures as a JSON array.

Return ONLY a valid JSON array:
[{"file":"path/to/test.ts","testName":"test description","message":"failure detail","suggestion":"how to fix"}]

Rules:
- Return ONLY the JSON array, no other text
- Include all four fields for every failure
- If the file path is unknown, use "unknown"
- Keep message concise (under 200 chars)
- Make suggestions actionable`

const KNOWLEDGE_PROMPT = `You extract DURABLE domain knowledge from a test run for a project's long-term wiki.

Return ONLY a JSON object:
{"knowledge": ["one durable testing decision per line"]}

Capture ONLY lasting decisions worth remembering across the whole project, such as:
- Testing strategy or framework choices (e.g. "테스트는 Vitest로 작성, 프로세스 격리(pool:forks)")
- Coverage policies or quality gates (e.g. "신규 코드 커버리지 80% 게이트")
- Reproducible fragile/flaky areas or invariants (e.g. "Redis 블로킹 mock은 setImmediate로 양보 필요")

Do NOT emit transient run state — never "tests passed", "5 tests failed", counts, durations, or one-off failure details.
If there is nothing durable, return {"knowledge": []}.`

export class ClaudeRunner {
  private readonly client: Anthropic

  constructor(apiKey: string, private readonly model: string) {
    this.client = new Anthropic({ apiKey })
  }

  /** 다른 에이전트의 질의(query)에 테스트 관점에서 답한다. */
  async answerQuery(query: string, context: Record<string, unknown>): Promise<string> {
    return answerViaClaude(
      this.client,
      this.model,
      'You are a software testing expert. Answer the question concisely from a testing/quality perspective. Plain text, no JSON.',
      query,
      context,
    )
  }

  async analyzeFailures(output: string): Promise<TestFailure[]> {
    try {
      const response = await Promise.race([
        this.client.messages.create({
          model: this.model,
          max_tokens: 2048,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: output.slice(0, 8000) }],
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Claude API timeout')), API_TIMEOUT_MS)
        ),
      ])

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')

      return this.parseFailures(text)
    } catch {
      return []
    }
  }

  /**
   * 테스트 실행 출력에서 지속적(durable) 테스트 도메인 지식만 추출한다.
   * 일시 상태(통과/실패·카운트)는 제외하며, 지식이 없거나 호출 실패 시 빈 배열을 반환한다.
   */
  async extractKnowledge(output: string): Promise<string[]> {
    return extractKnowledgeViaClaude(this.client, this.model, KNOWLEDGE_PROMPT, output, API_TIMEOUT_MS)
  }

  parseFailures(text: string): TestFailure[] {
    let cleaned = extractJSON(text)

    const start = cleaned.indexOf('[')
    const end = cleaned.lastIndexOf(']')
    if (start === -1 || end === -1 || end <= start) return []

    try {
      const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1))
      if (!Array.isArray(parsed)) return []
      return parsed.filter(isTestFailure)
    } catch {
      return []
    }
  }
}

function isTestFailure(item: unknown): item is TestFailure {
  if (typeof item !== 'object' || item === null) return false
  const obj = item as Record<string, unknown>
  return (
    typeof obj['file'] === 'string' &&
    typeof obj['testName'] === 'string' &&
    typeof obj['message'] === 'string' &&
    typeof obj['suggestion'] === 'string'
  )
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
