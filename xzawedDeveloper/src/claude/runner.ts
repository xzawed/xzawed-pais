import Anthropic from '@anthropic-ai/sdk'
import type { FileChange } from '../types.js'

const SYSTEM_PROMPT = `You are an expert software developer. Given a development plan and project context, implement the required code changes.

Return ONLY a JSON array of file changes with this exact structure:
[
  {"path": "/absolute/path/to/new-file.ts", "operation": "create", "content": "// file content here"},
  {"path": "/absolute/path/to/existing.ts", "operation": "modify", "content": "// updated full content"},
  {"path": "/absolute/path/to/old.ts", "operation": "delete"}
]

Rules:
- Return ONLY the JSON array, no explanatory text before or after
- Use absolute file paths based on the provided project path
- For delete operations, omit the content field
- Include complete file contents for create and modify (not partial diffs)
- Apply ALL changes described in the plan`

export class ClaudeRunner {
  private client: Anthropic

  constructor(private apiKey: string, private model: string) {
    this.client = new Anthropic({ apiKey })
  }

  async generateChanges(
    plan: string,
    projectPath: string,
    context: Record<string, unknown>,
  ): Promise<{ changes: FileChange[]; summary: string }> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Project path: ${projectPath}\nContext: ${JSON.stringify(context, null, 2)}\n\nPlan:\n${plan}`,
      }],
    })

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')

    const changes = this.parseChanges(text)
    const summary = `Implemented ${changes.length} file change(s) for: ${plan.slice(0, 100)}`
    return { changes, summary }
  }

  parseChanges(text: string): FileChange[] {
    let cleaned = text.trim()

    // Strip opening code fence (```json or ```)
    if (cleaned.startsWith('```')) {
      const firstNewline = cleaned.indexOf('\n')
      cleaned = firstNewline !== -1 ? cleaned.slice(firstNewline + 1) : cleaned.slice(3)
    }

    // Strip closing code fence
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, cleaned.lastIndexOf('```')).trim()
    }

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
  return (
    typeof obj['path'] === 'string' &&
    (obj['operation'] === 'create' || obj['operation'] === 'modify' || obj['operation'] === 'delete')
  )
}
