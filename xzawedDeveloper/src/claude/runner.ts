import Anthropic from '@anthropic-ai/sdk'
import path from 'node:path'
import { answerViaClaude, callClaudeText } from '@xzawed/agent-streams'
import type { FileChange } from '../types.js'

const API_TIMEOUT_MS = Number(process.env['DEVELOPER_CLAUDE_TIMEOUT_MS'] ?? '120000')

const SYSTEM_PROMPT = `You are an expert software developer. Given a development plan and project context, implement the required code changes.

Return ONLY a JSON array of file changes with this exact structure:
[
  {"path": "src/new-file.ts", "operation": "create", "content": "// file content here"},
  {"path": "src/existing.ts", "operation": "modify", "content": "// updated full content"},
  {"path": "src/old.ts", "operation": "delete"}
]

Rules:
- Return ONLY the JSON array, no explanatory text before or after
- Use relative file paths from the project root (e.g., 'src/index.ts', not '/absolute/path/src/index.ts')
- For delete operations, omit the content field
- Include complete file contents for create and modify (not partial diffs)
- Apply ALL changes described in the plan`

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
  ): Promise<{ changes: FileChange[]; summary: string }> {
    const userContent = [
      `Project path: ${projectPath}`,
      `Context: ${JSON.stringify(context, null, 2)}`,
      clarificationContext ? `Answer from another agent: ${clarificationContext}` : '',
      `\nPlan:\n${plan}`,
    ].filter(Boolean).join('\n')

    const text = await callClaudeText(this.client, this.model, 8192, SYSTEM_PROMPT, userContent, API_TIMEOUT_MS)
    const changes = this.parseChanges(text)
    const summary = `Implemented ${changes.length} file change(s) for: ${plan.slice(0, 100)}`
    return { changes, summary }
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

  parseChanges(text: string): FileChange[] {
    let cleaned = extractJSON(text)

    const start = cleaned.indexOf('[')
    const end = cleaned.lastIndexOf(']')
    if (start === -1 || end === -1 || end <= start) return []

    try {
      const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1))
      if (!Array.isArray(parsed)) return []
      return parsed.filter(isFileChange)
    } catch {
      return []
    }
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
