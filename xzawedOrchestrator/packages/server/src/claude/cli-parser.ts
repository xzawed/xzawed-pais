import type { Chunk } from '@xzawed/shared'

export function parseCLILine(line: string): Chunk | null {
  if (!line.trim()) return null
  try {
    const event = JSON.parse(line) as Record<string, unknown>
    if (
      event.type === 'system' &&
      event.subtype === 'init' &&
      typeof event.session_id === 'string'
    ) {
      return { type: 'claude_session', content: event.session_id }
    }
    if (event.type === 'assistant') {
      const content = (event.message as { content?: unknown[] })?.content
      if (Array.isArray(content)) {
        for (const block of content) {
          const b = block as { type: string; text?: string }
          if (b.type === 'text' && b.text !== undefined) {
            return { type: 'text', content: b.text }
          }
        }
      }
    }
  } catch { /* ignore */ }
  return null
}
