import Anthropic from '@anthropic-ai/sdk'
import type { Chunk, Message } from '@xzawed/shared'
import type { ClaudeRunner, RunOptions } from './runner.interface.js'

const MAX_TOKENS = Number(process.env.CLAUDE_MAX_TOKENS ?? '8096')

interface APIRunnerOptions {
  apiKey: string
  model: string
}

export class APIRunner implements ClaudeRunner {
  private readonly client: Anthropic
  private readonly model: string

  constructor(options: APIRunnerOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey })
    this.model = options.model
  }

  async *send(messages: Message[], options: RunOptions = {}): AsyncIterable<Chunk> {
    try {
      const systemParam: Array<{ type: 'text'; text: string; cache_control: { type: 'ephemeral' } }> | undefined =
        options.systemPrompt
          ? [{ type: 'text', text: options.systemPrompt, cache_control: { type: 'ephemeral' } }]
          : undefined

      const stream = this.client.messages.stream({
        model: options.model ?? this.model,
        max_tokens: MAX_TOKENS,
        ...(systemParam ? { system: systemParam } : {}),
        messages: messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      }, { signal: options.signal })

      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          yield { type: 'text', content: event.delta.text }
        }
      }

      yield { type: 'done', content: '' }
    } catch (err) {
      yield { type: 'error', content: err instanceof Error ? err.message : String(err) }
    }
  }
}
