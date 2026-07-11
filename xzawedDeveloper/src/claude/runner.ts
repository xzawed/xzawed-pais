import Anthropic from '@anthropic-ai/sdk'
import path from 'node:path'
import { answerViaClaude, callClaudeText, stripJsonFences, formatDomainKnowledge } from '@xzawed/agent-streams'
import type { FileChange } from '../types.js'

const API_TIMEOUT_MS = Number(process.env['DEVELOPER_CLAUDE_TIMEOUT_MS'] ?? '120000')

const SYSTEM_PROMPT = `You are an expert software developer. Given a development plan and project context, implement the required code changes.

If the prompt includes a "이전 프로젝트 도메인 지식" section, you MUST respect and build upon those prior decisions and constraints.

Return ONLY a JSON object with this exact structure:
{
  "changes": [
    {"path": "src/new-file.ts", "operation": "create", "content": "// file content here"},
    {"path": "src/existing.ts", "operation": "modify", "content": "// updated full content"},
    {"path": "src/old.ts", "operation": "delete"}
  ],
  "knowledge": ["구현 도메인 결정·제약을 한 줄씩 (예: '인증은 JWT 사용', 'DB 접근은 repository 패턴'). 없으면 생략."]
}

Rules:
- Return ONLY the JSON object, no explanatory text before or after
- Use relative file paths from the project root (e.g., 'src/index.ts', not '/absolute/path/src/index.ts')
- For delete operations, omit the content field
- Include complete file contents for create and modify (not partial diffs)
- Apply ALL changes described in the plan
- "knowledge" is optional; include durable implementation decisions/constraints worth remembering across the project`

export class ClaudeRunner {
  private readonly client: Anthropic

  constructor(apiKey: string, private readonly model: string) {
    this.client = new Anthropic({ apiKey })
  }

  async generateChanges(
    plan: string,
    projectPath: string,
    context: Record<string, unknown>,
    clarificationContext?: string,
    model?: string,
  ): Promise<{ changes: FileChange[]; summary: string; knowledge?: string[] }> {
    const userContent = [
      formatDomainKnowledge(context),
      `Project path: ${projectPath}`,
      `Context: ${JSON.stringify(context, null, 2)}`,
      clarificationContext ? `Answer from another agent: ${clarificationContext}` : '',
      `\nPlan:\n${plan}`,
    ].filter(Boolean).join('\n')

    const text = await callClaudeText(this.client, model ?? this.model, 8192, SYSTEM_PROMPT, userContent, API_TIMEOUT_MS)
    const { changes, knowledge } = this.parseResponse(text)
    const summary = `Implemented ${changes.length} file change(s) for: ${plan.slice(0, 100)}`
    return { changes, summary, ...(knowledge && knowledge.length > 0 ? { knowledge } : {}) }
  }

  /** 다른 에이전트의 질의(query)에 개발 관점에서 답한다. */
  async answerQuery(query: string, context: Record<string, unknown>): Promise<string> {
    return answerViaClaude(
      this.client,
      this.model,
      'You are an expert software developer. Answer the question concisely from an implementation feasibility perspective. Plain text, no JSON.',
      query,
      context,
    )
  }

  /**
   * Claude 응답을 파싱한다. 객체 형식 {changes, knowledge}를 우선 시도하고,
   * 실패하면 레거시 배열 형식([...])으로 폴백한다(하위호환).
   */
  parseResponse(text: string): { changes: FileChange[]; knowledge?: string[] } {
    const cleaned = stripJsonFences(text)

    // 객체 형식: { "changes": [...], "knowledge": [...] }
    const os = cleaned.indexOf('{')
    const oe = cleaned.lastIndexOf('}')
    if (os !== -1 && oe > os) {
      try {
        const parsed: unknown = JSON.parse(cleaned.slice(os, oe + 1))
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          const obj = parsed as Record<string, unknown>
          if (Array.isArray(obj['changes'])) {
            const changes = (obj['changes'] as unknown[]).filter(isFileChange)
            const knowledge = Array.isArray(obj['knowledge'])
              ? (obj['knowledge'] as unknown[]).filter((k): k is string => typeof k === 'string')
              : []
            return knowledge.length > 0 ? { changes, knowledge } : { changes }
          }
        }
      } catch { /* 객체 파싱 실패 → 배열 폴백 */ }
    }

    // 레거시 배열 형식: [ {...}, ... ]
    const as = cleaned.indexOf('[')
    const ae = cleaned.lastIndexOf(']')
    if (as !== -1 && ae > as) {
      try {
        const parsed: unknown = JSON.parse(cleaned.slice(as, ae + 1))
        if (Array.isArray(parsed)) return { changes: parsed.filter(isFileChange) }
      } catch { /* noop */ }
    }
    // 여기까지 오면 객체·배열 어느 형식으로도 유효한 changes를 못 얻은 것 = 파싱 실패.
    // (정당한 빈 결과 {changes:[]}·[]는 위에서 조기 반환). 무로그 폴백은 malformed LLM
    // 출력과 '변경 0건 성공'을 Manager가 구분 못 하게 만드므로 파싱 실패를 관측 가능화한다.
    console.warn('[developer] LLM 응답 파싱 실패 — 유효한 changes 없음, 변경 0건으로 폴백')
    return { changes: [] }
  }

  parseChanges(text: string): FileChange[] {
    return this.parseResponse(text).changes
  }
}

function isFileChange(item: unknown): item is FileChange {
  if (typeof item !== 'object' || item === null) return false
  const obj = item as Record<string, unknown>
  const validOp =
    obj['operation'] === 'create' || obj['operation'] === 'modify' || obj['operation'] === 'delete'
  if (!validOp || typeof obj['path'] !== 'string') return false
  // Reject absolute paths at parse time — defense in depth
  if (path.isAbsolute(obj['path'] as string)) return false
  if ((obj['operation'] === 'create' || obj['operation'] === 'modify') &&
      typeof obj['content'] !== 'string') {
    return false
  }
  return true
}
