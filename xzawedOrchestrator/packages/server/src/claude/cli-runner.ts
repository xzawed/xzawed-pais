import { spawn } from 'node:child_process'
import type { Chunk, Message } from '@xzawed/shared'
import type { ClaudeRunner, RunOptions } from './runner.interface.js'
import { drainBuffer, flushRemainder } from './cli-parser.js'
import { ChunkQueue } from './chunk-queue.js'

export class CLIRunner implements ClaudeRunner {
  async *send(messages: Message[], options: RunOptions = {}): AsyncIterable<Chunk> {
    const lastUserMessage = messages.findLast(m => m.role === 'user')?.content ?? ''

    const args = options.claudeSessionId
      ? [
          '--resume', options.claudeSessionId,
          '--print',
          '--output-format', 'stream-json',
          '--verbose',
          ...(options.systemPrompt ? ['--system-prompt', options.systemPrompt] : []),
          '--',
          lastUserMessage,
        ]
      : [
          '--print',
          '--output-format', 'stream-json',
          '--verbose',
          ...(options.systemPrompt ? ['--system-prompt', options.systemPrompt] : []),
          '--',
          lastUserMessage,
        ]

    const proc = spawn('claude', args, { env: process.env })
    const queue = new ChunkQueue()

    let buffer = ''
    proc.stdout.on('data', (data: Buffer) => {
      buffer = drainBuffer(buffer, data, c => queue.push(c))
    })

    proc.on('close', (code) => {
      flushRemainder(buffer, c => queue.push(c))
      queue.push(
        code === 0
          ? { type: 'done', content: '' }
          : { type: 'error', content: `claude CLI exited with code ${code}` },
      )
      queue.close()
    })

    proc.on('error', (err) => {
      queue.push({ type: 'error', content: err.message })
      queue.close()
    })

    yield* queue
  }
}
