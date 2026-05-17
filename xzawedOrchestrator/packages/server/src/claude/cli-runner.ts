import { spawn } from 'node:child_process'
import type { Chunk, Message } from '@xzawed/shared'
import type { ClaudeRunner, RunOptions } from './runner.interface.js'
import { parseCLILine } from './cli-parser.js'

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

    const pending: Chunk[] = []
    let closed = false
    let wakeup: (() => void) | null = null

    const signal = () => {
      if (wakeup) {
        const fn = wakeup
        wakeup = null
        fn()
      }
    }

    let buffer = ''
    proc.stdout.on('data', (data: Buffer) => {
      buffer += data.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const chunk = parseCLILine(line)
        if (chunk) pending.push(chunk)
      }
      signal()
    })

    proc.on('close', (code) => {
      if (buffer.trim()) {
        const chunk = parseCLILine(buffer)
        if (chunk) pending.push(chunk)
      }
      if (code === 0) {
        pending.push({ type: 'done', content: '' })
      } else {
        pending.push({ type: 'error', content: `claude CLI exited with code ${code}` })
      }
      closed = true
      signal()
    })

    proc.on('error', (err) => {
      pending.push({ type: 'error', content: err.message })
      closed = true
      signal()
    })

    while (true) {
      while (pending.length > 0) {
        const next = pending.shift()
        if (next !== undefined) yield next
      }
      if (closed) break
      await new Promise<void>(r => {
        wakeup = r
        if (pending.length > 0 || closed) {
          wakeup = null
          r()
        }
      })
    }
  }
}
