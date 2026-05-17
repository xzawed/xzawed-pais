import type { Chunk, Message } from '@xzawed/shared'
import type { ClaudeRunner, RunOptions } from './runner.interface.js'

export class HTTPRemoteRunner implements ClaudeRunner {
  constructor(private remoteUrl: string) {}

  async *send(messages: Message[], options: RunOptions = {}): AsyncIterable<Chunk> {
    try {
      const response = await fetch(`${this.remoteUrl}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages,
          claudeSessionId: options.claudeSessionId,
          model: options.model,
          systemPrompt: options.systemPrompt,
        }),
        signal: options.signal,
      })

      if (!response.ok) {
        yield { type: 'error', content: `Remote server returned ${response.status}` }
        return
      }

      if (!response.body) {
        yield { type: 'error', content: 'No response body from remote server' }
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            yield JSON.parse(line) as Chunk
          } catch {
            // ignore unparseable lines
          }
        }
      }

      if (buffer.trim()) {
        try {
          yield JSON.parse(buffer) as Chunk
        } catch { /* ignore */ }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        yield { type: 'error', content: 'Request aborted' }
      } else {
        yield { type: 'error', content: err instanceof Error ? err.message : String(err) }
      }
    }
  }
}
