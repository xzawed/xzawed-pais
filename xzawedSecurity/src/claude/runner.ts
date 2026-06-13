import Anthropic from '@anthropic-ai/sdk'
import fs from 'node:fs/promises'
import path from 'node:path'
import { answerViaClaude } from '@xzawed/agent-streams'
import type { SecurityIssue } from '../types.js'
import { validatePath } from '../executor.js'

const API_TIMEOUT_MS = Number(process.env["CLAUDE_TIMEOUT_MS"] ?? "120000")

const SYSTEM_PROMPT = `You are a security code auditor specializing in OWASP Top 10 vulnerabilities.
Analyze the provided code files and return security issues found.

Return ONLY a valid JSON object:
{
  "issues": [{"id":"CL-001","severity":"high","category":"injection","file":"path/to/file.ts","line":42,"description":"SQL injection via string concatenation","suggestion":"Use parameterized queries","cwe":"CWE-89"}],
  "knowledge": ["프로젝트에 적용할 보안 도메인 규칙·제약을 한 줄씩 (예: '모든 외부 입력은 검증', '비밀번호는 argon2id 해시'). 없으면 생략."]
}

Severity levels: "critical", "high", "medium", "low"
Categories: "injection", "xss", "auth", "exposure", "config", "crypto", "dependency"
Fields "line" and "cwe" are optional. If no issues found, return "issues": [].
"knowledge" is optional; include durable security rules worth remembering across the project.
Return ONLY the JSON object, no other text.`

export class ClaudeRunner {
  private readonly client: Anthropic

  constructor(apiKey: string, private readonly model: string) {
    this.client = new Anthropic({ apiKey })
  }

  /** 다른 에이전트의 질의(query)에 보안 관점에서 답한다. */
  async answerQuery(query: string, context: Record<string, unknown>): Promise<string> {
    return answerViaClaude(
      this.client,
      this.model,
      'You are a security expert (OWASP Top 10). Answer the question concisely from a security perspective. Plain text, no JSON.',
      query,
      context,
    )
  }

  async analyzeArtifacts(
    filePaths: string[],
    workspaceRoot: string,
  ): Promise<{ issues: SecurityIssue[]; knowledge?: string[] }> {
    if (filePaths.length === 0) return { issues: [] }

    const fileContents: string[] = []
    for (const filePath of filePaths) {
      try {
        const validPath = await validatePath(filePath, workspaceRoot)
        const content = await fs.readFile(validPath, 'utf-8')
        fileContents.push(`=== ${path.basename(filePath)} ===\n${content.slice(0, 3000)}`)
      } catch {
        // skip inaccessible or out-of-bounds files
      }
    }

    if (fileContents.length === 0) return { issues: [] }

    let timerId: ReturnType<typeof setTimeout> | undefined
    try {
      const response = await Promise.race([
        this.client.messages.create({
          model: this.model,
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: fileContents.join('\n\n').slice(0, 16000) }],
        }),
        new Promise<never>((_, reject) => {
          timerId = setTimeout(() => reject(new Error('Claude API timeout')), API_TIMEOUT_MS)
        }),
      ])

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')

      return this.parseResult(text)
    } catch {
      return { issues: [] }
    } finally {
      clearTimeout(timerId)
    }
  }

  /**
   * Claude 응답을 파싱한다. 객체 형식 {issues, knowledge}를 우선 시도하고,
   * 실패하면 레거시 배열 형식([...])으로 폴백한다(하위호환).
   */
  parseResult(text: string): { issues: SecurityIssue[]; knowledge?: string[] } {
    let cleaned = text.trim()

    if (cleaned.startsWith('```')) {
      const firstNewline = cleaned.indexOf('\n')
      cleaned = firstNewline !== -1 ? cleaned.slice(firstNewline + 1) : cleaned.slice(3)
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, cleaned.lastIndexOf('```')).trim()
    }

    // 객체 형식: { "issues": [...], "knowledge": [...] }
    const os = cleaned.indexOf('{')
    const oe = cleaned.lastIndexOf('}')
    if (os !== -1 && oe > os) {
      try {
        const parsed: unknown = JSON.parse(cleaned.slice(os, oe + 1))
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          const obj = parsed as Record<string, unknown>
          if (Array.isArray(obj['issues'])) {
            const issues = (obj['issues'] as unknown[])
              .filter(isSecurityIssue)
              .map((i): SecurityIssue => ({ ...i, source: 'llm' }))
            const knowledge = Array.isArray(obj['knowledge'])
              ? (obj['knowledge'] as unknown[]).filter((k): k is string => typeof k === 'string')
              : []
            return knowledge.length > 0 ? { issues, knowledge } : { issues }
          }
        }
      } catch { /* 객체 파싱 실패 → 배열 폴백 */ }
    }

    // 레거시 배열 형식: [ {...}, ... ]
    const start = cleaned.indexOf('[')
    const end = cleaned.lastIndexOf(']')
    if (start === -1 || end === -1 || end <= start) return { issues: [] }

    try {
      const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1))
      if (!Array.isArray(parsed)) return { issues: [] }
      const issues = parsed
        .filter(isSecurityIssue)
        .map((i): SecurityIssue => ({ ...i, source: 'llm' }))
      return { issues }
    } catch {
      return { issues: [] }
    }
  }

  parseIssues(text: string): SecurityIssue[] {
    return this.parseResult(text).issues
  }
}

function isSecurityIssue(item: unknown): item is Omit<SecurityIssue, 'source'> {
  if (typeof item !== 'object' || item === null) return false
  const obj = item as Record<string, unknown>
  return (
    typeof obj['id'] === 'string' &&
    (obj['severity'] === 'low' ||
      obj['severity'] === 'medium' ||
      obj['severity'] === 'high' ||
      obj['severity'] === 'critical') &&
    typeof obj['category'] === 'string' &&
    typeof obj['file'] === 'string' &&
    typeof obj['description'] === 'string' &&
    typeof obj['suggestion'] === 'string'
  )
}
