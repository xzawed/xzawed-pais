import type { Chunk, Message } from '@xzawed/shared'

export interface RunOptions {
  model?: string
  systemPrompt?: string
  signal?: AbortSignal
  claudeSessionId?: string
}

export interface ClaudeRunner {
  send(messages: Message[], options?: RunOptions): AsyncIterable<Chunk>
}
