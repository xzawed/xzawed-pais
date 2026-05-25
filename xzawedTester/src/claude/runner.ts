import Anthropic from '@anthropic-ai/sdk'
import type { TestFailure } from '../types.js'

const API_TIMEOUT_MS = 30_000

const SYSTEM_PROMPT = `You are a test failure analyzer. Given test output, extract all failures as a JSON array.

Return ONLY a valid JSON array:
[{"file":"path/to/test.ts","testName":"test description","message":"failure detail","suggestion":"how to fix"}]

Rules:
- Return ONLY the JSON array, no other text
- Include all four fields for every failure
- If the file path is unknown, use "unknown"
- Keep message concise (under 200 chars)
- Make suggestions actionable`

export class ClaudeRunner {
  private readonly client: Anthropic

  constructor(apiKey: string, private readonly model: string) {
    this.client = new Anthropic({ apiKey })
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
