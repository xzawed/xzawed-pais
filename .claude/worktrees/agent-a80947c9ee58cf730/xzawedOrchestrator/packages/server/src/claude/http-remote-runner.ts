import type { Chunk, Message } from '@xzawed/shared'
import type { ClaudeRunner, RunOptions } from './runner.interface.js'
import { splitLines } from './cli-parser.js'

function validateRemoteUrl(url: string): void {
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Remote URL must use http or https scheme: ${url}`)
  }
}

function tryParseChunk(line: string): Chunk | null {
  try {
    return JSON.parse(line) as Chunk
  } catch {
    return null
  }
}

async function* readNdjsonStream(body: ReadableStream<Uint8Array>): AsyncIterable<Chunk> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const [lines, remainder] = splitLines(buffer, decoder.decode(value, { stream: true }))
      buffer = remainder
      for (const line of lines) {
        if (!line.trim()) continue
        const chunk = tryParseChunk(line)
        if (chunk !== null) yield chunk
      }
    }
    if (buffer.trim()) {
      const chunk = tryParseChunk(buffer)
      if (chunk !== null) yield chunk
    }
  } finally {
    reader.cancel().catch(() => { /* ignore cancel errors */ })
  }
}

export class HTTPRemoteRunner implements ClaudeRunner {
  constructor(private readonly remoteUrl: string) {
    validateRemoteUrl(remoteUrl)
  }

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

      yield* readNdjsonStream(response.body)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        yield { type: 'error', content: 'Request aborted' }
      } else {
        yield { type: 'error', content: err instanceof Error ? err.message : String(err) }
      }
    }
  }
}
